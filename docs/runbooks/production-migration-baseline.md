# Production Migration Baseline

## Why Reconciliation Is Required

Production was historically synchronized with `prisma db push`, while the two
checked-in migrations describe an older Socos model. On a fresh empty PostgreSQL
database, those migrations apply successfully but leave 60 schema-diff
statements relative to `schema.prisma`.

The applied migrations are immutable. Their SHA-256 fingerprints are protected
by `scripts/database-ops.test.mjs`:

- `20260327000000_initial_schema`: `54bc51c615dcf13983aba12e9c88fecd142774a35fc2b1174298c68df7010701`
- `20260331000000_add_celebrations`: `3c907065378ea6d9a3464ccf21d7e8c025d0327e402f1bb566daba2e268585ce`

`20260715000000_reconcile_production_schema` is forward-only and transactional.
Its legacy conversion exists only to reconcile a fresh, empty database produced
by the two historical migrations. It fails closed if any legacy application
table contains rows. On a populated schema already maintained by `db push`, it
uses only the current-shape path and idempotently ensures missing tables,
indexes, and foreign keys.

## Synthetic Proof

Use an empty synthetic PostgreSQL instance only. Do not seed it from production.

```bash
DATABASE_URL="$FRESH_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
DATABASE_URL="$FRESH_DATABASE_URL" pnpm --filter @socos/api exec prisma validate
DATABASE_URL="$FRESH_DATABASE_URL" node scripts/compare-schema.mjs
```

The required result is three applied migrations, a valid Prisma schema, and
`schema_status=match statements=0`. Repeating `migrate deploy` must report no
pending migrations.

## Cloud Restore Gate

Before touching production:

1. Trigger and verify a new Coolify backup execution.
2. Restore it into a disposable database inside the Coolify network.
3. Capture aggregate counts only.
4. Run `migrate deploy`, `prisma validate`, and `compare-schema.mjs` there.
5. Run `verify-post-migration-counts.mjs` against the pre-migration metadata.
6. Drop the restored database.

Do not use `prisma db push`, `migrate reset`, or edit the two historical
migration files. The verified production restore has no `_prisma_migrations`
table. Before the first deploy, baseline those files on the disposable restore
using Prisma's supported history command, then deploy the reconciliation. For
the final count verification, load `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
and `PGDATABASE` from the runner secret store. Export only configured optional
libpq variables from `PGSSLMODE`, `PGSSLCERT`, `PGSSLKEY`, `PGSSLROOTCERT`,
`PGSSLCRL`, `PGCONNECT_TIMEOUT`, `PGAPPNAME`, and `PGOPTIONS`:

```bash
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate resolve --applied 20260327000000_initial_schema
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate resolve --applied 20260331000000_add_celebrations
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
node scripts/verify-post-migration-counts.mjs "$PRE_MIGRATION_METADATA"
```

The completed cloud drill on 2026-07-16 baselined both historical migrations,
applied the reconciliation, reached `schema_status=match statements=0`, and
preserved counts for all 16 preexisting public tables. The only additions were
three empty DM tables and three `_prisma_migrations` history rows. The
disposable database was deleted.

Production was then baselined with the two `resolve --applied` commands. The
first migration-only deployment executed the reconciliation normally, and a
second deployment reported no pending migrations.

## Deployment

For every future candidate with schema or data changes, first run the
cloud-only release restore gate in `database-backup-restore.md` and require a
receipt bound to the exact candidate SHA. It covers the fresh Coolify backup,
independent consistent dump, restricted disposable restore, candidate
migration, Prisma validation, zero drift, aggregate invariants, and verified
cleanup. An older drill or mocked test is not a receipt for the current SHA.

The fixed SSH host, forced command, trusted mirror, restricted restore role,
root-owned secret environment, private work/lock directories, and network
policy must be provisioned and audited separately. Until that is complete and
the first live receipt succeeds, the automated gate is implemented but not
operationally attested.

`services/api/start.sh` fails closed: it runs `prisma migrate deploy` and starts
NestJS only after migration success. The current repository has twelve checked-in
migrations. After the cloud restore proof and credential rotation are complete,
set the expected full commit SHA, run the read-only source preflight, deploy, and
perform read-only smoke checks:

```bash
git fetch origin main
expected_commit=$(git rev-parse origin/main)
COOLIFY_EXPECTED_COMMIT_SHA="$expected_commit" \
  scripts/coolify.sh deploy swwcg80gkw4k0k4oco8w8wgw
```

When Coolify reports `git_commit_sha=HEAD`, the source is not pinned to the
expected revision. The preflight proves only that the application deploys
`main`; exact commit identity remains a post-deployment verification. If Coolify
exposes a full revision pin, the wrapper requires it to equal the expected SHA
before POSTing the deployment.

Require the preflight marker and all three deployment markers, then record them
in the deployment log:

```text
deployment_preflight=main source_revision=HEAD verification=post-deploy
deployment_uuid=<Coolify deployment UUID>
deployment_status=finished
deployment_commit=<the exact expected full SHA>
```

The wrapper fails if the finished deployment reports a missing/non-full commit
or a commit other than `COOLIFY_EXPECTED_COMMIT_SHA`. Coolify may activate the
new deployment before that mismatch is observable, so this check detects a bad
activation; it does not prevent one when the source is configured as `HEAD`.
Omitting the variable still reports the deployment UUID and deployed commit but
does not claim branch or revision pinning.

```text
GET /                         -> 200
GET /api/health-check         -> 200
guarded API without token     -> 401
removed DDL endpoints         -> 404
canonical agent routes        -> 401 without token
notification status route     -> 401 without token
```

Credential rotation covers the Coolify API token, database owner and runtime
credentials, JWT secret, and personal login. Replacement values belong only in
their owning systems, macOS Keychain, and Coolify environment configuration. On
2026-07-16 each new credential was verified, the old Coolify token was revoked,
and the post-rotation backup completed successfully.

Coolify deploys `docker-compose.prod.yml`. It intentionally contains no internal
PostgreSQL service; the API must receive the external Coolify database URL as
`DATABASE_URL`. Confirm that variable is configured before deploying. A
`POSTGRES_PASSWORD` application variable is not required by this Compose file.

The production deployment completed with both services healthy. The public
root and health endpoint returned 200; guarded routes returned 401; removed DDL
routes returned 404. Rollback must redeploy the most recent healthy secured
commit and preserve the forward-only database schema. Never roll back to a
release that restores forgeable tokens, runtime DDL, embedded credentials, or
pre-baseline startup behavior; use a forward fix if no secured image is
compatible.
