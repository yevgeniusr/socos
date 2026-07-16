# Task 7 Fix Report: Stabilize Derived Location History

## Status

Implemented the Task 7 reviewer fixes on `feat/calendar-location` from `111a538` using synthetic fixtures only. No production, Coolify, external location, or real personal data was accessed.

## RED Evidence

- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/visit-derivation.service.spec.ts`
  - RED: `deriveVisits` rejected the workload metrics argument because the linear resident accumulator API did not exist.
  - RED after strengthening: fixed-point expansion used only `recordedAt < start`; the test expected an exact-opening boundary query followed by a `(recordedAt,id)` predecessor query.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-retention.service.spec.ts`
  - RED: all three maintenance tests threw `unscoped locationDevice maintenance read` because devices were enumerated globally.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-context.service.spec.ts`
  - RED: selected sample context returned a future device `lastSeenAt`, and exact-six-hour event context fell back to Dubai instead of consulting the event-start stay.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-alias.service.spec.ts`
  - RED: PATCH omitted the persisted-row CAS timestamp and returned a process-local timestamp instead of Prisma `updatedAt`.
- The ingest recovery test was written before production changes and passed because the existing non-fatal handoff already retries naturally on the next newly inserted sample; duplicate coverage remained GREEN and no ingest implementation change was needed.

## Implementation

- Late departure stabilization now treats `departedAt === interval start` as a dependency, expands closed visits through departure plus 15 minutes, expands to the full visit start plus one stable tuple predecessor, and replaces obsolete intersecting rows atomically.
- The exact regression uses resident samples at `t0/t5/t10`, away evidence at `t12/t17`, and a late resident sample at `t16`; it verifies reopening/merging and stale-row deletion.
- Open visits whose resident raw samples expired use their existing owner-scoped encrypted centroid and row as the baseline. Nearby evidence leaves the row and envelope unchanged. A five-minute away run closes the same guarded row at its first away point and replays the away run for a new candidate.
- Resident centroid checks use a running inverse-accuracy weighted accumulator. Sustained open processing performs at most one accumulator add and centroid read per sample; final radius/source work remains one linear pass.
- Visit recomputation uses Prisma interactive transaction options `{ maxWait: 10000, timeout: 120000 }`.
- Retention pages non-private `User.id` values, then pages `LocationDevice` under each explicit `ownerId`. Revoked devices, per-device cutoffs, bounded 500-row deletes, and open-visit retention remain unchanged.
- Event context at six hours or less now resolves current sample, current open visit, event-start CityStay, then Dubai. Sample public `lastSeenAt` is the selected nonfuture sample timestamp.
- Alias PATCH uses owner/id/current-`updatedAt` CAS, re-reads the persisted row under owner scope, and returns Prisma `updatedAt`.
- A later newly inserted sample is covered as recovery after a swallowed derivation failure; duplicate delivery still never invokes derivation.

## Final Verification

- `pnpm --filter @socos/api exec jest --runInBand src/modules/location`
  - Result: 11/11 suites passed, 97/97 tests passed.
- `pnpm --filter @socos/api type:check`
  - Result: exit 0.
- `pnpm --filter @socos/api build`
  - Result: exit 0.
- `git diff --check`
  - Result: exit 0.

## Privacy, Scope, And Complexity Review

- The only owner-neutral maintenance read selects bounded `User.id` pages. All location-device reads include `ownerId`; all sample/visit reads and mutations include `ownerId` and `deviceId`.
- Persisted centroids are decrypted only inside the owner-scoped derivation service. No coordinate, envelope, ID, MAC, IV, tag, request body, credential, or private string is returned or logged.
- Public context remains field-whitelisted and coordinate-free.
- The open resident hot path is linear by structural operation counts, without timing assertions.
- No schema, external service, secondary store, or production operation was introduced.

## Concern

Real PostgreSQL concurrency and end-to-end transaction behavior remain assigned to Task 15. Adapter tests exercise the exact advisory-lock SQL path, Prisma transaction options, tuple ordering, owner/device predicates, and replacement mutations.
