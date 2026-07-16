# Calendar, Location, And Event Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Yev's daily Social Brief read-only Google Calendar context, direct Pixel location history, and up to three explainable nearby event suggestions without introducing a second personal-data store or any autonomous external write.

**Architecture:** Coolify PostgreSQL remains the only source of truth for real data. Application-level AES-256-GCM encrypts secrets, private strings, provider identifiers, and precise coordinates; a separate stable HMAC-SHA-256 index key supports equality lookup and deduplication without storing plaintext. Google Calendar is read-only, OwnTracks posts directly from Android over authenticated HTTPS, and an allowlisted, DNS-pinned ICS adapter supplies operator-certified public events. All recommendations remain reversible suggestions governed by feature flags.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11, Prisma 6/PostgreSQL 15, Jest 29, `@nestjs/schedule`, Node `crypto`, `googleapis@173.0.0`, `ical.js@2.2.1`, pnpm 10.10.0.

## Global Constraints

- Keep all real Calendar, location, OAuth, and event data in Coolify PostgreSQL. Never download, inspect, print, or copy production rows to a workstation. Tests and local fixtures use synthetic values only.
- Do not use, scrape, or automate Google Maps Location Sharing or Timeline. OwnTracks Android precise history is the only location ingress in this release.
- Calendar is read-only. Request exactly `calendar.calendarlist.readonly` and `calendar.events.readonly`; never request identity, profile, or write scopes.
- The Pixel posts directly over authenticated HTTPS in OwnTracks HTTP mode. Do not introduce MQTT, Home Assistant, or another location database.
- Never log request bodies, authorization headers, coordinates, plaintext/ciphertext/IV/tag/MAC values, OAuth codes, provider response bodies, provider errors, private URLs, or secrets. Production diagnostics are aggregate counts, status codes from a fixed allowlist, and timestamps only.
- All human queries and mutations derive `ownerId` only from `request.user.userId`. Device and provider callbacks resolve an opaque globally unique locator, then scope every subsequent query and mutation by the resolved `ownerId`.
- Calendar is read-only; event discovery is read-only; event brief items are suggestions only. No ticket purchase, invitation, Calendar write, message, attendance claim, or autonomous external side effect is permitted.
- Ship behind `CALENDAR_SYNC_ENABLED`, `LOCATION_INGEST_ENABLED`, `EVENT_DISCOVERY_ENABLED`, and `EVENT_BRIEF_ENABLED`. Parse only the literal string `true` as enabled; missing, empty, `false`, `0`, and malformed values are disabled.
- Preserve all applied migrations. New migrations are additive and forward-only. Rollback disables flags and deploys the prior image; it never runs down migrations or removes required keys.
- Use test-first development. Each task below is an independently reviewable and revertible commit.

## Privacy And Encryption Contract

### Application-encrypted fields

Encrypt these before calling Prisma and decrypt only inside owner-scoped services:

- OAuth PKCE verifiers and Google refresh tokens.
- Google Calendar list/event sync tokens.
- Calendar external source IDs, event IDs, recurring event IDs, watch resource IDs, source names, event summary/location/self-response details.
- OwnTracks device display names, external device IDs, exact sample coordinates, and derived visit centroids.
- Location alias input text.
- Private ICS feed URLs, provider event UIDs, and owner interest tags.

Each independently updated value has its own `*Ciphertext Bytes`, `*Iv Bytes`, `*Tag Bytes`, and `*KeyVersion Int` columns. AES-256-GCM uses a random 12-byte IV, a 16-byte tag, and AAD `socos:v1:<purpose>:<ownerId>:<recordId>`. The service generates the record ID before encryption. Ciphertext is UTF-8 JSON.

`PERSONAL_DATA_KEYS` is a JSON array rather than a JSON object so duplicate versions remain observable:

```json
[{"version":1,"key":"<base64-encoded-32-byte-key>"}]
```

Reject duplicate/non-positive versions, non-canonical base64, wrong key lengths, an absent active version, trailing fields, or an empty keyring. `PERSONAL_DATA_ACTIVE_KEY_VERSION` is a positive base-10 integer present in the keyring. Startup fails closed whenever any Calendar, location, event-discovery, or rekey path is enabled and this configuration is invalid. Unit tests inject synthetic configuration directly.

### Equality and deduplication MACs

`PERSONAL_DATA_INDEX_KEY` is one canonical base64-encoded 32-byte key used only for HMAC-SHA-256. Store lowercase 64-hex MACs. Domain-separated input is `socos:index:v1:<purpose>:<ownerId>\0<canonical-value>`. Use it for OAuth state, Calendar external IDs, watch resource IDs/tokens, OwnTracks device names/external IDs/payload deduplication, location aliases, feed URLs, provider event IDs, canonical events, deletion audit owner references, and visit source identity.

`PERSONAL_DATA_INDEX_KEY` is stable for this release and is not changed by the encryption rekey command. Rotation requires a separate future migration that recomputes every MAC atomically. Keep it in the runtime secret store and through the 30-day backup expiry window.

For OwnTracks, canonicalize the validated object as ordered UTF-8 JSON with exactly `deviceId,tst,lat,lon,acc,alt,vel,cog,batt,t`. Accept JSON numbers only, convert negative zero to zero, preserve the parsed finite IEEE-754 value, use integer seconds for `tst`, and write explicit `null` for missing optional values. The stored `payloadMac` is HMAC over that canonical form; never store or hash the raw request.

For aliases, canonicalize with Unicode NFKC, trim leading/trailing whitespace, collapse each internal whitespace run to one ASCII space, and apply `toLocaleLowerCase('en-US')` before MAC. Store the original trimmed Unicode NFC text only inside the encrypted alias envelope.

### Explicit queryable plaintext exceptions

The following values may remain plaintext in cloud PostgreSQL because scheduling, retention, ranking, or operations require indexed queries. PostgreSQL volumes and backups remain encrypted by the cloud/backup controls:

- Internal CUIDs, owner IDs, opaque random UUID channel IDs, statuses, feature-neutral error codes, leases, message numbers, and timestamps.
- Calendar start/end/date/time-zone, all-day, transparency, and source primary/selected flags.
- Location recorded/received times, accuracy, battery, trigger, retention settings, visit time/radius/confidence, and coarse city/country/time-zone.
- Operator-certified public event title/excerpt/URL/time/venue/address/city/country/coordinates/category/tags.
- Brief event title/reason and redacted evidence described in Task 13.

No private calendar/location display string or exact coordinate is included in these exceptions. An ICS host may be enabled only when an operator has certified that its event contents are public; a secret feed URL does not make private event contents eligible for plaintext storage.

## Fixed External Contracts

### Google Calendar

Scopes:

```text
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
```

Human JWT endpoints:

```text
POST   /api/integrations/google-calendar/connect
GET    /api/integrations/google-calendar
PATCH  /api/integrations/google-calendar/calendars/:sourceId
DELETE /api/integrations/google-calendar
```

Public provider callbacks with their own validation:

```text
GET  /api/integrations/google-calendar/callback
POST /api/integrations/google-calendar/webhook
```

