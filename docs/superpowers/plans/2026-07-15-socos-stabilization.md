# Socos Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible, secure, backup-protected Socos baseline before importing personal data.

**Architecture:** Keep the existing NestJS/Next.js monorepo and canonical `/api` prefix, but replace forged identity paths with signed JWT identity and remove runtime schema mutation. Coolify remains the deployment plane and PostgreSQL source of truth; Prisma migrations become the only schema deployment mechanism after production drift is reconciled.

**Tech Stack:** Node.js 22, pnpm 10.10.0, Turborepo 2, NestJS 11, Next.js 15, Prisma 6/PostgreSQL, Jest 29, Vitest 4, Playwright, Docker, Coolify CLI.

## Global Constraints

- Real contacts, calendar data, precise location history, and interactions remain only in the Coolify cloud database.
- Never print or commit credentials, tokens, passwords, personal contact values, or database URLs.
- Preserve applied Prisma migrations unchanged; never use `prisma db push` for this rollout.
- Do not migrate or import personal data until a Coolify backup has completed and restored successfully into a disposable database.
- Request identity comes only from a cryptographically verified credential; never trust `X-User-Id` or request-body user IDs.
- Production-mutating E2E tests are prohibited; test identities and data must be synthetic.
- Outbound messages and invitations require the later approval workflow; stabilization must not expose arbitrary direct-send endpoints.
- Use test-first development for behavior changes and commit each task independently.

---

### Task 1: Reproducible Build And CI Contract

**Files:**
- Modify: `packages/agent-core/package.json`
- Modify: `apps/platform/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/shared/package.json`
- Modify: `services/api/package.json`
- Modify: `services/api/jest.config.cjs`
- Create: `services/api/tsconfig.eslint.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `Dockerfile`
- Modify: `services/api/Dockerfile`
- Modify: `docker/Dockerfile.backend`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: deterministic commands `pnpm lint`, `pnpm test`, `pnpm type:check`, and `pnpm build` that terminate in CI mode.
- Produces: frozen workspace install using the root `packageManager` value `pnpm@10.10.0`.

- [ ] **Step 1: Add a failing package contract test**

Create a temporary local assertion command and verify the current manifests fail it:

```bash
node - <<'NODE'
const fs = require('fs');
const agent = JSON.parse(fs.readFileSync('packages/agent-core/package.json'));
if (!agent.devDependencies?.['@types/node']) throw new Error('agent-core lacks @types/node');
if (!agent.scripts?.['type:check']) throw new Error('agent-core lacks type:check');
for (const file of ['apps/platform/package.json', 'apps/web/package.json', 'packages/shared/package.json']) {
  const pkg = JSON.parse(fs.readFileSync(file));
  if (!pkg.scripts.test.includes('vitest run')) throw new Error(`${file} test is not CI mode`);
}
NODE
```

Expected: FAIL with `agent-core lacks @types/node`.

- [ ] **Step 2: Correct workspace scripts and dependency ownership**

Add `@types/node` to `packages/agent-core` dev dependencies, rename `type-check` to `type:check`, and make Vitest scripts use `vitest run --passWithNoTests`. Keep watch scripts separate. Make the API lint command non-mutating and point it at `tsconfig.eslint.json`, which includes `src/**/*.ts` including tests.

- [ ] **Step 3: Include all workspace manifests in Docker dependency stages**

Before `pnpm install --frozen-lockfile`, every Dockerfile used by Socos must copy `packages/agent-core/package.json` as well as the other workspace manifests. No dependency stage may use an unfrozen install.

- [ ] **Step 4: Rebuild the lockfile with the pinned package manager**

Run:

```bash
corepack pnpm@10.10.0 install --no-frozen-lockfile
corepack pnpm@10.10.0 install --frozen-lockfile
```

Expected: both commands exit 0; the second changes no files.

- [ ] **Step 5: Repair test discovery without mixing test frameworks**

Keep API tests on Jest. Rename the three Dungeon Master `*.test.ts` suites to `*.spec.ts`, replace Vitest imports with Jest globals, and update `jest.config.cjs` only as needed for ESM path mapping. Run each newly discovered suite and record any pre-existing behavioral failures before changing production code.

- [ ] **Step 6: Make GitHub Actions operate from the workspace root**

Use `pnpm/action-setup@v4` without a conflicting `version` input, `actions/setup-node@v4` with Node 22 and pnpm caching, one frozen root install, `pnpm --filter @socos/api exec prisma generate`, then root lint/type/test/build jobs. Remove the production-targeting Playwright job; staging E2E is added in the Betabot plan.

- [ ] **Step 7: Verify the build contract**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @socos/api exec prisma generate
pnpm type:check
pnpm test
pnpm build
```

