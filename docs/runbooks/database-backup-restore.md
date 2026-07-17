# Database Backup And Restore

## Safety Boundary

Socos production data stays in Coolify. Never download a production dump or
restore production rows on a developer workstation. Run the scripts below only
in a restricted cloud administration runner on the same private network as the
database. Their stdout contains paths, table counts, and status only; it must
never contain database URLs or row values.

## Scheduled Backup

The Socos PostgreSQL resource has an enabled Coolify backup schedule:

- Schedule: daily at 02:00 UTC
- Local retention: seven days and seven copies
- Off-host storage: client-side encrypted Google Drive replication, 30 days
- Backup configuration: `b85nxfljaz0xpo9xqa57lfr4`

Before a schema deployment, use the configured Coolify context to trigger a new
execution and wait for that exact execution's `status=success`. Do not use
`--show-sensitive` or print the database resource response. The CLI cannot
decode the current execution response because Coolify returns `size` as a
string. Use the authenticated raw API, immediately project only UUID, status,
and timestamps, and bind the trigger to exactly one new UUID:

```bash
database_uuid=zwkk0scogckskkwss8oo48k4
backup_uuid=b85nxfljaz0xpo9xqa57lfr4
COOLIFY_BASE_URL=${COOLIFY_BASE_URL:-https://qed.quest}
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN must come from the runner secret store}"
before=$(mktemp)
current=$(mktemp)
trap 'rm -f "$before" "$current"' EXIT

backup_executions() {
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H 'Accept: application/json' \
    "$COOLIFY_BASE_URL/api/v1/databases/$database_uuid/backups/$backup_uuid/executions" |
    jq -ec '
      if (.executions | type) == "array" then
        [.executions[] | {uuid, status, created_at, updated_at}]
      else
        error("unexpected backup execution response")
      end
    '
}

backup_executions | jq -r '.[].uuid' | sort > "$before"
coolify database backup trigger "$database_uuid" "$backup_uuid" --format json >/dev/null

for _ in $(seq 1 120); do
  executions=$(backup_executions)
  jq -r '.[].uuid' <<<"$executions" | sort > "$current"
  new_uuid=$(comm -13 "$before" "$current")
  new_count=$(printf '%s\n' "$new_uuid" | sed '/^$/d' | wc -l | tr -d ' ')
  [ "$new_count" -le 1 ] || { echo "Ambiguous backup executions." >&2; exit 1; }
  if [ "$new_count" -eq 1 ]; then
    status=$(jq -er --arg uuid "$new_uuid" \
      '.[] | select(.uuid == $uuid) | .status' <<<"$executions")
    case "$status" in
      success) printf 'backup_execution_uuid=%s backup_status=success\n' "$new_uuid"; break ;;
      failed|cancelled) printf 'backup_status=%s\n' "$status" >&2; exit 1 ;;
    esac
  fi
  sleep 5
done
[ "${status:-}" = success ] || { echo "Backup polling timed out." >&2; exit 1; }
```

The helper never emits the token, `size`, paths, filenames, or the full API
response. Any unexpected response shape, multiple new UUIDs, terminal failure,
or timeout stops the deployment.

## Independent Recovery Proof

Run this inside an ephemeral cloud administration runner. Supply secrets through
its secret store, use an encrypted cloud volume for `BACKUP_DIR`, and destroy the
runner and volume after verification.

```bash
BACKUP_DIR=/secure-ephemeral/socos-backups
backup_output=$(DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  BACKUP_DIR="$BACKUP_DIR" scripts/backup-postgres.sh)
printf '%s\n' "$backup_output"
BACKUP_FILE=$(printf '%s\n' "$backup_output" | sed -n 's/^backup_file=//p')
[ -f "$BACKUP_FILE" ] || { echo "Backup artifact was not published." >&2; exit 1; }

ADMIN_DATABASE_URL="$CLOUD_ADMIN_DATABASE_URL" \
  scripts/verify-postgres-backup.sh "$BACKUP_FILE"

# The default freshness guard requires the completed artifact to be over two
# minutes old before encrypted upload and byte-for-byte remote verification.
sleep 180
SOURCE_DIR="$(dirname "$BACKUP_FILE")" \
  RCLONE_REMOTE="$RCLONE_CRYPT_REMOTE" \
  scripts/offsite-backup.sh
```