`connect` creates an attempt CUID plus a random 32-byte secret and sends state as `<attemptId>.<base64url-secret>`. The attempt ID is only an opaque callback locator; the stored state MAC binds the secret to the resolved attempt owner. State is valid for 10 minutes and one use. The callback accepts only `state`, `code`, and provider `error`; it atomically consumes state before exchange, verifies the two exact granted scopes, encrypts the refresh token, and redirects only to `GOOGLE_CALENDAR_SETTINGS_RESULT_URL` with a fixed `calendar=connected|error` value. It never accepts owner, redirect URI, or scopes from request input. The webhook validates channel ID, resource MAC, token MAC, and a strictly increasing message number, durably records pending sync, and then returns `204` without provider work.

### Pixel Location

Human JWT endpoints:

```text
POST   /api/location-devices
GET    /api/location-devices
POST   /api/location-devices/:deviceId/rotate
DELETE /api/location-devices/:deviceId
GET    /api/location-context/current
POST   /api/location-aliases
GET    /api/location-aliases
PATCH  /api/location-aliases/:aliasId
DELETE /api/location-aliases/:aliasId
```

Device endpoint:

```text
POST /api/location/owntracks
Authorization: Basic <generated-opaque-username:one-time-password>
Content-Type: application/json
```

The username is a random global authentication locator, not an OwnTracks or user identity. Creation and rotation return the password exactly once. Accepted, expired-old, and duplicate posts return `200` with JSON `[]`. `GET /api/location-context/current` returns source, coarse city/time-zone when known, distance capability, and `lastSeenAt`, never coordinates.

### Event Sources And Deletion

Human JWT endpoints:

```text
POST   /api/event-sources
GET    /api/event-sources
PATCH  /api/event-sources/:sourceId
DELETE /api/event-sources/:sourceId
PUT    /api/event-preferences
DELETE /api/personal-context
```

`DELETE /api/personal-context` requires `Idempotency-Key` and body `{ "confirmation": "DELETE_PERSONAL_CONTEXT" }`. It derives the owner from JWT, deletes live Calendar/location/event records plus event BriefItems/BriefFeedback, leaves CRM data intact, and writes an aggregate append-only deletion audit without plaintext owner identity.

V1 accepts only `provider='ics'`. A source URL must use HTTPS, contain no userinfo, and have an exact hostname in `EVENT_SOURCE_ALLOWED_HOSTS`. Adding a host to this runtime allowlist is the operator's certification that event contents from that host are public. Responses return only the allowed host, never the URL.

```ts
interface EventDiscoveryAdapter {
  readonly provider: 'ics';
  discover(
    source: EventSourceConfig,
    window: { from: Date; to: Date },
    signal: AbortSignal,
  ): Promise<NormalizedEvent[]>;
}
```

## Exact Data Model

All IDs are `String @id @default(cuid())`. All `DateTime` columns use PostgreSQL `TIMESTAMP(3)`, all ciphertext/IV/tag columns use Prisma `Bytes`/PostgreSQL `BYTEA`, all arrays default to `[]`, and every model with `ownerId` has `owner User @relation(... onDelete: Cascade)` plus the matching `User` relation array. Child relations use compound owner FKs. SQL names below are normative. Primary keys, unique indexes, ordinary indexes, and foreign keys use Prisma's exact default names (`<Model>_pkey`, `<Model>_<fields>_key`, `<Model>_<fields>_idx`, and `<Model>_<fields>_fkey`). Every check uses `<Model>_<subject>_check`; the append-only function and trigger are `reject_personal_data_deletion_audit_change` and `PersonalDataDeletionAudit_append_only`.

### Migration 1: `20260716150000_calendar_location`

