# Task 14 Report: Personal-context deletion and aggregate audit

Status: DONE

## Summary

- Added authenticated `DELETE /personal-context` in `PersonalContextModule`.
- Owner is sourced only from `request.user.userId`.
- `Idempotency-Key` is validated untrimmed against `^[A-Za-z0-9._:-]{8,128}$`.
- Body must be exactly `{ "confirmation": "DELETE_PERSONAL_CONTEXT" }`.
- Response is limited to `deletedAt`, fixed categories, and aggregate row counts.
- Added aggregate append-only audit writes using `PersonalDataIndexService` MAC inputs exactly from the brief.
- Added owner-row locking, serializable transaction, ordered explicit owner-scoped `deleteMany` operations, and P2002/P2034 convergence.
- Prepared active/unexpired Google calendar stops before local deletion; only the transaction winner calls post-commit best-effort stop.
- Preserved CRM/contact/interaction/reminder/quest/XP/agent records by not deleting those delegates.
- Added scanner rules and fixtures for the personal-context deletion surface.

## TDD Evidence

Red:

- `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data/personal-context.controller.spec.ts src/modules/personal-data/personal-context-deletion.service.spec.ts`
  - Failed because `personal-context.controller.js` and `personal-context-deletion.service.js` did not exist.
- `node --test scripts/security-regression.test.mjs`
  - Failed 5 scanner tests because personal-context deletion fixtures were not detected and the real controller/service did not exist yet.

Green:

- Focused green check after implementation:
  - `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data/personal-context.controller.spec.ts src/modules/personal-data/personal-context-deletion.service.spec.ts services/api/src/modules/calendar/calendar-watch.service.spec.ts`
  - Result: 3 suites passed, 41 tests passed.
- Scanner green check after implementation:
  - `node --test scripts/security-regression.test.mjs`
  - Result: 43 tests passed.

## Final Verification

- `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data src/modules/events`
  - Result: 15 suites passed, 247 tests passed.
- `node --test scripts/security-regression.test.mjs`
  - Result: 43 tests passed.
- `node scripts/security-regression.mjs`
  - Result: `Security regression scan passed (474 tracked files checked).`
- `pnpm --filter @socos/api type:check`
  - Result: `tsc --noEmit` completed successfully.
- Extra composition check:
  - `pnpm --filter @socos/api exec jest --runInBand src/app.module.spec.ts`
  - Result: 1 suite passed, 10 tests passed.

## Concerns

- None.
