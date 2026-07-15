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

`20260715000000_reconcile_production_schema` is forward-only. It detects the
legacy contact shape, preserves equivalent data through renames and backfills,
removes obsolete columns and constraints, then ensures current tables, indexes,
and foreign keys. On a schema already maintained by `db push`, its operations
are idempotent.

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
5. Recheck aggregate counts and application-owned invariants.
6. Drop the restored database.

Do not use `prisma db push`, `migrate reset`, or edit the two historical
migration files. The verified production restore has no `_prisma_migrations`
table. Before the first deploy, baseline those files on the disposable restore
using Prisma's supported history command, then deploy the reconciliation:

```bash
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate resolve --applied 20260327000000_initial_schema
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate resolve --applied 20260331000000_add_celebrations
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
```

After this sequence is proven on the disposable restore, repeat the two
`resolve --applied` commands once against production immediately before the
first migration-only deployment. Do not resolve the reconciliation migration;
`migrate deploy` must execute it normally.

## Deployment

`services/api/start.sh` fails closed: it runs `prisma migrate deploy` and starts
NestJS only after migration success. After the cloud restore proof and credential
rotation are complete, deploy the commit through Coolify and perform read-only
smoke checks:

```text
GET /                         -> 200
GET /api/health-check         -> 200
guarded API without token     -> 401
removed DDL endpoints         -> 404
canonical agent routes        -> 401 without token
notification status route     -> 401 without token
```

Credential rotation covers the Coolify API token, database password, JWT secret,
and personal test credentials. Replacement values belong only in their owning
systems and Coolify environment configuration. Rotation and deployment are not
complete until each new credential is verified and the old one is revoked.

Coolify deploys `docker-compose.prod.yml`. It intentionally contains no internal
PostgreSQL service; the API must receive the external Coolify database URL as
`DATABASE_URL`. Confirm that variable is configured before deploying. A
`POSTGRES_PASSWORD` application variable is not required by this Compose file.