```text
GoogleOAuthAttempt
  id String PK; ownerId String; stateMac String UNIQUE; pkceCiphertext Bytes;
  pkceIv Bytes; pkceTag Bytes; pkceKeyVersion Int; expiresAt DateTime;
  consumedAt DateTime?; createdAt DateTime default now
  unique(id,ownerId); index(ownerId,expiresAt,consumedAt)
  owner FK -> User(id) ON DELETE CASCADE

GoogleCalendarConnection
  id String PK; ownerId String UNIQUE; refreshTokenCiphertext Bytes;
  refreshTokenIv Bytes; refreshTokenTag Bytes; refreshTokenKeyVersion Int;
  grantedScopes String[] default []; status String default 'active';
  calendarListSyncTokenCiphertext Bytes?; calendarListSyncTokenIv Bytes?;
  calendarListSyncTokenTag Bytes?; calendarListSyncTokenKeyVersion Int?;
  calendarListPendingAt DateTime?; calendarListLeaseUntil DateTime?;
  lastFullReconciledAt DateTime?; lastSyncedAt DateTime?; errorCode String?;
  createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(id,ownerId); index(status,calendarListPendingAt,calendarListLeaseUntil)
  owner FK -> User(id) ON DELETE CASCADE

CalendarSource
  id String PK; connectionId String; ownerId String; externalIdMac String;
  externalIdCiphertext Bytes; externalIdIv Bytes; externalIdTag Bytes;
  externalIdKeyVersion Int; nameCiphertext Bytes; nameIv Bytes; nameTag Bytes;
  nameKeyVersion Int; timeZone String?; selected Boolean default false;
  isPrimary Boolean default false; syncTokenCiphertext Bytes?; syncTokenIv Bytes?;
  syncTokenTag Bytes?; syncTokenKeyVersion Int?; fullSyncRequired Boolean default true;
  pendingSyncAt DateTime?; syncLeaseUntil DateTime?; lastFullReconciledAt DateTime?;
  lastSyncedAt DateTime?; errorCode String?; createdAt DateTime default now;
  updatedAt DateTime updatedAt
  unique(connectionId,externalIdMac); unique(id,ownerId)
  index(ownerId,selected); index(pendingSyncAt,syncLeaseUntil)
  (connectionId,ownerId) FK -> GoogleCalendarConnection(id,ownerId) ON DELETE CASCADE

CalendarWatch
  id String PK; connectionId String; ownerId String; targetType String;
  targetKey String; channelId String UNIQUE; resourceIdMac String;
  resourceIdCiphertext Bytes; resourceIdIv Bytes; resourceIdTag Bytes;
  resourceIdKeyVersion Int; tokenMac String; status String default 'active';
  expiresAt DateTime; lastMessageNumber BigInt?; createdAt DateTime default now;
  updatedAt DateTime updatedAt
  unique(id,ownerId); index(connectionId,targetType,targetKey,status);
  index(status,expiresAt)
  (connectionId,ownerId) FK -> GoogleCalendarConnection(id,ownerId) ON DELETE CASCADE
  No unique constraint exists on (connectionId,targetType,targetKey); overlapping active
  replacement rows are required during renewal.

CalendarEvent
  id String PK; ownerId String; sourceId String; externalEventIdMac String;
  externalEventIdCiphertext Bytes; externalEventIdIv Bytes; externalEventIdTag Bytes;
  externalEventIdKeyVersion Int; status String default 'confirmed'; startAt DateTime?;
  endAt DateTime?; startDate DateTime? @db.Date; endDate DateTime? @db.Date;
  allDay Boolean default false;
  timeZone String?; transparency String default 'opaque'; recurringEventIdMac String?;
  recurringEventIdCiphertext Bytes?; recurringEventIdIv Bytes?;
  recurringEventIdTag Bytes?; recurringEventIdKeyVersion Int?;
  originalStartAt DateTime?; detailsCiphertext Bytes?; detailsIv Bytes?;
  detailsTag Bytes?; detailsKeyVersion Int?; sourceUpdatedAt DateTime?;
  createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(sourceId,externalEventIdMac); unique(id,ownerId)
  index(ownerId,startAt,endAt,status); index(sourceId,status)
  (sourceId,ownerId) FK -> CalendarSource(id,ownerId) ON DELETE CASCADE

LocationDevice
  id String PK; ownerId String; nameMac String; nameCiphertext Bytes;
  nameIv Bytes; nameTag Bytes; nameKeyVersion Int; username String UNIQUE;
  credentialHash String; externalDeviceIdMac String;
  externalDeviceIdCiphertext Bytes; externalDeviceIdIv Bytes;
  externalDeviceIdTag Bytes; externalDeviceIdKeyVersion Int;
  status String default 'active'; rawRetentionDays Int default 90;
  derivedRetentionDays Int default 730; lastSeenAt DateTime?;
  createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(ownerId,nameMac); unique(ownerId,externalDeviceIdMac); unique(id,ownerId)
  index(ownerId,status)
  owner FK -> User(id) ON DELETE CASCADE

LocationSample
  id String PK; ownerId String; deviceId String; recordedAt DateTime;
  receivedAt DateTime; coordinatesCiphertext Bytes; coordinatesIv Bytes;
  coordinatesTag Bytes; coordinatesKeyVersion Int; accuracyM Float?;
  batteryPercent Int?; trigger String?; payloadMac String;
  createdAt DateTime default now
  unique(deviceId,payloadMac); unique(id,ownerId)
  index(ownerId,recordedAt); index(deviceId,recordedAt)
  (deviceId,ownerId) FK -> LocationDevice(id,ownerId) ON DELETE CASCADE

DerivedVisit
  id String PK; ownerId String; deviceId String; arrivedAt DateTime;
  departedAt DateTime?; centroidCiphertext Bytes; centroidIv Bytes;
  centroidTag Bytes; centroidKeyVersion Int; radiusM Float; confidence Float;
  sourceMac String; derivationVersion Int default 1;
  createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(deviceId,sourceMac); unique(id,ownerId)
  index(ownerId,arrivedAt,departedAt); index(deviceId,arrivedAt)
  (deviceId,ownerId) FK -> LocationDevice(id,ownerId) ON DELETE CASCADE

LocationAlias
  id String PK; ownerId String; aliasMac String; aliasCiphertext Bytes;
  aliasIv Bytes; aliasTag Bytes; aliasKeyVersion Int; city String;
  countryCode String; timeZone String; createdAt DateTime default now;
  updatedAt DateTime updatedAt
  unique(ownerId,aliasMac); unique(id,ownerId); index(ownerId,city)
  owner FK -> User(id) ON DELETE CASCADE

CityStay
  id String PK; ownerId String; startsAt DateTime; endsAt DateTime?;
  city String; countryCode String; timeZone String; source String;
  sourceId String; confidence Float; createdAt DateTime default now;
  updatedAt DateTime updatedAt
  unique(ownerId,source,sourceId); unique(id,ownerId)
  index(ownerId,startsAt,endsAt)
  owner FK -> User(id) ON DELETE CASCADE

PersonalDataDeletionAudit
  id String PK; ownerMac String; idempotencyKeyMac String UNIQUE;
  requestMac String; categories String[] default [];
  calendarRowCount Int default 0; locationRowCount Int default 0;
  eventRowCount Int default 0; deletedAt DateTime; createdAt DateTime default now
  index(ownerMac,deletedAt)
  No User FK; SQL trigger rejects UPDATE and DELETE.
```

Migration 1 SQL checks:

- Every `*KeyVersion` is positive when its encrypted envelope is present. Optional envelopes require all four fields null or all four non-null.
- Every IV is exactly 12 bytes and tag exactly 16 bytes. Every `*Mac` is lowercase 64-hex.
- Connection status is `active|needs_reauth|disconnected`; watch target type is `calendar_list|events`; watch status is `active|stopping`; Calendar event status is `confirmed|tentative|cancelled`; transparency is `opaque|transparent`; device status is `active|revoked`; CityStay source is `calendar`.
- Raw retention is `30..365`; derived retention is `90..3650`; accuracy/radius are finite and nonnegative; battery is `0..100`; confidence is finite in `0..1`.
- Non-cancelled Calendar events require both `startAt` and `endAt` with `endAt > startAt` plus a complete details envelope. Cancelled tombstones may have both times and details null. All-day rows require both dates with `endDate > startDate`; timed rows require both date fields null.
- Visits/stays require a null end or end after start. Audit row counts are nonnegative.
- Location usernames are exactly 32 base64url characters; credential hashes match the fixed scrypt format. Audit owner/idempotency/request MACs satisfy the 64-hex MAC rule.

`CalendarEventDetails`, `PreciseCoordinates`, and `VisitCentroid` are exact:

```ts
type CalendarEventDetails = {
  summary: string;
  locationText: string | null;
  selfResponseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction' | null;
};
type PreciseCoordinates = {
  lat: number;
  lon: number;
  alt: number | null;
  cog: number | null;
  vel: number | null;
};
type VisitCentroid = { lat: number; lon: number };
type EventInterestTags = string[];
```

### Migration 2: `20260716160000_event_discovery`

```text
EventPreference
  id String PK; ownerId String UNIQUE; interestTagsCiphertext Bytes;
  interestTagsIv Bytes; interestTagsTag Bytes; interestTagsKeyVersion Int;
  maxDistanceKm Decimal(6,2) default 50; travelSpeedKph Int default 30;
  travelBufferMinutes Int default 15; createdAt DateTime default now;
  updatedAt DateTime updatedAt; unique(id,ownerId)
  owner FK -> User(id) ON DELETE CASCADE

EventSource
  id String PK; ownerId String; provider String default 'ics';
  externalSourceId String; name String; feedUrlMac String; feedUrlCiphertext Bytes;
  feedUrlIv Bytes; feedUrlTag Bytes; feedUrlKeyVersion Int; allowedHost String;
  city String?; countryCode String?; socialWeight Int default 5;
  status String default 'active'; pollIntervalMinutes Int default 60;
  nextPollAt DateTime; leaseUntil DateTime?; lastPolledAt DateTime?;
  errorCode String?; createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(ownerId,provider,externalSourceId); unique(ownerId,feedUrlMac);
  unique(id,ownerId); index(status,nextPollAt,leaseUntil)
  owner FK -> User(id) ON DELETE CASCADE

DiscoveredEvent
  id String PK; ownerId String; sourceId String; providerEventIdMac String;
  providerEventIdCiphertext Bytes; providerEventIdIv Bytes;
  providerEventIdTag Bytes; providerEventIdKeyVersion Int; canonicalMac String;
  title String; descriptionExcerpt String?; url String?; startAt DateTime;
  endAt DateTime; timeZone String?; venueName String?; address String?;
  city String?; countryCode String?; latitude Decimal(9,6)?;
  longitude Decimal(9,6)?; category String?; tags String[] default [];
  status String default 'scheduled'; sourceUpdatedAt DateTime?;
  discoveredAt DateTime default now; expiresAt DateTime;
  createdAt DateTime default now; updatedAt DateTime updatedAt
  unique(sourceId,providerEventIdMac); unique(id,ownerId);
  index(ownerId,startAt,status,city); index(sourceId,canonicalMac)
  (sourceId,ownerId) FK -> EventSource(id,ownerId) ON DELETE CASCADE
```

