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

The only valid live candidate is the action-time exact
`git rev-parse origin/main`. The reviewed application-code SHA
`084b7addb0ccc765aa343c5412ed8f5fe5f6da0b` is an ancestor, not an independently
valid gate candidate. Gate, deploy, and smoke checks must all use the same exact
full `origin/main` SHA resolved immediately before the operation.

The local wrapper accepts one lowercase 40-character SHA, connects only to the
`socos-release-gate` SSH config host with `BatchMode=yes`, and sends only that
SHA on standard input. The remote account must have a forced command pointing
to `/usr/local/sbin/socos-release-gate-dispatch`; it must expose neither a shell
nor a public endpoint. The unprivileged dispatcher rejects any SSH original
command before it invokes the root launcher through the single sudoers
allowance. The wrapper accepts only the fixed redacted JSON receipt and rejects
extra fields, paths, changed SHAs, remote stderr, or malformed output.

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

### Provision the runner

Pin the real host key before first use and create local SSH aliases with host-key
checking enabled. Never use `StrictHostKeyChecking=no`.

```sshconfig
Host socos-coolify-root
  HostName qed.quest
  User root
  IdentityFile ~/.ssh/socos-coolify-root
  IdentitiesOnly yes
  BatchMode yes
  RequestTTY no
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts

Host socos-release-gate
  HostName qed.quest
  User socos-release-gate
  IdentityFile ~/.ssh/socos-release-gate
  IdentitiesOnly yes
  BatchMode yes
  RequestTTY no
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
```

On the host, `/root/socos` must be a trusted checkout whose `origin` is exactly
`https://github.com/yevgeniusr/socos.git`. The remote command below rejects
tracked/index changes, fetches only fixed `origin/main`, detaches at that exact
ref, verifies `HEAD`, and rechecks tracked/index state before it executes the
provisioner. Retrieve both inputs locally without echoing, build the only JSON
document with `jq`, stream it to the remote root script, and use an EXIT trap so
both shell variables are cleared even if the pipeline fails:

```bash
clear_provision_secrets() {
  unset authorized_key coolify_token
}
trap clear_provision_secrets EXIT
IFS= read -r authorized_key < "$HOME/.ssh/socos-release-gate.pub"
coolify_token=$(security find-generic-password -w -a socos -s coolify-cli-qed-token)
jq -cn --arg authorized_key "$authorized_key" --arg coolify_token "$coolify_token" \
  '{authorized_key:$authorized_key,coolify_token:$coolify_token}' \
  | ssh -o BatchMode=yes -o RequestTTY=no -o StrictHostKeyChecking=yes \
      socos-coolify-root \
      'set -e; cd /root/socos; test "$(git remote get-url origin)" = "https://github.com/yevgeniusr/socos.git"; test -z "$(git status --porcelain --untracked-files=no)"; git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main >/dev/null 2>&1; candidate=$(git rev-parse refs/remotes/origin/main); git checkout --detach refs/remotes/origin/main >/dev/null 2>&1; test "$(git rev-parse HEAD)" = "$candidate"; test -z "$(git status --porcelain --untracked-files=no)"; exec bash scripts/provision-cloud-restore-release-gate.sh'
clear_provision_secrets
trap - EXIT
```

Success is exactly `provision_status=ready` followed by the trusted SHA. Stop on
any other output.

### Audit the forced command and role boundary

After provisioning and every rotation, prove ownership/modes, the single key,
locked account, empty supplemental groups, and one-command sudo boundary:

```bash
sudo passwd -S socos-release-gate
sudo id socos-release-gate
sudo stat -c '%U:%G %a %n' \
  /var/lib/socos-release-gate/.ssh \
  /var/lib/socos-release-gate/.ssh/authorized_keys \
  /etc/sudoers.d/socos-release-gate /etc/socos-release-gate.env \
  /usr/local/sbin/socos-release-gate-dispatch \
  /usr/local/sbin/socos-release-gate-launcher
sudo awk 'END { print NR }' /var/lib/socos-release-gate/.ssh/authorized_keys
sudo visudo -cf /etc/sudoers.d/socos-release-gate
sudo -l -U socos-release-gate

bounded() {
  seconds=$1
  shift
  /usr/bin/perl -e '
    use strict;
    use warnings;
    use POSIX qw(setpgid);
    my $seconds = shift @ARGV;
    exit 127 unless defined $seconds && $seconds =~ /\A[1-9][0-9]*\z/ && @ARGV;
    pipe(my $ready_read, my $ready_write) or exit 127;
    my $pid = fork();
    exit 127 unless defined $pid;
    if ($pid == 0) {
      close $ready_read;
      exit 127 unless setpgid(0, 0) == 0;
      exit 127 unless syswrite($ready_write, "1") == 1;
      close $ready_write;
      exec { $ARGV[0] } @ARGV;
      exit 127;
    }
    close $ready_write;
    my $ready = "";
    my $ready_count = sysread($ready_read, $ready, 1);
    close $ready_read;
    unless (defined $ready_count && $ready_count == 1 && $ready eq "1") {
      waitpid $pid, 0;
      exit 127;
    }
    local $SIG{ALRM} = sub {
      kill "TERM", -$pid;
      select undef, undef, undef, 0.2;
      kill "KILL", -$pid;
      waitpid $pid, 0;
      exit 124;
    };
    alarm $seconds;
    waitpid $pid, 0;
    alarm 0;
    my $status = $?;
    if ($status & 127) { exit(128 + ($status & 127)); }
    exit($status >> 8);
  ' "$seconds" "$@"
}

if auth_output=$(
  printf '%s\n' 'invalid-candidate' |
    bounded 10 ssh -o BatchMode=yes -o RequestTTY=no socos-release-gate 2>&1
); then
  auth_status=0
else
  auth_status=$?
fi
case "$auth_status" in
  0) printf '%s\n' 'auth_status=unexpected_success' >&2; exit 1 ;;
  124) printf '%s\n' 'auth_status=timeout' >&2; exit 1 ;;
esac
[ "$auth_output" = 'launcher_status=failed' ] || {
  printf '%s\n' 'auth_status=unexpected_output' >&2
  exit 1
}
printf '%s\n' 'auth_status=launcher_reached'

audit_rejected() {
  label=$1
  shift
  if bounded 10 "$@"; then audit_code=0; else audit_code=$?; fi
  case "$audit_code" in
    0) printf '%s\n' "audit_status=unexpected_success audit=$label" >&2; return 1 ;;
    124) printf '%s\n' 'audit_status=timeout' >&2; return 1 ;;
    *) printf '%s\n' "audit_status=rejected audit=$label" ;;
  esac
}

git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main >/dev/null 2>&1
audit_candidate=$(git rev-parse refs/remotes/origin/main)
printf '%s\n' "$audit_candidate" | audit_rejected remote-command \
  ssh -o BatchMode=yes -o RequestTTY=no socos-release-gate id
audit_rejected sftp sftp -o BatchMode=yes socos-release-gate
printf '%s\n' "$audit_candidate" | audit_rejected pty \
  ssh -o BatchMode=yes -o RequestTTY=force socos-release-gate id
printf '%s\n' "$audit_candidate" | audit_rejected forwarding \
  ssh -o BatchMode=yes -o RequestTTY=no -o ExitOnForwardFailure=yes \
    -L 15432:127.0.0.1:5432 socos-release-gate id
```

