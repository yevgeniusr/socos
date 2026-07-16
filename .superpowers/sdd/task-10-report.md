# Task 10 Report: Event Discovery Schema And Rekey Coverage

## Status

DONE

## TDD Evidence

- RED: `pnpm --filter @socos/api exec jest --runInBand src/cli/rekey-personal-data.spec.ts` failed because the three event envelopes and 18-envelope aggregate counts were absent.
- RED: `node --test scripts/migration-safety.integration.test.mjs` failed because `20260716160000_event_discovery/migration.sql` was absent.
- GREEN: added the exact Prisma models, forward-only SQL, event envelope registry metadata, closed-world migration catalog/behavior tests, and DMMF registry completeness checks.

## Implementation

- Added `EventPreference`, `EventSource`, and `DiscoveredEvent` with owner relation arrays and compound source ownership.
- Added Migration 2 with exact columns, defaults, numeric precision/scale, indexes, cascading owner/source foreign keys, MAC/envelope checks, enums, ranges, country codes, time range, and coordinate-pair validation.
- Extended upgrade and fresh migration verification. Migration 1 is asserted before and after Migration 2; prior synthetic rows remain unchanged; fresh deploy performs schema diff and no-op redeploy.
- Registered `EventPreference.interestTags`, `EventSource.feedUrl`, and `DiscoveredEvent.providerEventId` with frozen AAD purposes.
- Increased fixed rekey coverage from 15 to 18 envelopes and moved interruption/resume coverage onto an event envelope. The generic CLI required no behavior change.
- Added a Prisma DMMF completeness test for exact envelope quartets, scalar types, nullability, mapped columns, duplicate keys, registry keys, and registry column metadata.

## Fresh Verification

- Prisma validate with synthetic URL: pass.
- Prisma generate with synthetic URL: pass.
- Rekey Jest suite: 25/25 pass.
- Disposable PostgreSQL migration safety suite: 8/8 pass.
- API typecheck: pass.
- API build: pass.
- Static migration safety suite: 3 pass, guarded database test skipped when no URL is supplied.
- Diff check: pass.

## Concerns

None. Disposable database verification used a synthetic local PostgreSQL 16 container; no configured or real database was accessed.