Migration 2 checks: provider is `ics`; source status is `active|disabled|error`; discovered status is `scheduled|cancelled|expired`; preference-tags/feed/UID envelopes and MACs satisfy the encryption rules; social weight is `0..10`; poll interval is `15..1440`; max distance is `1..500`; speed is `1..300`; buffer is `0..240`; event end is after start; coordinates are legal and both null or both non-null; country code is null or two uppercase ASCII letters.

## Task Sequence

### Task 1: Build The Versioned Cipher Boundary Only

**Files:**
- Create: `services/api/src/modules/personal-data/personal-data-cipher.service.ts`
- Create: `services/api/src/modules/personal-data/personal-data-cipher.service.spec.ts`
- Create: `services/api/src/modules/personal-data/personal-data.module.ts`

**Interfaces:**

```ts
type EncryptedValue = { ciphertext: Buffer; iv: Buffer; tag: Buffer; keyVersion: number };
interface PersonalDataCipherService {
  encrypt<T>(purpose: string, ownerId: string, recordId: string, value: T): EncryptedValue;
  decrypt<T>(purpose: string, ownerId: string, recordId: string, value: EncryptedValue): T;
}
```

- [ ] Write failing tests for strict keyring parsing, duplicate versions, active/old key behavior, random IVs, exact AAD isolation, malformed envelopes, canonical JSON round trips, and redacted errors. Tests inject synthetic keys and never print them.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data/personal-data-cipher.service.spec.ts`; expect failures from the missing service.
- [ ] Implement the service and module without Prisma, CLI code, `AppModule` imports, or production environment access.
- [ ] Run the same Jest command and `pnpm --filter @socos/api type:check`; expect pass.
- [ ] Commit: `feat(api): add versioned personal data cipher`

### Task 2: Build The Stable HMAC Index Boundary

**Files:**
- Create: `services/api/src/modules/personal-data/personal-data-index.service.ts`
- Create: `services/api/src/modules/personal-data/personal-data-index.service.spec.ts`
- Modify: `services/api/src/modules/personal-data/personal-data.module.ts`

**Interfaces:**

```ts
interface PersonalDataIndexService {
  mac(purpose: string, ownerId: string, canonicalValue: string): string;
  verify(mac: string, purpose: string, ownerId: string, canonicalValue: string): boolean;
}
```

- [ ] Write failing tests for strict canonical key parsing, domain-separated owner/purpose inputs, lowercase 64-hex output, timing-safe comparison, malformed MAC rejection, and redacted errors.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data/personal-data-index.service.spec.ts`; expect failure from the missing service.
- [ ] Implement HMAC only; do not add model-specific canonicalizers or Prisma access.
- [ ] Run the same Jest command and `pnpm --filter @socos/api type:check`; expect pass.
- [ ] Commit: `feat(api): add private equality index boundary`

### Task 3: Build Device Credentials And Safe Runtime Configuration

**Files:**
- Create: `services/api/src/modules/personal-data/device-credential.service.ts`
- Create: `services/api/src/modules/personal-data/device-credential.service.spec.ts`
- Create: `services/api/src/modules/personal-data/personal-data-config.ts`
- Create: `services/api/src/modules/personal-data/personal-data-config.spec.ts`
- Create: `services/api/src/common/safe-provider-error.ts`
- Create: `services/api/src/common/safe-provider-error.spec.ts`
- Modify: `services/api/src/common/filters/http-exception.filter.ts`
- Modify: `services/api/src/common/filters/http-exception.filter.spec.ts`

OwnTracks credentials use a random 24-byte base64url username and random 32-byte base64url password. Store only `scrypt$32768$8$1$<16-byte-salt-b64url>$<32-byte-hash-b64url>`, with `maxmem=64 MiB`, and compare equal-length buffers using `timingSafeEqual`. Rotation itself remains a Task 6 database transaction.

- [ ] Write failing tests for credential format/verification, malformed hashes, timing-safe comparison, literal-true feature flags, conditional fail-closed key configuration, and provider-error conversion to fixed codes without message/config/response leakage.
- [ ] Write failing filter tests proving unhandled provider exceptions are reported only as sanitized error objects and that Sentry receives neither request body/query nor the original exception. Disable Sentry request-body capture for this path.
- [ ] Implement the minimum services/config/filter changes; allowed provider codes are fixed internal strings such as `google_rate_limited`, `google_invalid_grant`, `ics_timeout`, and `ics_invalid_response`. When all four feature flags are disabled, absent crypto/provider configuration does not break the existing app; crypto-dependent human endpoints return sanitized `503 integration_not_configured`. Enabling a dependent flag makes startup validate and fail closed.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data src/common` and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): add safe credentials and provider errors`

### Task 4: Apply The Exact Calendar And Location Schema

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716150000_calendar_location/migration.sql`
- Modify: `scripts/migration-safety.integration.test.mjs`

- [ ] Extend static and disposable-DB tests for every Migration 1 table, column type/default, named check/index/FK, append-only audit trigger, fresh deploy, upgrade deploy, and unchanged preexisting columns. Use only synthetic rows.
- [ ] Preserve the current database-name prefix guard and additionally require an `_test` suffix. A valid basename is `socos_migration_test_calendar_test`. Never print the URL.
- [ ] Run `TEST_DATABASE_URL=<disposable-socos_migration_test_calendar_test-url> node --test scripts/migration-safety.integration.test.mjs`; confirm missing-table failure before the migration.
- [ ] Add Prisma models, all relation arrays, and hand-authored forward-only SQL exactly as specified above. Do not inspect or backfill rows.
- [ ] Run `DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic pnpm --filter @socos/api exec prisma validate --schema prisma/schema.prisma`, `DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic pnpm --filter @socos/api exec prisma generate --schema prisma/schema.prisma`, the disposable migration command above, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(db): add encrypted calendar and location schema`

### Task 5: Add A Resumable Calendar And Location Rekey Command

**Files:**
- Create: `services/api/src/cli/rekey-personal-data.ts`
- Create: `services/api/src/cli/rekey-personal-data.spec.ts`
- Modify: `services/api/package.json`
- Modify: `services/api/Dockerfile`
- Modify: `Dockerfile`
- Modify: `scripts/docker-packaging.test.mjs`

The command scans every Migration 1 encrypted envelope by `(keyVersion,id)` pages of at most `batch-size`, decrypts and re-encrypts each row with unchanged purpose/owner/record AAD, and updates with `WHERE id=? AND oldKeyVersion=?` inside bounded transactions. Resume requires no external checkpoint because already-rekeyed rows no longer match the source version. `--dry-run` reports model names and aggregate counts only. It never prints IDs or values.