Expected output is `backup_status=created`, then
`restore_status=verified aggregate_counts=verified`. The verifier checks the
SHA-256 sidecar, restores to a randomly named disposable database, compares
aggregate row counts for every public table, requires core Socos tables, and
drops the database before reporting success. A failed success-path deletion is
a failed verification; error-path deletion failures are also reported. Set
`KEEP_RESTORE_DB=1` only for an explicitly managed cloud drill that will be
deleted separately; the verifier reports the generated database identifier as
`restore_database_retained=<database-name>`.

## Off-Host Replication

The production host runs `scripts/offsite-backup.sh` after the Coolify backup
window. It accepts Coolify `*.dmp` files and the complete independently verified
bundle: `*.dump`, `*.dump.sha256`, and `*.dump.metadata.tsv`. A dump without both
sidecars, or sidecars without their dump, cannot satisfy the freshness gate. An
`rclone crypt` remote encrypts file contents, names, and directory names before
upload to Google Drive. The job cryptchecks all three bundle files and expires
sidecars before their dump so an interrupted retention pass cannot orphan them.
The crypt password is held in the production root-only rclone config and
separately in the operator's macOS Keychain. No decrypted dump is stored on the
operator workstation.

The destination is required to be an `rclone crypt` backend under the dedicated
`socos-postgres-backups` subpath. Retention runs only after a source dump between
2 minutes and 26 hours old is copied and cryptographically verified; stale or
failed local backups leave existing off-host generations untouched.

The server schedule is installed at `/etc/cron.d/socos-offsite-backup`. Inspect
`/var/log/socos-offsite-backup.log` for the latest
`offsite_backup_status=verified` marker. A successful Coolify backup is not a
substitute for this marker because local-only copies share the server failure
domain.

The backup script exports one repeatable-read PostgreSQL snapshot, imports that
snapshot into both `pg_dump` and the aggregate query, and publishes the dump
last as an atomic commit marker. Its metadata therefore describes the exact
dump contents, even while production writes continue. Incomplete work and any
published sidecars are removed by the `EXIT` trap.

## Migration Recovery Drill

Provision a separate disposable cloud restore through the administration plane
and capture its pre-migration aggregate metadata using the same aggregate query
as the verifier. Then run:

```bash
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma validate
DATABASE_URL="$RESTORED_DATABASE_URL" node scripts/compare-schema.mjs
DATABASE_URL="$RESTORED_DATABASE_URL" \
  node scripts/verify-post-migration-counts.mjs "$PRE_MIGRATION_METADATA"
```

Require `schema_status=match statements=0` and
`migration_counts_status=preserved`. The count verifier requires every
preexisting public table count to remain identical. It derives the expected
migration count from checked-in migration directories, supports every baseline
from the six-migration pre-agent state through current, requires tables already
introduced at that baseline to be present with matching counts, and requires
calendar, location, event discovery, and event-brief rollout tables newly
introduced during the drill to be present at zero rows. Drop the disposable
database before declaring the drill successful. If any command fails, stop the
deployment and retain only redacted schema metadata logs.

## Cloud-Only Release Restore Gate

Schema and data releases must use the repository gate instead of moving a dump
to an operator workstation:

```bash
git fetch origin main
candidate_sha=$(git rev-parse origin/main)
node scripts/run-cloud-restore-release-gate.mjs "$candidate_sha"
```

The local wrapper accepts one lowercase 40-character SHA, connects only to the
`socos-release-gate` SSH config host with `BatchMode=yes`, and sends only that
SHA on standard input. The remote account must have a forced command pointing
to `scripts/cloud-restore-release-gate.mjs`; it must expose neither a shell nor
a public endpoint. The wrapper accepts only the fixed redacted JSON receipt and
rejects extra fields, paths, changed SHAs, remote stderr, or malformed output.

