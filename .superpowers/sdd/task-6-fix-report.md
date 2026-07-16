# Task 6 Review Fix Report

## Status

DONE

Implemented all three Important Task 6 review fixes using synthetic fixtures only. No production system or real personal data was accessed, and no sensitive logging was added.

## RED/GREEN Evidence

### 1. Concurrent credential rotation

RED command:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-device.service.spec.ts
```

Observed RED: the concurrency test expected one fulfilled rotation but received zero because neither mutation supplied the old username required by the simulated compare-and-swap. Suite result: 1 failed, 6 passed.

Fix:

- Select the current username inside the owner-scoped active-device transaction.
- Include that exact username in the owner/id/status `updateMany` predicate.
- Return a fixed `409 credential_rotation_conflict` when the CAS count is zero.
- Strip the selected username from the returned device presentation.

GREEN result for the same command: 1 suite passed, 7 tests passed.

### 2. Guard-to-ingest rotation race

RED command:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location/owntracks-auth.guard.spec.ts src/modules/location/location-ingest.service.spec.ts
```

Observed RED:

- The guard principal lacked the expected authenticated username.
- The race regression expected unauthorized but ingest resolved to `[]`, proving a rotated credential could still pass id/owner/status-only revalidation.
- Suite result: 2 failed suites, 2 failed and 16 passed tests.

Fix:

- Carry the verified Basic username only in the internal `AuthenticatedLocationDevice` principal.
- Require that username in the transaction's owner-scoped active-device revalidation before insert.
- Require the same username in monotonic `lastSeenAt` predicates.
- Preserve the existing fixed `401 invalid_device_credentials` response and never expose/log the internal username.

GREEN covering command:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location/owntracks-auth.guard.spec.ts src/modules/location/location-ingest.service.spec.ts src/modules/location/location.controller.spec.ts
```

GREEN result: 3 suites passed, 22 tests passed.

### 3. URL-encoded parser regression

RED command:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-raw-body.middleware.spec.ts
```

Observed RED: the raw `application/x-www-form-urlencoded` route returned an empty body instead of the expected nested parsed form. Suite result: 1 failed, 5 passed.

Fix:

- Restore `express.urlencoded({ extended: true })` after the exact OwnTracks JSON parser and the general JSON parser.
- Leave OwnTracks restricted to `application/json` with the exact 8,192-byte limit.

GREEN result for the same command: 1 suite passed, 6 tests passed.

## Final Verification

The first integrated run after the fixes produced:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location src/app.module.spec.ts
Test Suites: 8 passed, 8 total
Tests:       59 passed, 59 total
```

```text
pnpm --filter @socos/api type:check
exit 0
```

```text
pnpm --filter @socos/api build
exit 0
```

Final fresh verification after formatting produced the same results:

```text
pnpm --filter @socos/api exec jest --runInBand src/modules/location src/app.module.spec.ts
Test Suites: 8 passed, 8 total
Tests:       59 passed, 59 total
Snapshots:   0 total
exit 0
```

```text
pnpm --filter @socos/api type:check
exit 0
```

```text
pnpm --filter @socos/api build
exit 0
```

```text
git diff --check
exit 0, no output
```

## Self-Review

- Two transactions reading the same current username cannot both satisfy the CAS predicate.
- CAS conflicts return no generated credential response and disclose no current username.
- All rotation predicates remain scoped by owner ID, internal device ID, and active status.
- The verified Basic username stays internal to the request principal and is absent from API responses and logs.
- Ingest cannot insert after credential rotation because its transaction revalidation includes the authenticated username.
- Existing JSON and extended URL-encoded parsing are restored without changing the OwnTracks parser's path, media type, byte limit, or sanitized parser errors.
- No rate limiting, deployment, production access, or unrelated refactor is included.

## Concerns

None.