- [ ] Write failing unit tests for argument validation, dry run, every Migration 1 envelope, bounded batches, compare-and-set contention, interruption/resume, aggregate-only output, and failure when `from` equals `to` or either key is unavailable.
- [ ] Implement `personal-data:rekey` as `node dist/cli/rekey-personal-data.js`; document that production invocation uses the built image.
- [ ] Extend both Dockerfiles and packaging tests to require `dist/cli/rekey-personal-data.js` in the builder and runtime image.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/cli/rekey-personal-data.spec.ts`, `pnpm --filter @socos/api build`, `node --test scripts/docker-packaging.test.mjs`, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): rekey calendar and location envelopes`

### Task 6: Authenticate Devices And Ingest OwnTracks Through An 8 KiB Parser

**Files:**
- Create: `services/api/src/modules/location/location.dto.ts`
- Create: `services/api/src/modules/location/location-raw-body.middleware.ts`
- Create: `services/api/src/modules/location/location-raw-body.middleware.spec.ts`
- Create: `services/api/src/modules/location/location-device.service.ts`
- Create: `services/api/src/modules/location/location-device.service.spec.ts`
- Create: `services/api/src/modules/location/owntracks-auth.guard.ts`
- Create: `services/api/src/modules/location/owntracks-auth.guard.spec.ts`
- Create: `services/api/src/modules/location/location-ingest.service.ts`
- Create: `services/api/src/modules/location/location-ingest.service.spec.ts`
- Create: `services/api/src/modules/location/location.controller.ts`
- Create: `services/api/src/modules/location/location.controller.spec.ts`
- Create: `services/api/src/modules/location/location.module.ts`
- Modify: `services/api/src/main.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/app.module.spec.ts`

Create Nest with `bodyParser:false`. Register an exact 8 KiB JSON parser for `/api/location/owntracks`, then the existing general JSON parser for other routes. Convert parser overflow to `413` without logging body content. Validate `_type='location'`, required `tst/lat/lon`, optional `acc/alt/vel/cog/batt/t/tid`, legal finite ranges, nonnegative accuracy/velocity, battery `0..100`, and timestamps no more than 10 minutes in the future.

- [ ] Write failing middleware/e2e tests using raw HTTP bytes for 8,192-byte acceptance, 8,193-byte rejection, malformed JSON, and unaffected existing routes.
- [ ] Write failing service/controller tests for literal-false flag, Basic auth, owner isolation after locator resolution, `X-Limit-U/D`, transactional credential rotation, old queued samples, HMAC duplicate delivery, exact encrypted coordinates, no raw payload, monotonically increasing `lastSeenAt`, and `200 []` responses.
- [ ] Implement device CRUD/rotation/revocation and ingest. Do not run scrypt for an unknown opaque username; return a constant-shape unauthorized response. Task 16 applies the internet-facing route rate limit.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/location src/app.module.spec.ts`, typecheck, and build.
- [ ] Commit: `feat(api): ingest authenticated owntracks history`

### Task 7: Derive Visits, Resolve Context, And Enforce Retention

**Files:**
- Create: `services/api/src/modules/location/visit-derivation.service.ts`
- Create: `services/api/src/modules/location/visit-derivation.service.spec.ts`
- Create: `services/api/src/modules/location/location-context.service.ts`
- Create: `services/api/src/modules/location/location-context.service.spec.ts`
- Create: `services/api/src/modules/location/location-retention.service.ts`
- Create: `services/api/src/modules/location/location-retention.service.spec.ts`
- Create: `services/api/src/modules/location/location-alias.service.ts`
- Create: `services/api/src/modules/location/location-alias.service.spec.ts`
- Modify: `services/api/src/modules/location/location.controller.ts`
- Modify: `services/api/src/modules/location/location.module.ts`

Derivation v1 uses samples with `accuracyM <= 200`: open after three samples remain within 150 m for 10 minutes; close after samples remain more than 250 m away for five minutes. Use an inverse-accuracy-weighted encrypted centroid, treating missing/zero accuracy as 10 m. Recompute only the affected device interval from the preceding retained sample through the following 15 minutes; deterministically replace derived visits in that interval so late samples are idempotent.

Location precedence is: sample no older than 30 minutes, open visit, overlapping Calendar CityStay, Dubai. For events more than six hours away, overlapping Calendar CityStay precedes device context. Device/visit context may have `city=null` while still exposing internal distance capability. Calendar city derivation decrypts `locationText`, exact-normalizes it, and matches its owner-scoped alias MAC; no geocoder is used.

- [ ] Write failing tests for Haversine thresholds, accuracy exclusion, late/out-of-order recomputation, deterministic source MACs, encrypted centroids, aliases, both precedence orders, unknown city with distance capability, and Dubai fallback.
- [ ] Write failing retention tests for per-device cutoffs, 500-row bounded deletes, owner isolation, open visits retained until closed, and daily `03:15 UTC` scheduling.
- [ ] Implement derivation, alias CRUD, context, CityStay rebuild, and retention without external location calls.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/location` and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): derive private location context`

### Task 8: Connect Google Calendar With Minimum-Scope OAuth

**Files:**
- Modify: `services/api/package.json`
- Create: `services/api/src/modules/calendar/calendar.dto.ts`
- Create: `services/api/src/modules/calendar/google-oauth.service.ts`
- Create: `services/api/src/modules/calendar/google-oauth.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-connection.service.ts`
- Create: `services/api/src/modules/calendar/calendar-connection.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar.controller.ts`
- Create: `services/api/src/modules/calendar/calendar.controller.spec.ts`
- Create: `services/api/src/modules/calendar/calendar.module.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/app.module.spec.ts`
- Modify: `pnpm-lock.yaml`

- [ ] Add `googleapis@173.0.0` exactly and write failing tests for exact scopes, PKCE S256, state MAC/expiry/owner/atomic consumption, fixed redirect target, missing refresh token, partial/extra scopes, encrypted persistence, sanitized errors, reconnect compare-and-swap, and owner-scoped disconnect.
- [ ] Require `access_type=offline`, `prompt=consent`, the configured exact redirect URI, and no caller-controlled authority fields.
- [ ] Reconnect replaces a prior refresh token only after verification. `invalid_grant` sets `needs_reauth` without deleting normalized events. Disconnect marks the connection disconnected; Task 9 supplies remote watch shutdown before final row deletion.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/calendar/google-oauth.service.spec.ts src/modules/calendar/calendar-connection.service.spec.ts src/modules/calendar/calendar.controller.spec.ts`, `pnpm install --lockfile-only`, `pnpm install --frozen-lockfile`, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): connect read only google calendar`

### Task 9: Synchronize Calendar Data With Overlapping Watches

**Files:**
- Create: `services/api/src/modules/calendar/calendar-sync.service.ts`
- Create: `services/api/src/modules/calendar/calendar-sync.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-watch.service.ts`
- Create: `services/api/src/modules/calendar/calendar-watch.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-scheduler.service.ts`
- Create: `services/api/src/modules/calendar/calendar-scheduler.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar-connection.service.ts`
- Modify: `services/api/src/modules/calendar/calendar-connection.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar.controller.ts`
- Modify: `services/api/src/modules/calendar/calendar.module.ts`

Initial/full event sync uses `singleEvents=true`, `showDeleted=true`, `timeMin=now-180d`, `timeMax=now+365d`, and `maxResults=2500`. Incremental requests use the stored sync token plus the same stable `singleEvents/showDeleted/maxResults` values permitted with sync tokens. A daily staggered rolling full reconciliation re-fetches the moving window even without changes, preventing unchanged future events from being missed.

Cancelled tombstones update an existing row even when times are absent; an unknown tombstone is stored with null times and no details. On `410`, transactionally delete source events/CityStays, clear the token, and set `fullSyncRequired=true`. Event recommendation fails closed for that owner until every selected source has completed rebuild.

For renewal, create the replacement watch row/channel first, leave both rows `active`, then mark the old row `stopping`, call Google stop, and delete it only after success or expiry. The webhook can validate either row during overlap. Renew within 24 hours on a six-hour scheduler. One-minute pending work, 15-minute catch-up, and daily reconciliation all use database leases and full-jitter backoff.

- [ ] Write failing tests for pagination, rolling-window advancement, incremental parameters, tombstones, `410` fail-closed behavior, all-day semantics, alias-derived CityStays, leases, quota backoff, and `invalid_grant`.
- [ ] Write failing watch tests for spoofed headers, timing-safe MACs, duplicate messages, durable-before-204, two simultaneous channels, replacement ordering, expiry, catch-up, and disconnect stopping every active channel before deletion.
- [ ] Implement sync/watch/schedulers behind literal `CALENDAR_SYNC_ENABLED=true`. The daily maintenance pass hard-deletes consumed or expired OAuth attempts older than 24 hours in 500-row owner-neutral batches without decrypting them.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/calendar` and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): sync calendar context and renewable watches`

### Task 10: Apply Event Discovery Schema And Extend Rekeying

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716160000_event_discovery/migration.sql`
- Modify: `scripts/migration-safety.integration.test.mjs`
- Modify: `services/api/src/cli/rekey-personal-data.ts`
- Modify: `services/api/src/cli/rekey-personal-data.spec.ts`