Expected: all exit 0. Run `pnpm lint`; errors caused by configuration or modified files must be fixed, while unrelated legacy warnings may be admitted temporarily only if CI uses the same explicit warning policy.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/ci.yml .gitignore package.json pnpm-lock.yaml packages apps services/api/package.json services/api/jest.config.cjs services/api/tsconfig.eslint.json Dockerfile docker/Dockerfile.backend services/api/Dockerfile
git commit -m "build: restore reproducible monorepo checks"
```

### Task 2: Signed Authentication And Registration Safety

**Files:**
- Modify: `services/api/package.json`
- Modify: `services/api/src/modules/jwt/jwt.service.ts`
- Create: `services/api/src/modules/jwt/jwt.service.spec.ts`
- Modify: `services/api/src/modules/auth/auth.service.ts`
- Modify: `services/api/src/modules/auth/auth.controller.ts`
- Create: `services/api/src/modules/auth/auth.service.spec.ts`
- Modify: `services/api/src/modules/auth/auth.guard.ts`
- Modify: `services/api/.env.example`
- Modify: `turbo.json`

**Interfaces:**
- Produces: `JwtService.generateToken(userId: string): string` signed with HS256.
- Produces: `JwtService.verifyToken(token: string): { userId: string; iat: number; exp: number } | null` validating issuer `socos-api`, audience `socos-clients`, signature, and expiry.
- Consumes: required `JWT_SECRET` of at least 32 characters; registration is disabled unless `INVITE_CODES` is explicitly configured.

- [ ] **Step 1: Write failing JWT security tests**

Test a valid token, a one-byte payload modification, an expired token, a token signed with a different secret, and missing/short production secret. Use only synthetic user IDs. Confirm the current base64 implementation incorrectly accepts a forged payload.

- [ ] **Step 2: Install and implement standard JWT signing**

Add `jsonwebtoken` and `@types/jsonwebtoken`. Generate HS256 tokens with `sub`, seven-day expiry, issuer `socos-api`, and audience `socos-clients`. Verify the algorithm, issuer, audience, expiry, and string `sub`. Reject missing or short secrets; tests may inject a fixed 32+ character secret.

- [ ] **Step 3: Write failing authentication bypass tests**

Mock Prisma with a user whose bcrypt hash does not match. Assert that the formerly hardcoded email/password pair receives `UnauthorizedException`. Assert registration fails closed when `INVITE_CODES` is absent and succeeds only for an explicitly configured code.

- [ ] **Step 4: Remove bypasses and sensitive diagnostics**

Delete the account-specific login path, default invite codes, invite-code logging, password hash diagnostic endpoint, dynamic Prisma construction, and password comparison diagnostic. Preserve standard bcrypt login and token response shape.

- [ ] **Step 5: Run focused and aggregate tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/jwt/jwt.service.spec.ts src/modules/auth/auth.service.spec.ts
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/api/package.json pnpm-lock.yaml services/api/src/modules/jwt services/api/src/modules/auth services/api/.env.example turbo.json
git commit -m "security: replace forgeable tokens with signed JWTs"
```

### Task 3: Remove Runtime Schema Mutation And Guard Agent Surfaces

**Files:**
- Delete: `services/api/src/modules/debug/debug.controller.ts`
- Delete: `apps/web/src/app/api/setup-db/route.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/modules/agents/agents.controller.ts`
- Create: `services/api/src/modules/agents/agents.controller.spec.ts`
- Modify: `services/api/src/modules/agents/strategies/enrichment-agent.ts`
- Create: `services/api/src/modules/agents/strategies/enrichment-agent.spec.ts`
- Modify: `services/api/src/modules/notifications/notifications.controller.ts`
- Create: `services/api/src/modules/notifications/notifications.controller.spec.ts`
- Modify: `services/api/src/modules/notifications/notifications.service.ts`

**Interfaces:**
- Produces: canonical guarded routes under `/api/agents/*` and `/api/notifications/status`.
- Consumes: `request.user.userId` populated only by `AuthGuard`.
- Removes: all HTTP database-creation/DDL routes and arbitrary outbound email/SMS HTTP routes.

- [ ] **Step 1: Write failing controller security tests**

Use Nest metadata assertions to require `AuthGuard` on `AgentsController` and `NotificationsController`, controller paths `agents` and `notifications`, and absence of identity headers. Direct controller tests must prove the authenticated request user is forwarded to services. Add a negative enrichment test proving a contact owned by another user is not updated.

