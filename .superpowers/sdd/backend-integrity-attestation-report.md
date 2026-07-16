# Backend Integrity Attestation Report

## Status

DONE

Commit: `cf934d3365dceeef0e99cb2b98992dd2df2bdf64`

## Implementation

- Added unauthenticated `GET /api/health-check/postgresql` under the existing health controller.
- Added `HealthService`, wired through `AppModule`, which executes one bounded Prisma tagged-template query: `SELECT 1`.
- Returns the fixed Betabots real-backend contract only after that query succeeds:

```json
{
  "mode": "real",
  "auth": { "mode": "real" },
  "database": {
    "connected": true,
    "driver": "postgres",
    "persistent": true
  },
  "mocksDetected": false
}
```

- Adds `Cache-Control: no-store` through Nest response-header metadata.
- Converts every database failure to a `503 Service Unavailable` exception carrying this fixed sanitized payload (the application-wide exception filter renders its standard sanitized HTTP error envelope):

```json
{
  "status": "unavailable",
  "attestation": "postgresql-unreachable"
}
```

- Preserves `GET /api/health-check` and its existing `status`, `timestamp`, and `version` contract.
- Returns no rows, counts, version, latency, database name, environment name, host, schema, credential, exception message, or stack trace.

## TDD Evidence

Initial RED command:

```bash
pnpm --filter @socos/api exec jest --runInBand \
  src/health/health.service.spec.ts \
  src/health/health.controller.spec.ts
```

Result: FAIL. `health.service.ts`, the injectable controller dependency, and `postgresqlAttestation()` did not exist.

The official Betabots contract was then applied test-first. The second RED used the same focused command and failed because the draft two-field success response did not match the required real/auth/database/mocks response.

Final focused command:

```bash
pnpm --filter @socos/api exec jest --runInBand \
  src/health/health.service.spec.ts \
  src/health/health.controller.spec.ts \
  src/app.module.spec.ts
```

Result: PASS, 3 suites and 15 tests.

Coverage proves:

- one `SELECT 1` call through Prisma;
- exact fixed success response;
- fixed sanitized 503 response on a synthetic credential-bearing database error;
- no secret, host, schema, stack, count, version, or latency output;
- `Cache-Control: no-store` metadata;
- no controller or handler guard, making the attestation publicly callable;
- unchanged legacy health response shape;
- complete `AppModule` dependency composition.

## Verification

```bash
pnpm --filter @socos/api type:check
```

PASS.

```bash
pnpm --filter @socos/api build
```

PASS.

```bash
pnpm --filter @socos/api lint
```

PASS with 0 errors and 290 existing repository warnings. No warning points to the health attestation files.

```bash
pnpm --filter @socos/api exec prettier --check \
  src/health/health.controller.ts \
  src/health/health.controller.spec.ts \
  src/health/health.service.ts \
  src/health/health.service.spec.ts
```

PASS.

```bash
node --experimental-strip-types --test \
  scripts/security-regression.test.mjs \
  scripts/docker-packaging.test.mjs
```

PASS, 61 tests.

```bash
node scripts/security-regression.mjs
```

PASS, 527 tracked files checked.

```bash
git diff --cached --check
```

PASS before commit.

## Concerns

- This task did not deploy or call the endpoint against a remote PostgreSQL instance. The production path is the tested Prisma `SELECT 1`; a failed runtime connection returns the fixed 503 and cannot produce a valid Betabots attestation.
- Unrelated Daily Cockpit, handoff, and agent-security work was already dirty in the shared worktree and was preserved without staging or modification by this commit.

## Independent Review Follow-Up

The independent review found that the original unit tests did not exercise the real Nest HTTP pipeline with `AllExceptionsFilter`. Added `src/health/health.http.spec.ts`, which boots a loopback Nest application with the `/api` prefix and the production exception filter, then calls the public routes without authentication headers.

Initial HTTP test command:

```bash
pnpm --filter @socos/api exec jest --runInBand \
  src/health/health.http.spec.ts
```

Result: unexpected GREEN baseline. `1` suite and `3` tests passed. The actual wire behavior already returned the exact Betabots JSON and `Cache-Control: no-store`; the filtered database failure was already a sanitized `503` with no synthetic exception, host, schema, or credential details. No production change was made.

Final focused command:

```bash
pnpm --filter @socos/api exec jest --runInBand \
  src/health/health.http.spec.ts \
  src/health/health.service.spec.ts \
  src/health/health.controller.spec.ts \
  src/app.module.spec.ts
```

Exact result:

```text
PASS src/health/health.http.spec.ts
PASS src/health/health.service.spec.ts
PASS src/app.module.spec.ts
PASS src/health/health.controller.spec.ts

Test Suites: 4 passed, 4 total
Tests:       18 passed, 18 total
Snapshots:   0 total
```

The HTTP coverage proves:

- unauthenticated success status `200`;
- success body exactly matches the official Betabots real-backend contract;
- success and failure both send `Cache-Control: no-store`;
- the real filtered failure status is `503` with the standard sanitized envelope;
- injected database exception, host, schema, user, credential, and connection-string details are absent;
- the legacy `/api/health-check` response remains `200` with its existing fields and does not query PostgreSQL.

Follow-up verification:

```bash
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
pnpm --filter @socos/api exec prettier --check src/health/health.http.spec.ts
git diff --check -- services/api/src/health/health.http.spec.ts
```

Result: every command passed.