- [ ] Extend migration tests for every Migration 2 type/default/check/index/compound FK, fresh/upgrade paths, and unchanged prior tables; confirm failure before adding SQL.
- [ ] Add the exact Event models, `User` relation arrays, and forward-only SQL.
- [ ] Add `EventPreference.interestTags`, `EventSource.feedUrl`, and `DiscoveredEvent.providerEventId` envelopes to rekey model coverage; write a failing completeness test that compares a fixed encrypted-envelope registry against Prisma model metadata.
- [ ] Run both synthetic-URL Prisma commands from Task 4, the disposable migration command from Task 4, `pnpm --filter @socos/api exec jest --runInBand src/cli/rekey-personal-data.spec.ts`, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(db): add encrypted event discovery records`

### Task 11: Poll Public ICS Feeds With DNS-Pinned HTTPS

**Files:**
- Modify: `services/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `services/api/src/modules/events/events.types.ts`
- Create: `services/api/src/modules/events/event-source.service.ts`
- Create: `services/api/src/modules/events/event-source.service.spec.ts`
- Create: `services/api/src/modules/events/dns-pinned-fetch.service.ts`
- Create: `services/api/src/modules/events/dns-pinned-fetch.service.spec.ts`
- Create: `services/api/src/modules/events/ics-event-discovery.adapter.ts`
- Create: `services/api/src/modules/events/ics-event-discovery.adapter.spec.ts`
- Create: `services/api/src/modules/events/event-discovery.service.ts`
- Create: `services/api/src/modules/events/event-discovery.service.spec.ts`
- Create: `services/api/src/modules/events/events.controller.ts`
- Create: `services/api/src/modules/events/events.controller.spec.ts`
- Create: `services/api/src/modules/events/events.module.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `services/api/src/app.module.spec.ts`

`EVENT_SOURCE_ALLOWED_HOSTS` is a comma-separated list of lowercase ASCII hostnames with no ports, wildcards, paths, or IP literals; an empty/malformed list disables source creation and polling. `externalSourceId` is a server-generated UUID and is never accepted from request data. Resolve all A/AAAA answers immediately before connect and reject loopback, private, link-local, multicast, unspecified, documentation, metadata, IPv4-mapped IPv6, and configured cloud metadata ranges. Pin the validated address in the HTTP client's custom lookup/dispatcher while retaining the original hostname for TLS SNI and certificate verification. Do not perform a second DNS lookup and do not follow redirects.

The adapter uses `ical.js@2.2.1`, a 10-second abort, a 5 MiB decoded-stream limit, and a 14-day window. Reject missing UID, invalid time, unsupported recurrence, redirects, compressed-size expansion beyond the decoded limit, and non-public source certification. Canonical instances are `<UID>:<RECURRENCE-ID-or-UTC-start>` before HMAC/encryption. Normalize public text to Unicode NFC; trim it; cap title/venue/address/category at 500 characters, excerpt at 1,000, URL at 2,048, and tags at 50 distinct entries of 100 characters each.

- [ ] Write failing source tests for encrypted URL, exact operator-certified configured host, no userinfo/IP, owner isolation, redaction, leases, and literal-false flags.
- [ ] Write fake DNS/socket/fetch tests proving address pinning, TLS hostname preservation, IPv4/IPv6 range rejection, rebinding resistance, timeout, redirect rejection, decoded byte limits, recurrence/cancellation, and sanitized parse errors.
- [ ] Add `ical.js@2.2.1`, source/preference CRUD, adapter registry, and staggered polling. One source failure must not block others.
- [ ] Upsert by `(sourceId,providerEventIdMac)`, encrypt UID, expire absent past events, preserve provider timestamps, and store only certified public normalized fields.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/events`, `pnpm install --frozen-lockfile`, `pnpm --filter @socos/api type:check`, and `pnpm --filter @socos/api build`.
- [ ] Commit: `feat(api): discover public events from pinned ics feeds`

### Task 12: Rank Events Without Persisting Precise Location

**Files:**
- Create: `services/api/src/modules/events/event-ranking.ts`
- Create: `services/api/src/modules/events/event-ranking.spec.ts`
- Create: `services/api/src/modules/events/event-recommendation.service.ts`
- Create: `services/api/src/modules/events/event-recommendation.service.spec.ts`
- Modify: `services/api/src/modules/events/events.module.ts`

Hard-exclude cancelled/ended events, disabled sources, any event while selected Calendar sources require full rebuild, opaque conflicts after travel padding, events beyond maximum distance, the same event dismissed within 30 days, and a category dismissed at least twice within 30 days. One category dismissal alone affects feedback score but does not exclude the category. Travel is `ceil(distanceKm / travelSpeedKph * 60) + travelBufferMinutes`.

Score exactly as follows, capped at 100:

```text
time fit       25: <=48h 25, <=7d 20, <=14d 15
distance       25: round(25 * max(0, 1 - distanceKm/maxDistanceKm)); same-city fallback 15; unknown 0
interests      15: min(15, 5 * overlapping decrypted EventPreference interest tags)
social value  15: min(15, EventSource.socialWeight + 5 for social/networking/community category)
contact fit    10: min(10, 2 * non-demo contacts whose labels/groups/tags overlap public event tags)
novelty         5: 5 with no same-category accept/snooze/dismiss in 30d, otherwise 2
feedback        5: clamp(3 + accepted-category count - dismissed-category count, 0, 5) over 90d
```

