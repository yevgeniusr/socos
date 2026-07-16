# Task 7 Report: Derive Private Location Context

## Status

Implemented Task 7 on `feat/calendar-location` from reviewed base `8b7ab41` using synthetic fixtures only. No production, Coolify, or external location data was accessed.

## RED Evidence

Each implementation slice started with behavior tests and an observed failure:

- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/visit-derivation.service.spec.ts`
  - RED: TypeScript could not resolve the absent `visit-derivation.service` module.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location.dto.spec.ts src/modules/location/location-alias.service.spec.ts`
  - RED: alias DTO exports and `location-alias.service` were absent.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-context.service.spec.ts`
  - RED: `location-context.service` was absent.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-retention.service.spec.ts`
  - RED: `location-retention.service` was absent.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-ingest.service.spec.ts src/modules/location/location.controller.spec.ts src/modules/location/location.module.spec.ts`
  - RED: post-insert derivation dependency and human alias/context controllers were absent.
- Derivation interval regression tests then failed with three predecessor lookups instead of two and an exclusive bound of `departedAt` instead of `departedAt + 1ms`.
- Alias patch validation then failed because explicit `null` was accepted by `@IsOptional`.

## GREEN Evidence

- Derivation focused run: 13/13 tests passed after interval corrections.
- Alias DTO focused run: 23/23 tests passed after omission-only patch validation.
- Integrated location verification:
  - `pnpm --filter @socos/api exec jest --runInBand src/modules/location`
  - Result: 11/11 suites passed, 91/91 tests passed.
- `pnpm --filter @socos/api type:check`
  - Result: exit 0.
- `pnpm --filter @socos/api build`
  - Result: exit 0.
- `git diff --check`
  - Result: exit 0.

## Implemented Files

- Added `visit-derivation.service.ts` and focused tests for exact thresholds, stable ordering, accuracy handling, inverse weighting, antimeridian centroids, away replay, late ordering, source identities, advisory serialization, bounded interval expansion, and envelope idempotency.
- Added `location-alias.service.ts` and tests for exact Unicode canonicalization, encrypted display values, owner-scoped CRUD, sanitized duplicates, isolation, and transactional Calendar CityStay rebuilds.
- Added `location-context.service.ts` and tests for current/event precedence, 30-minute and six-hour boundaries, half-open stays, deterministic ties, internal precise origins, public whitelisting, and Dubai fallback.
- Added `location-retention.service.ts` and tests for UTC scheduling, per-device cutoffs, revoked devices, strict cutoff boundaries, 500-row batches, 501-row pagination, owner/device constraints, and open-visit retention.
- Extended location DTOs, controllers, module wiring, and the Task 6 ingest service/spec narrowly for alias APIs and the newly inserted sample derivation hook.

## Privacy And Isolation Review

- Every owned read/mutation includes `ownerId`; device-derived and retention operations also include `deviceId`.
- Exact coordinates and centroids are decrypted only inside owner-scoped services and are never returned by the public controller.
- Alias display values and visit centroids use pre-generated IDs with exact AAD purposes.
- Source and alias MACs use owner-scoped domain separation.
- No request bodies, credentials, coordinates, identifiers, envelopes, IVs, tags, MACs, or private strings are logged.
- OwnTracks parser and credential race predicates remain unchanged; derivation runs only after a new committed sample, skips dedupe, and cannot fail an accepted ingest after durability.
- Retention has no ingest-flag dependency.

## Residual Boundary

Real PostgreSQL concurrency, transaction isolation, advisory-lock behavior, and end-to-end HTTP/database coverage remain Task 15 as specified. Task 7 exercises the production SQL tags, Prisma predicates, transactions, and cron metadata through adapter-level tests.
