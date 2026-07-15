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
- Off-host storage: not configured
- Backup configuration: `b85nxfljaz0xpo9xqa57lfr4`

Before a schema deployment, use the configured Coolify context to trigger a new
execution and wait for `status=success`. Do not use `--show-sensitive` or print
the database resource response.

```bash
coolify database backup trigger zwkk0scogckskkwss8oo48k4 b85nxfljaz0xpo9xqa57lfr4
coolify database backup executions zwkk0scogckskkwss8oo48k4 b85nxfljaz0xpo9xqa57lfr4
```

The CLI version in use may fail to decode newer Coolify response fields. In
that case, inspect only `uuid`, `status`, and timestamps through the authenticated
API and keep the bearer token out of command output and shell history.

## Independent Recovery Proof

Run this inside an ephemeral cloud administration runner. Supply secrets through
its secret store, use an encrypted cloud volume for `BACKUP_DIR`, and destroy the
runner and volume after verification.

```bash
BACKUP_DIR=/secure-ephemeral/socos-backups \
  DATABASE_URL="$PRODUCTION_DATABASE_URL" \
  scripts/backup-postgres.sh

ADMIN_DATABASE_URL="$CLOUD_ADMIN_DATABASE_URL" \
  scripts/verify-postgres-backup.sh "$BACKUP_FILE"
```

Expected output is `backup_status=created`, then
`restore_status=verified aggregate_counts=verified`. The verifier checks the
SHA-256 sidecar, restores to a randomly named disposable database, compares
aggregate row counts for every public table, requires core Socos tables, and
drops the database before reporting success. A failed success-path deletion is
a failed verification; error-path deletion remains best effort.

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
DATABASE_URL="$RESTORED_DATABASE_URL" node scripts/verify-post-migration-counts.mjs "$PRE_MIGRATION_METADATA"
```

Require `schema_status=match statements=0` and
`migration_counts_status=preserved`. The count verifier requires every
preexisting public table count to remain identical, allows only the three known
empty DM tables, and requires exactly three migration-history rows. Drop the
disposable database before declaring the drill successful. If any command
fails, stop the deployment and retain only redacted schema metadata logs.

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
proof.