The `.ssh` directory and key must be root-owned, grouped to
`socos-release-gate`, non-writable by that group, and mode `750` and `640`.
Remaining modes must be `440`, `600`, `755`, and `755`; the key count must be
one; sudo must allow only the launcher. The no-command probe must reach the
launcher and return exactly its fixed failure marker; `Permission denied`,
timeout, success, or any other output fails the audit. Only after that proof may
each nonzero transport result count as rejection. The dispatcher rejects the
remote command while it is still unprivileged, before sudo clears the SSH
environment. The operator-side `bounded` helper uses macOS `/usr/bin/perl`,
executes argv without shell interpolation, and reports deadline expiry as 124.
It pipe-synchronizes creation of a dedicated child process group before arming
the alarm, signals that entire group on timeout, and reaps the group leader.
Audit role flags, memberships, and database ACLs without selecting passwords or
application rows:

```bash
sudo docker exec zwkk0scogckskkwss8oo48k4 psql -X --set=ON_ERROR_STOP=1 \
  --username=postgres --dbname=postgres --tuples-only --no-align <<'SQL'
SELECT rolname, rolsuper, rolinherit, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN ('socos_release_gate_admin', 'socos_release_gate_restore')
ORDER BY rolname;
SELECT member_role.rolname, granted.rolname
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname IN ('socos_release_gate_admin', 'socos_release_gate_restore')
ORDER BY member_role.rolname, granted.rolname;
SELECT datname, datacl FROM pg_database
WHERE datname IN ('postgres', 'socos') ORDER BY datname;
SQL
```

Both roles must be non-superuser, `NOINHERIT`, non-createrole,
non-replication, and non-bypass-RLS. Only `socos_release_gate_admin` may have
`CREATEDB`, and its only membership is `socos_release_gate_restore`. Restore
must have no memberships. Production connect remains explicit for `postgres`
and `socos_app` and denied to both gate roles. `PUBLIC` has neither `TEMPORARY`
on the maintenance database nor `CREATE` on its public schema, so restore cannot
write maintenance temp tables.

The immutable runtime tag is
`socos-release-gate-runtime:node22-pnpm10.10.0-pg16-v2`. Provisioning verifies
Node 22, pnpm 10.10.0, and PostgreSQL client major 16 for `pg_dump`, `psql`,
`pg_restore`, `createdb`, and `dropdb`. The launcher installs dependencies only
in a private exact-candidate runner worktree; that install receives no secret
environment and does not mount the trusted checkout. It re-verifies the runner
HEAD and tracked/index state after install and removes the worktree through a
bounded EXIT cleanup. Only the later gate container mounts the trusted checkout
for the gate's controlled candidate worktrees.

### Token and role rotation

Create the replacement Coolify token first and update the local Keychain item;
for SSH rotation, use the replacement Ed25519 public key. Prove no gate is
running, rerun the exact provisioning command, repeat all audits, and complete
one fixed-receipt gate. The rerun replaces the only authorized key and
environment file and rotates both generated role passwords. Revoke the old
token and remove the old private key only after the new path succeeds. Never
edit the environment, authorized key, or role passwords by hand.

### Stale-lock recovery

A gate lock is a directory, not proof that a process is dead. Diagnose from the
host and stop if any launcher, gate container, or updater lock is live:

```bash
sudo pgrep -af 'socos-release-gate-launcher|cloud-restore-release-gate.mjs' || true
sudo docker ps --filter ancestor=socos-release-gate-runtime:node22-pnpm10.10.0-pg16-v2 \
  --format '{{.ID}} {{.Status}} {{.Names}}'
sudo flock -n /var/lock/socos-release-gate/updater.lock -c true
sudo test -d /var/lock/socos-release-gate/gate.lock
```

Only after `pgrep` and `docker ps` return no live launcher/gate and the updater
`flock` succeeds may root remove the empty stale directory:

```bash
sudo rmdir /var/lock/socos-release-gate/gate.lock
```

If `rmdir` reports nonempty state, stop; never use recursive removal. Repository
tests use command shims and do not constitute live recovery evidence. Do not
deploy migration 12 until the live fixed receipt succeeds.

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