Use exact Haversine distance when both coordinate sets exist; otherwise use 10 km for matching cities, exclude explicit city mismatch, and allow unknown distance with zero distance score. Stable order is score descending, start ascending, ID ascending.

- [ ] Write pure failing tests for every boundary, six-hour context precedence, travel conflicts, transparent/declined/all-day Calendar rows, rebuild fail-closed behavior, demo-contact exclusion, event/category cooldown distinction, feedback window, 100-point cap, and stable ties.
- [ ] Implement a pure ranker plus an owner-scoped recommendation service returning at most three planned event items. Never return or persist coordinates; discard decrypted coordinates after in-memory ranking.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/events` and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): rank contextual public events`

### Task 13: Add Event Items While Preserving Brief V1 When Disabled

**Files:**
- Modify: `services/api/src/modules/briefs/briefs.types.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.presenter.ts`
- Modify: `services/api/src/modules/briefs/briefs.presenter.spec.ts`
- Modify: `services/api/src/modules/briefs/brief-feedback.service.ts`
- Modify: `services/api/src/modules/briefs/brief-feedback.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.module.ts`
- Modify: `services/api/src/modules/events/event-source.service.ts`
- Modify: `services/api/src/modules/events/event-source.service.spec.ts`
- Modify: `packages/agent-core/src/tools/tool-schema.ts`
- Modify: `packages/agent-core/src/agent-interface/contracts.spec.ts`
- Modify: `docs/integrations/hermes-social-brief.md`

When `EVENT_BRIEF_ENABLED` is not literal `true`, new batches remain persisted/presented as `1.0` and existing behavior/output is byte-for-byte compatible. When enabled, new batches persist `schemaVersion='1.1'` and include `events[]`. Persisted `1.0` batches always present as `1.0`; persisted `1.1` batches present as `1.1`. Do not rewrite or dynamically upgrade old batches.

Event items use `kind='event'`, `contactId=null`, `sourceType='discovered_event'`, and internal `sourceId`. Evidence contains only score components, distance band, conflict result, context source/freshness band, matched public tag names, category, and planned coarse city. It contains no coordinates, exact address-derived context, Calendar identity, MAC, or ciphertext. Event items create no quests.

`DailyBriefV1_1` is the V1 shape plus `schemaVersion: '1.1'` and:

```ts
events: Array<{
  itemId: string;
  rank: number;
  eventId: string;
  title: string;
  startAt: string;
  endAt: string;
  city: string | null;
  reason: string;
  evidence: {
    score: { time: number; distance: number; interests: number; social: number; contact: number; novelty: number; feedback: number };
    distanceBand: '<2' | '2-10' | '10-25' | '25-50' | '>50' | 'unknown';
    conflict: 'clear';
    contextSource: 'sample' | 'visit' | 'calendar' | 'fallback';
    contextFreshness: 'fresh' | 'recent' | 'planned' | 'fallback';
    matchedTags: string[];
    category: string | null;
    plannedCity: string | null;
  };
  state: BriefItemState;
}>;
```

Feedback permits null `contactId` only when kind/sourceType match this event contract and the referenced `DiscoveredEvent` belongs to the same owner. Existing person/date non-demo checks remain unchanged. Accept/snooze/dismiss use existing idempotent endpoints.

Event-source deletion is part of this task: in one owner-scoped transaction, collect the source's discovered internal IDs, delete their BriefFeedback and BriefItems, then delete the source so DiscoveredEvent rows cascade. This prevents orphaned event items as soon as event briefs ship.

- [ ] Write failing generator/presenter/contract tests for flag-off exact V1 compatibility, flag-on V1.1, persisted-version stability, one-transaction persistence, retry idempotency, three-item cap, explicit kind ordering, no event quests, and redacted evidence.
- [ ] Write failing feedback/source-deletion tests proving valid owner events work; forged, deleted, cross-owner, or null-contact non-event items fail; and source deletion removes event items/feedback before cascading discovered rows.
- [ ] Import `EventsModule` into `BriefsModule`, inject recommendations, and retain existing people/date/quest limits.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/events src/modules/briefs`, `pnpm --filter @socos/agent-core test`, `pnpm --filter @socos/api type:check`, and `pnpm --filter @socos/agent-core type:check`.
- [ ] Commit: `feat(briefs): add versioned event suggestions`

### Task 14: Implement Event-Aware Deletion And Aggregate Audit

**Files:**
- Create: `services/api/src/modules/personal-data/personal-context-deletion.service.ts`
- Create: `services/api/src/modules/personal-data/personal-context-deletion.service.spec.ts`
- Create: `services/api/src/modules/personal-data/personal-context.controller.ts`
- Create: `services/api/src/modules/personal-data/personal-context.controller.spec.ts`
- Modify: `services/api/src/modules/personal-data/personal-data.module.ts`
- Modify: `scripts/security-regression.mjs`
- Modify: `scripts/security-regression.test.mjs`

Full personal-context deletion MACs the idempotency key and canonical confirmation request with the owner context. It performs event-brief cleanup, stops Google channels best-effort without blocking database deletion, counts rows by category, deletes all Calendar/location/event rows in one owner-scoped transaction, and inserts one append-only audit row using owner/request/idempotency MACs and aggregate counts. A unique idempotency MAC makes concurrent duplicates converge; replay returns the stored aggregate result without a second audit.

- [ ] Write failing concurrency/idempotency tests for full context deletion, cross-owner resistance, event feedback cleanup, cascades, remote stop failure, aggregate-only audit, and audit immutability.
- [ ] Write controller/security-scanner tests for JWT ownership, exact confirmation, idempotency key, and absence of caller owner fields.
- [ ] Implement deletion and scanner coverage without logging identifiers/count queries containing values.
- [ ] Run `pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data src/modules/events`, `node --test scripts/security-regression.test.mjs`, `node scripts/security-regression.mjs`, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): delete personal context with aggregate audit`

### Task 15: Prove Database, Security, Packaging, And End-To-End Behavior

**Files:**
- Create: `services/api/test/calendar-location.integration.spec.ts`
- Create: `scripts/run-calendar-location-integration.mjs`
- Modify: `package.json`
- Modify: `scripts/security-regression.test.mjs`
- Modify: `scripts/security-regression.mjs`
- Modify: `scripts/verify-post-migration-counts.mjs`
- Modify: `scripts/docker-packaging.test.mjs`
- Modify: `docs/runbooks/database-backup-restore.md`
- Create: `docs/runbooks/calendar-location-operations.md`

The integration runner requires `CALENDAR_LOCATION_TEST_DATABASE_URL` whose basename matches `^socos_calendar_location_test_[a-z0-9_]*_test$`, never prints it, migrates only a disposable database, and uses synthetic Google/OwnTracks/ICS fixtures. Update post-migration verification to allow exactly the Migration 1/2 tables above and the correct repository migration count derived from migration directories rather than a stale hard-coded default.