The forced command requires root-managed configuration for its trusted Git
mirror, private work root, single-flight lock directory, Coolify URL/token and
database/backup UUIDs, production read URL, database-admin URL, and a separate
restricted restore-role URL. Use the `SOCOS_RELEASE_GATE_*` variable names in
the runner source. A root-managed updater must fetch `origin/main` into the
trusted mirror before the gate runs; the candidate must equal that exact remote
head, not merely be an ancestor. The updater and forced-command account must
not allow the caller to change the remote or refs.

Set `SOCOS_RELEASE_GATE_CLUSTER_ID` to the PostgreSQL system identifier from
`pg_control_system()`. Production, administration, and restore URLs must use
three distinct roles on that exact cluster. The gate verifies the production
role has no write/schema/database-create capability, verifies the restore role
has no elevated role flags, inherited memberships, maintenance-database write
capabilities, or production access, rejects reuse of the administration
credential, and uses the restricted role only for the randomly named
disposable database.

For the exact candidate SHA, the runner proves one fresh positive-size Coolify
backup, creates an independent consistent dump with `backup-postgres.sh`,
restores it to a randomly named restricted-role database, deploys candidate
migrations, validates Prisma, requires zero schema drift and preserved
aggregate invariants, and deletes the database, worktree, temporary artifacts,
and lock before emitting success. `KEEP_RESTORE_DB` is forbidden in release
mode. Child stderr, URLs, dump paths, and rows never appear in the receipt.
SSH, HTTP, child commands, polling, termination escalation, and cleanup all
have bounded deadlines. Signal handlers remain installed and idempotent through
cleanup, and each cleanup phase has an independent deadline so a stuck phase
cannot prevent later temp and lock cleanup. PostgreSQL URLs stay in child
environments, never CLI arguments; schema drift uses Prisma's supported
`--from-schema-datasource` mode with `DATABASE_URL` in the environment.

Provisioning the forced-command account and key restriction, root-owned
environment launcher, restricted database role, private-network access, and
secret rotation remains an operator gate. Repository tests are mocked and do
not constitute live recovery evidence.

## Deleted Encrypted Data Recovery Window

Application deletion removes live calendar, location, event, OAuth, and
personal-context rows from PostgreSQL, but encrypted backups can still contain
the deleted ciphertext until the off-host retention window expires. Treat
deleted encrypted data as recoverable for 30 days after the last backup that
could contain it leaves retention. During that rollback-plus-expiry interval,
retain every old `PERSONAL_DATA_KEYS` entry needed to decrypt those backups and
retain the stable `PERSONAL_DATA_INDEX_KEY`; do not prune old encryption keys
immediately after an application rekey. A key can be removed only after all
local and off-host generations that may contain ciphertext for that key have
expired and a restore drill no longer requires it.

## Current Operational Gate

On 2026-07-16, the corrected `socos` backup execution was restored entirely on
the Coolify server. All 16 preexisting public tables and their aggregate row
counts matched the live source. The two historical migrations were baselined,
the reconciliation migration applied, Prisma reported
`schema_status=match statements=0`, and all preexisting counts remained
identical. Only the three expected empty DM tables were added,
`_prisma_migrations` contained three rows, and the disposable database was
deleted. Earlier small executions targeted the maintenance `postgres` database
and are not valid recovery evidence. Production remained untouched during this
proof. A post-rotation backup (`ipqz6iid9jp6crsm6g25ro1p`) then completed with
`status=success` on 2026-07-16.
The same day, all five retained Socos dumps were copied to the encrypted
off-host remote and `rclone cryptcheck` reported zero differences across five
matching files. The decrypted remote view contained five files, while the
underlying Drive path exposed no plaintext `pg-dump` names. The scheduled job
and separate Keychain recovery material were verified after installation.
