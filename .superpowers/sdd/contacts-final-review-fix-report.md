# Contacts Final Review Fix Report

Date: 2026-07-17
Base HEAD: `0f2e5d6`

## Scope

- Human reminder creation now rejects demo contacts before persistence or notification.
- Contact detail, create, and update responses use owner-bound minimal nested projections.
- Interaction/reminder nested rows and their detail counts require owner parity; task/gift counts are preserved.
- Nested responses omit owner/source identifiers, unused interaction metadata, and reminder recurrence/internal metadata.
- Web contracts and synthetic fixtures match the reduced response exactly.
- Contacts pagination proof reaches offset 100 and verifies the six-row final page and disabled Next control.

No schema, dependency, deployment, or approval-boundary changes were made.

## RED Evidence

1. `pnpm --filter @socos/api test -- --runInBand src/modules/reminders/reminders.service.spec.ts`
   - Exit 1.
   - 1 failed, 13 passed.
   - `rejects human reminder creation for a demo contact` failed because the promise resolved with a created reminder instead of rejecting.
2. `pnpm --filter @socos/api exec jest --runInBand src/modules/contacts/contacts.service.spec.ts`
   - Exit 1.
   - 3 failed, 16 passed.
   - Detail, create, and update projection tests failed because nested `contactFields.select` was absent; the same exact contract also required owner filters and reduced interaction/reminder selects.

Both RED commands ran before production edits.

## GREEN Evidence

- `pnpm --filter @socos/api exec jest --runInBand src/modules/reminders/reminders.service.spec.ts`: 1 suite, 14/14 tests passed.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/contacts/contacts.service.spec.ts`: 1 suite, 19/19 tests passed.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/contacts src/modules/interactions src/modules/reminders`: 6 suites, 104/104 tests passed. The first broad run correctly exposed the stale demo-side-effects expectation; after aligning it with the required rejection contract, the full rerun passed.
- `pnpm --filter @socos/api type:check`: passed.
- `pnpm --filter @socos/api build`: passed.
- `pnpm --filter @socos/web test`: 4 files, 14/14 tests passed.
- `pnpm --filter @socos/web type:check`: passed after changing the exact fixture assertion from a widening annotation to `satisfies ContactDetail`.
- `pnpm --filter @socos/web lint`: passed with 0 errors and 38 existing warnings.
- `pnpm --filter @socos/web build`: passed; optimized production build completed.
- Local production server: `pnpm --filter @socos/web start -p 3010`; stopped after browser verification.
- `E2E_BASE_URL=http://127.0.0.1:3010 E2E_ALLOWED_HOSTS=127.0.0.1 pnpm --filter @socos/web exec playwright test e2e/contacts-workspace.spec.ts --project=chromium --workers=1`: 2/2 tests passed.
- Pixel repeat with the same environment and `--grep "Pixel viewport"`: 1/1 test passed.
- `node --test scripts/security-regression.test.mjs scripts/docker-packaging.test.mjs`: 58/58 tests passed.
- `node --experimental-strip-types --test scripts/e2e-host-policy.test.mjs`: 5/5 tests passed.
- `git diff --check`: passed before report creation and is rerun as the final pre-commit gate.

An initial convenience command combined `scripts/e2e-host-policy.test.mjs` with plain `node --test`; only that file failed because importing its TypeScript module requires `--experimental-strip-types`. The required security/package command passed independently, and the host-policy suite passed with its repository-standard Node flag.

## Files

- `.superpowers/sdd/contacts-final-review-fix-report.md`
- `apps/web/e2e/contacts-workspace.spec.ts`
- `apps/web/src/lib/contact-contracts.ts`
- `services/api/src/modules/contacts/contacts.service.spec.ts`
- `services/api/src/modules/contacts/contacts.service.ts`
- `services/api/src/modules/contacts/demo-side-effects.spec.ts`
- `services/api/src/modules/reminders/reminders.service.spec.ts`
- `services/api/src/modules/reminders/reminders.service.ts`

## Concerns

- No functional blocker remains.
- Web lint retains 38 pre-existing warnings outside this change's scope.
- No push or deployment was performed.
