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
drops the database on both success and failure. Use `KEEP_RESTORE_DB=1` only for
the migration proof below, and delete it immediately afterward.

## Migration Recovery Drill

With a retained cloud restore, run:

```bash
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma validate
DATABASE_URL="$RESTORED_DATABASE_URL" node scripts/compare-schema.mjs
```

Require `schema_status=match statements=0`. Re-run aggregate verification, then
drop the disposable database. If any command fails, stop the deployment and
retain only redacted logs needed to diagnose schema metadata.

## Current Operational Gate

On 2026-07-16, the corrected `socos` backup execution was restored entirely on
the Coolify server. All 16 public tables and their aggregate row counts matched
the live source, core tables were present, and the disposable restore was
deleted. Earlier small executions targeted the maintenance `postgres` database
and are not valid recovery evidence.

Migration-on-restore is not yet proven. The restored database has no
`_prisma_migrations` table, the deployed application image has no Prisma CLI,
and the available disposable runner/tunnel paths did not complete. Production
migration and deployment remain blocked until a cloud administrator completes
the baseline and migration drill in the production migration runbook. The
verified restore is necessary but is not, by itself, migration approval.