- [ ] **Step 2: Delete destructive database HTTP routes**

Delete both DDL controllers/routes and remove `DebugController` from `AppModule`. Keep health reporting in `HealthController`; schema changes run only through Prisma migration commands.

- [ ] **Step 3: Canonicalize and guard agent routes**

Change `@Controller('api/agents')` to `@Controller('agents')`, add `@UseGuards(AuthGuard)` and bearer documentation, replace every `@Headers('x-user-id')` parameter with the typed authenticated request, and remove the stub identity helper. Owner-scope enrichment reads and updates.

- [ ] **Step 4: Reduce notifications to safe authenticated capabilities**

Change the controller prefix to `notifications`, guard it, keep provider status and owner-scoped reminder operations, and remove arbitrary-recipient email/SMS and public cron endpoints. Ensure every contact lookup includes `{ id: contactId, ownerId: userId }` and expose a service method instead of accessing a private Prisma field through bracket syntax.

- [ ] **Step 5: Remove duplicate module registration**

Let `AgentsModule`, `NotificationsModule`, and `NotificationSchedulerModule` own their controllers/providers. Remove duplicate controller and provider entries from `AppModule`.

- [ ] **Step 6: Verify security behavior**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/agents/agents.controller.spec.ts src/modules/agents/strategies/enrichment-agent.spec.ts src/modules/notifications/notifications.controller.spec.ts
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
```

Expected: all exit 0; repository search finds no `Controller('api/agents')`, `Controller('api/notifications')`, `X-User-Id`, `db-push`, or `setup-db` application route.

- [ ] **Step 7: Commit**

```bash
git add -A services/api/src apps/web/src/app/api/setup-db
git commit -m "security: guard agent routes and remove runtime DDL"
```

### Task 4: Secrets, Startup, Health, And Staging-Only E2E

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `scripts/coolify.sh`
- Modify: `services/api/src/main.ts`
- Modify: `services/api/start.sh`
- Modify: `Dockerfile`
- Modify: `services/api/Dockerfile`
- Modify: `docker/Dockerfile.backend`
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.local.yml`
- Modify: `apps/web/src/app/api/auth/login/route.ts`
- Modify: `apps/web/src/app/api/auth/register/route.ts`
- Create: `apps/web/src/lib/server-api.ts`
- Modify: `apps/web/playwright.config.ts`
- Modify: `tests/e2e/playwright.config.ts`
- Modify: `apps/web/e2e/socos.spec.ts`
- Modify: `apps/web/e2e/celebrations.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Create: `scripts/security-regression.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `getServerApiBaseUrl(): string` and canonical proxy calls to `${base}/api/auth/*`.
- Produces: `GET /api/health-check` as the sole API health probe.
- Consumes: deployment secrets only from environment variables or configured Coolify context.

- [ ] **Step 1: Write a failing secret and production-E2E regression scan**

Create `scripts/security-regression.mjs` to read tracked files from `git ls-files` and fail on the known committed Coolify token, database password, fallback JWT secret, hardcoded real test password, or Playwright `baseURL` equal to the production Socos URL. It must report file paths and rule names, never echo matched secret values.

- [ ] **Step 2: Remove committed credentials and unsafe defaults**

Make `scripts/coolify.sh` require `COOLIFY_TOKEN` and optional `COOLIFY_BASE_URL`; make compose require `DATABASE_URL`, `POSTGRES_PASSWORD`, and `JWT_SECRET` with `${VAR:?message}` syntax. Replace real E2E identities with required synthetic environment variables.

- [ ] **Step 3: Remove database administration from application startup**

Delete database creation logic from `main.ts`. Replace `prisma db push --accept-data-loss` in `start.sh` with `prisma migrate deploy` only after Task 5 confirms the migration baseline. Until then, startup must fail closed with an explicit migration-baseline requirement rather than mutate the schema.

- [ ] **Step 4: Canonicalize health probes**

Update Docker and Compose API checks and combined-container readiness loops to request `/api/health-check`. Combined health must fail when either the web server or API is unavailable.

- [ ] **Step 5: Fix server-side auth proxy routing**

Implement `getServerApiBaseUrl` using `API_INTERNAL_URL`, then `SOCOS_API_URL`, then local development fallback. Login and register proxies append `/api/auth/login` and `/api/auth/register` exactly once.

- [ ] **Step 6: Parameterize E2E for staging only**

Require `E2E_BASE_URL`, reject the production hostname at configuration time, and require synthetic credentials through environment variables. No E2E file may embed a real account or password.

