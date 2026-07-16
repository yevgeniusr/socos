# Task 6 Report: Authenticated OwnTracks Ingest

## Status

DONE

Implemented authenticated Pixel/OwnTracks device lifecycle and location history ingest behind the literal `LOCATION_INGEST_ENABLED=true` gate. No production systems or real personal data were accessed; all tests use synthetic fixtures.

## TDD Evidence

Each behavior group was added before its implementation and executed RED, then rerun GREEN:

| Behavior group | RED evidence | GREEN evidence |
| --- | --- | --- |
| Exact 8 KiB parser and OwnTracks DTO | Jest failed because `location-raw-body.middleware` and `location.dto` did not exist. Custom future/course constraints then failed until registered. | Raw 8,192-byte JSON accepted; 8,193 rejected with sanitized 413; malformed JSON sanitized 400; general JSON route unaffected; DTO validation passed. |
| Device create/list/rotate/revoke | Jest failed because `location-device.service` did not exist. | Six tests passed for disabled short-circuiting, encryption/MAC before Prisma, one-time credentials, safe listing, transactional rotation, revocation, and owner isolation. |
| Basic device authentication | Jest failed because `owntracks-auth.guard` did not exist. | Nine tests passed for Basic-only locator resolution, ignored `X-Limit-U/D`, no scrypt for unknown usernames, disabled short-circuiting, revoked devices, and constant-shape 401 responses. |
| OwnTracks ingest | Jest failed because `location-ingest.service` did not exist. | Tests passed for exact canonical JSON, internal device ID binding, explicit nulls, negative-zero normalization, exact encrypted coordinates, plaintext exceptions only, old queued history, HMAC duplicates, owner scope, and monotonic `lastSeenAt`. |
| HTTP controllers | Jest failed because `location.controller` did not exist; the first GREEN attempt exposed and corrected a test mock typing error. | Four tests passed for JWT-only owner derivation, guard-resolved device use, `204` revocation, and explicit `200 []` ingest. |
| Location/App module wiring | Jest failed because `location.module` did not exist, then AppModule composition failed until `LocationModule` was imported. | Module composition and disabled boot passed. |
| Bootstrap parser wiring | Wiring test failed because Nest still used its default parser. | Bootstrap now creates Nest with `{ bodyParser: false }` and installs the exact OwnTracks parser before general routing. |
| JSON type preservation | Real application `ValidationPipe` tests initially accepted numeric strings, explicit null, and numeric `tid`. | Raw JSON types are preserved through transformation and invalid coercions are rejected. |

## Files

Created:

- `services/api/src/modules/location/location.dto.ts`
- `services/api/src/modules/location/location.dto.spec.ts`
- `services/api/src/modules/location/location-raw-body.middleware.ts`
- `services/api/src/modules/location/location-raw-body.middleware.spec.ts`
- `services/api/src/modules/location/location-device.service.ts`
- `services/api/src/modules/location/location-device.service.spec.ts`
- `services/api/src/modules/location/owntracks-auth.guard.ts`
- `services/api/src/modules/location/owntracks-auth.guard.spec.ts`
- `services/api/src/modules/location/location-ingest.service.ts`
- `services/api/src/modules/location/location-ingest.service.spec.ts`
- `services/api/src/modules/location/location.controller.ts`
- `services/api/src/modules/location/location.controller.spec.ts`
- `services/api/src/modules/location/location.module.ts`
- `services/api/src/modules/location/location.module.spec.ts`

Modified:

- `services/api/src/main.ts`
- `services/api/src/app.module.ts`
- `services/api/src/app.module.spec.ts`

## Verification

- `pnpm --filter @socos/api exec jest --runInBand src/modules/location src/app.module.spec.ts`: final fresh run passed 8 suites and 56 tests.
- `pnpm --filter @socos/api type:check`: final fresh run exited 0.
- `pnpm --filter @socos/api build`: final fresh run exited 0.

## Security Review

- Basic auth is the only public device identity source; optional OwnTracks identification headers are ignored.
- Unknown usernames return before scrypt.
- Human operations derive owner identity only from `request.user.userId`.
- After global username locator resolution, every lookup and mutation includes the resolved owner ID.
- Display name, external device ID, and precise coordinate JSON are encrypted before Prisma.
- Only documented sample plaintext exceptions are stored.
- Payload deduplication MACs exact canonical JSON, never raw request bytes.
- No request body, auth header, coordinate, credential, ciphertext, IV, tag, or MAC logging was added.
- Duplicate and accepted deliveries return `200 []`; old samples cannot lower `lastSeenAt`.

## Concerns

None. Task 16 still owns internet-facing rate limiting and runtime deployment configuration, so no rate limiter or deployment change is included here.