- [ ] Write failing integration cases for owner isolation, concurrent sample MAC dedupe, concurrent webhooks, overlapping renewal, rolling reconciliation, `410` rebuild fail-closed, source lease, retention, old/new key reads, rekey resume including Event envelopes, brief retry/version flags, deletion/audit, and cascades.
- [ ] Extend security tests to require correct guards on human/device/provider routes, forbid caller owner fields, scan all new modules plus the exception filter for sensitive logging, require literal feature parsing, and reject personal/Google secrets in Docker build arguments or public frontend variables.
- [ ] Extend packaging tests for rekey CLI, Prisma schema/migrations, and runtime-only secrets.
- [ ] Document aggregate-only operations, watch renewal, reauth, credential rotation, retention, encryption/index keys, deletion, backup expiry, and flag rollback. State that deleted encrypted data remains in backups until 30-day expiry.
- [ ] Run the full command block under Final Verification.
- [ ] Commit: `test: verify calendar location and event context`

### Task 16: Wire Runtime Configuration And Deploy Disabled

**Files:**
- Modify: `services/api/.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `docker-compose.local.yml`
- Modify: `docs/runbooks/calendar-location-operations.md`

Add these names to the API runtime environment, never as Docker build arguments or `NEXT_PUBLIC_*` values:

```text
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
GOOGLE_CALENDAR_WEBHOOK_URL
GOOGLE_CALENDAR_SETTINGS_RESULT_URL
PERSONAL_DATA_KEYS
PERSONAL_DATA_ACTIVE_KEY_VERSION
PERSONAL_DATA_INDEX_KEY
EVENT_SOURCE_ALLOWED_HOSTS
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

The production runbook fixes the non-secret values to:

```text
GOOGLE_CALENDAR_REDIRECT_URI=https://socos.rachkovan.com/api/integrations/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://socos.rachkovan.com/api/integrations/google-calendar/webhook
GOOGLE_CALENDAR_SETTINGS_RESULT_URL=https://socos.rachkovan.com/dashboard
```

- [ ] Remove the unused legacy `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` examples. Pass every variable above through the API service `environment` block with required-secret syntax for keys/Google credentials and false defaults for flags. Local Compose uses operator-supplied synthetic/local values only.
- [ ] Add a higher-priority Traefik router matching `Host(\`socos.rachkovan.com\`) && Path(\`/api/location/owntracks\`)` and middleware labels `traefik.http.middlewares.owntracks-ratelimit.ratelimit.average=30`, `period=1m`, and `burst=10`; chain it to the API service. Document that Traefik's direct peer address is the source criterion and application Basic authentication remains authoritative.
- [ ] Verify a cloud backup and disposable restore, 30-day expiry, HTTPS, `/api/health-check`, one migration runner, aggregate schema checks, and prior V1 brief behavior before enabling any flag.
- [ ] Configure Google External/Production with exact scopes/redirect, enable Calendar sync, and inspect only aggregate source/event/watch counts and timestamps.
- [ ] Enroll OwnTracks Android directly with precise background location, TLS validation, HTTP mode, two-minute interval, 100 m displacement, 15-minute ping, and no OwnTracks payload encryption because TLS plus application field encryption is used. Enable location ingest and verify only aggregate counts/`lastSeenAt`.
- [ ] Add one operator-certified public ICS host/source, enable discovery, then enable event briefs. Verify the next newly generated brief is V1.1 with at most three suggestions; V1 batches remain V1.
- [ ] Record timestamp and non-sensitive aggregate results in the runbook.
- [ ] Commit: `docs: add calendar location rollout runbook`

## Final Verification

Use database names satisfying each runner's exact disposable guard. Commands must not echo URLs or secrets.

```bash
CALENDAR_LOCATION_TEST_DATABASE_URL=<disposable-socos_calendar_location_test_run_test-url> \
  pnpm test:calendar-location-integration

TEST_DATABASE_URL=<disposable-socos_migration_test_calendar_test-url> \
  node --test scripts/migration-safety.integration.test.mjs

pnpm --filter @socos/api exec jest --runInBand src/modules/personal-data src/modules/location src/modules/calendar src/modules/events src/modules/briefs
pnpm --filter @socos/agent-core test
node --test scripts/security-regression.test.mjs scripts/docker-packaging.test.mjs
pnpm test
pnpm type:check
pnpm build
pnpm lint
node scripts/security-regression.mjs
git diff --check
```

Expected: every command passes; integration logs contain synthetic aggregate status only; no command prints a database URL, key, token, payload, identifier, coordinate, ciphertext, IV, tag, or MAC.

## Rollback, Rekey, And Deletion

Rollback flags in reverse dependency order: `EVENT_BRIEF_ENABLED=false`, `EVENT_DISCOVERY_ENABLED=false`, `LOCATION_INGEST_ENABLED=false`, `CALENDAR_SYNC_ENABLED=false`. Stop active Google channels, deploy the prior image, and leave both additive migrations and all required encryption/index keys in place.

Encryption key rotation is two-key compatible:

1. Add the new encryption version, keep the old version, set the new active version, and deploy.
2. Run `node dist/cli/rekey-personal-data.js --from=<old> --to=<new> --batch-size=100` inside the built cloud runtime image. The equivalent repository command after `pnpm --filter @socos/api build` is `pnpm --filter @socos/api personal-data:rekey -- --from=<old> --to=<new> --batch-size=100`.
3. Verify aggregate per-model counts show zero old-version envelopes and run synthetic decrypt smoke tests.
4. Keep both keys through rollback and 30-day backup expiry. Remove the old encryption key only after both windows pass. Do not rotate `PERSONAL_DATA_INDEX_KEY` in this release.

If a Pixel credential is exposed, rotate it before re-enabling ingest. If Google credentials are exposed, revoke the OAuth grant, rotate the client secret, disconnect, and reconnect. Owner-requested deletion uses `DELETE /api/personal-context`; encrypted backup copies expire only under the documented 30-day retention policy.

Release is complete only when all flags independently disable their path, a restored backup is proven, Calendar catch-up and rolling reconciliation work without webhooks, overlapping watch renewal is verified, offline OwnTracks history drains without duplication, no sensitive value appears in logs, rekey covers both migrations, personal-context deletion removes event feedback and records aggregate audit, and both persisted Brief V1 and V1.1 render according to their stored versions.

## Official References

- Google Calendar scopes: <https://developers.google.com/workspace/calendar/api/auth>
- Google OAuth web-server flow: <https://developers.google.com/identity/protocols/oauth2/web-server>
- Google Calendar incremental sync and `410`: <https://developers.google.com/workspace/calendar/api/guides/sync>
- Google Calendar push notifications: <https://developers.google.com/workspace/calendar/api/guides/push>
- Google Calendar quotas: <https://developers.google.com/workspace/calendar/api/guides/quota>
- OwnTracks HTTP mode and JSON: <https://owntracks.org/booklet/tech/http/>
- OwnTracks Android behavior: <https://owntracks.org/booklet/features/android/>
- Android background location: <https://developer.android.com/develop/sensors-and-location/location/permissions>
- Coolify runtime variables: <https://coolify.io/docs/knowledge-base/environment-variables>
- Coolify backups: <https://coolify.io/docs/databases/backups>