- [ ] **Step 7: Verify**

```bash
node scripts/security-regression.mjs
pnpm type:check
pnpm test
pnpm build
docker build -t socos:stabilized .
```

Expected: all exit 0. The scan reports no forbidden tracked values.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml docker-compose*.yml Dockerfile docker services/api scripts apps/web tests/e2e
git commit -m "ops: remove committed secrets and repair deployment health"
```

### Task 5: Backup, Restore Proof, Migration Baseline, And Deployment

**Files:**
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/verify-postgres-backup.sh`
- Create: `scripts/compare-schema.mjs`
- Create: `docs/runbooks/database-backup-restore.md`
- Create: `docs/runbooks/production-migration-baseline.md`
- Create: `services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql`
- Modify: `services/api/start.sh`

**Interfaces:**
- Consumes: database URLs and Coolify identifiers from environment/configured CLI context; scripts never print them.
- Produces: aggregate-only backup metadata, checksum, restore verification, and schema comparison.
- Produces: a forward-only reconciliation migration proven against fresh and restored PostgreSQL.

- [ ] **Step 1: Configure and trigger Coolify backup**

Use the configured Coolify context to create an enabled daily backup for the Socos database with local retention, trigger it immediately, and poll `coolify database backup executions` until success. Prefer an existing off-host S3 destination when configured; do not invent or expose storage credentials.

- [ ] **Step 2: Add backup verification scripts and runbook**

`backup-postgres.sh` creates a custom-format `pg_dump`, permissions `0600`, a SHA-256 checksum, and aggregate metadata without row values. `verify-postgres-backup.sh` restores into a disposable database, checks expected tables and aggregate counts, then deletes the disposable database unless `KEEP_RESTORE_DB=1`.

- [ ] **Step 3: Reconcile migration history test-first**

Run existing `prisma migrate deploy` against fresh PostgreSQL and capture the expected failure/drift. Compare the restored production schema read-only to `schema.prisma`. Create one forward-only reconciliation migration that adds or alters only what production lacks; never edit the two applied migration files.

- [ ] **Step 4: Prove both database paths**

Run:

```bash
DATABASE_URL="$FRESH_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma migrate deploy
DATABASE_URL="$RESTORED_DATABASE_URL" pnpm --filter @socos/api exec prisma validate
node scripts/compare-schema.mjs
```

Expected: both migration deployments exit 0 and aggregate verification matches the pre-restore metadata.

- [ ] **Step 5: Enable migration-only startup and rotate deployment credentials**

Update `start.sh` to run `prisma migrate deploy` with failure propagation. Rotate exposed Coolify API, database, JWT, and personal test credentials through their owning systems and Coolify environment configuration. Do not place replacement values in repository files or output.

- [ ] **Step 6: Deploy and read-only smoke test**

Deploy the Socos application through Coolify. Verify application status, logs, `GET /`, `GET /api/health-check`, unauthenticated 401s on guarded endpoints, absence of DDL routes, and canonical agent/notification route behavior. Do not create or modify personal records during smoke testing.

- [ ] **Step 7: Commit operational artifacts**

```bash
git add scripts/backup-postgres.sh scripts/verify-postgres-backup.sh scripts/compare-schema.mjs docs/runbooks services/api/prisma/migrations services/api/start.sh
git commit -m "ops: baseline migrations and verify database recovery"
```

### Task 6: Stabilization Release Gate

**Files:**
- Modify: `docs/runbooks/production-migration-baseline.md`
- Modify: `.superpowers/sdd/progress.md` (ignored execution ledger)

**Interfaces:**
- Produces: verified baseline on which the Monica import plan may execute.

- [ ] **Step 1: Run the complete local gate**

```bash
pnpm install --frozen-lockfile
pnpm --filter @socos/api exec prisma generate
pnpm lint
pnpm type:check
pnpm test
pnpm build
node scripts/security-regression.mjs
docker build -t socos:stabilized .
```

Expected: all commands exit 0.

- [ ] **Step 2: Record cloud recovery and health evidence**

Record only timestamps, execution IDs, status, checksums, schema versions, and aggregate counts. Never record URLs containing credentials or personal row data.

- [ ] **Step 3: Request broad code review**

Review the complete stabilization diff for security regressions, ownership violations, migration risk, and missing negative tests. Resolve every Critical and Important finding and rerun the affected gates.

- [ ] **Step 4: Mark stabilization complete**

Only after the code, recovery, and deployment gates pass may the contact import plan begin.
