# Calendar, Location, And Event Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Yev's daily Social Brief read-only Google Calendar context, direct Pixel location context, and up to three explainable nearby event suggestions without introducing a second personal-data store or any autonomous Calendar write.

**Architecture:** Coolify PostgreSQL remains the only source of truth. A `personal-data` module encrypts provider credentials and precise fields with versioned AES-256-GCM keys. A read-only `calendar` module uses Google OAuth, incremental sync, and renewable watches. A device-authenticated `location` module accepts OwnTracks HTTP payloads, deduplicates samples, derives visits, and applies explicit retention. A replaceable `events` module starts with allowlisted HTTPS ICS feeds, ranks normalized events against availability, distance, preferences, and prior feedback, then persists suggestions through the existing `BriefItem` model.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11, Prisma 6/PostgreSQL 15, Jest 29, `@nestjs/schedule`, Node `crypto`, `googleapis@173.0.0`, `ical.js@2.2.1`, pnpm 10.10.0.

## Global Constraints

- Keep all real Calendar, location, OAuth, and event data in Coolify PostgreSQL. Tests and local fixtures use synthetic values only.
- Do not use, scrape, or automate Google Maps Location Sharing or Timeline. Google exposes no supported third-party API for either. Timeline is on-device and manual export is outside this release.
- Calendar is read-only. Request only `calendar.calendarlist.readonly` and `calendar.events.readonly`; do not request identity, profile, or write scopes.
- The Pixel posts directly over authenticated HTTPS in OwnTracks HTTP mode. Do not introduce MQTT, Home Assistant, or another location database.
- Exact coordinates, refresh tokens, PKCE verifiers, private ICS URLs, Calendar external IDs, Calendar event details, and visit centroids are encrypted at the application boundary. Never log request bodies, authorization headers, coordinates, ciphertext, IVs, tags, hashes, OAuth codes, provider errors containing payloads, or secret URLs.
- Store only normalized Calendar scheduling data. Do not persist descriptions, conference URLs, raw payloads, or attendee lists. Store summary, location text, and self response status together as encrypted JSON.
- Every query and uniqueness boundary is owner-scoped even though the first deployment has one owner. No cross-owner fallback or global device identity is allowed.
- Location precedence is deterministic: a sample no older than 30 minutes, then an open derived visit, then an overlapping Calendar planned city, then Dubai (`Asia/Dubai`). For events more than six hours away, Calendar planned city precedes current device context.
- Location samples older than their configured retention window are acknowledged but not stored, allowing an offline OwnTracks queue to drain safely.
- Events are suggestions only. No ticket purchase, invitation, Calendar write, message, or attendance claim is added in this plan.
- Ship behind `CALENDAR_SYNC_ENABLED`, `LOCATION_INGEST_ENABLED`, `EVENT_DISCOVERY_ENABLED`, and `EVENT_BRIEF_ENABLED`, all defaulting to `false`.
- Preserve all applied migrations. Both new migrations are additive and forward-only. Rollback disables flags and deploys the prior image; it does not run down migrations or remove encryption keys.
- Use test-first development and make each task below an independently revertible commit.

## Fixed External Contracts

### Google Calendar

Use an External Google OAuth app published to Production. A Testing app invalidates refresh tokens after seven days. Personal use under 100 users may remain unverified but can show Google's unverified-app warning.

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

`connect` creates a 10-minute, owner-bound, one-use state and returns `{ authorizationUrl }`. `callback` consumes that state atomically, exchanges the code, verifies the two exact scopes, encrypts the refresh token, and redirects to the configured Socos settings result URL. `webhook` validates channel ID, resource ID, and channel-token hash, records a durable pending sync, and returns `204`; it never performs provider work in the request.

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
Authorization: Basic <generated username:one-time password>
Content-Type: application/json
```

Device creation and rotation return the Basic password once. A successful or duplicate OwnTracks post returns JSON `[]` with status `200`. `GET /location-context/current` returns source, coarse city/timezone when known, distance capability, and `lastSeenAt`; it does not return raw coordinates.

### Event Sources

Human JWT endpoints:

```text
POST   /api/event-sources
GET    /api/event-sources
PATCH  /api/event-sources/:sourceId
DELETE /api/event-sources/:sourceId
PUT    /api/event-preferences
```

Only an explicitly allowlisted HTTPS host may be saved. V1 accepts `provider='ics'`; the encrypted feed URL is returned only as a redacted host. The adapter contract is:

```ts
interface EventDiscoveryAdapter {
  readonly provider: string;
  discover(
    source: EventSourceConfig,
    window: { from: Date; to: Date },
    signal: AbortSignal,
  ): Promise<NormalizedEvent[]>;
}
```

## Exact Data Model And Migration Order

### Migration 1: `20260716150000_calendar_location`

Create `services/api/prisma/migrations/20260716150000_calendar_location/migration.sql` after `20260716140000_agent_interface`. Add these exact models and matching `User`/`Contact` relation arrays:

```text
GoogleOAuthAttempt
  id, ownerId, stateHash(unique), pkceCiphertext, pkceIv, pkceTag,
  keyVersion, expiresAt, consumedAt?, createdAt

GoogleCalendarConnection
  id, ownerId(unique), refreshTokenCiphertext, refreshTokenIv,
  refreshTokenTag, keyVersion, grantedScopes[], status,
  calendarListSyncToken?, calendarListPendingAt?, calendarListLeaseUntil?,
  lastSyncedAt?, errorCode?, createdAt, updatedAt

CalendarSource
  id, connectionId, ownerId, externalIdHash, externalIdCiphertext,
  externalIdIv, externalIdTag, keyVersion, name, timeZone?, selected,
  isPrimary, syncToken?, fullSyncRequired, pendingSyncAt?, syncLeaseUntil?,
  lastSyncedAt?, errorCode?, createdAt, updatedAt
  unique(connectionId, externalIdHash); unique(id, ownerId)

CalendarWatch
  id, connectionId, ownerId, targetType, targetKey, channelId(unique),
  resourceId, tokenHash, expiresAt, lastMessageNumber?, createdAt, updatedAt
  unique(connectionId, targetType, targetKey)

CalendarEvent
  id, ownerId, sourceId, externalEventIdHash, externalEventIdCiphertext,
  externalEventIdIv, externalEventIdTag, keyVersion, etag?, status,
  startAt, endAt, startDate?, endDate?, allDay, timeZone?, transparency,
  recurringEventIdHash?, originalStartAt?, detailsCiphertext, detailsIv,
  detailsTag, sourceUpdatedAt?, createdAt, updatedAt
  unique(sourceId, externalEventIdHash); unique(id, ownerId)

LocationDevice
  id, ownerId, name, username(unique), credentialHash, externalDeviceId,
  status, rawRetentionDays(default 90), derivedRetentionDays(default 730),
  lastSeenAt?, createdAt, updatedAt
  unique(ownerId, name); unique(id, ownerId)

LocationSample
  id, ownerId, deviceId, recordedAt, receivedAt, coordinatesCiphertext,
  coordinatesIv, coordinatesTag, keyVersion, accuracyM?, batteryPercent?,
  trigger?, payloadHash, createdAt
  unique(deviceId, payloadHash); index(ownerId, recordedAt)

DerivedVisit
  id, ownerId, deviceId, arrivedAt, departedAt?, centroidCiphertext,
  centroidIv, centroidTag, keyVersion, radiusM, confidence,
  sourceHash, derivationVersion(default 1), createdAt, updatedAt
  unique(deviceId, sourceHash); index(ownerId, arrivedAt, departedAt)

LocationAlias
  id, ownerId, normalizedAlias, city, countryCode, timeZone,
  createdAt, updatedAt
  unique(ownerId, normalizedAlias)

CityStay
  id, ownerId, startsAt, endsAt?, city, countryCode, timeZone,
  source, sourceId?, confidence, createdAt, updatedAt
  unique(ownerId, source, sourceId); index(ownerId, startsAt, endsAt)
```

Use `String @id @default(cuid())` and repository-standard scalar string statuses. Add compound foreign keys such as `LocationSample(deviceId, ownerId) -> LocationDevice(id, ownerId)` and `CalendarEvent(sourceId, ownerId) -> CalendarSource(id, ownerId)` so a child cannot reference another owner's row. Add SQL checks for key version greater than zero, 12-byte IVs, 16-byte tags, 64 lowercase-hex hashes, retention ranges (`30..365` raw and `90..3650` derived), coordinate metadata bounds, `endAt > startAt`, and visit/stay end after start. Add indexes for expiry, sync leases, retention scans, and owner/time-window Calendar queries.

Encrypted JSON shapes are fixed:

```ts
type CalendarEventDetails = {
  summary: string;
  locationText: string | null;
  selfResponseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction' | null;
};
type PreciseCoordinates = {
  lat: number; lon: number; alt: number | null; cog: number | null; vel: number | null;
};
type VisitCentroid = { lat: number; lon: number };
```

### Migration 2: `20260716160000_event_discovery`

Create `services/api/prisma/migrations/20260716160000_event_discovery/migration.sql` only after Migration 1 is green:

```text
EventPreference
  id, ownerId(unique), interestTags[], maxDistanceKm(default 50),
  travelSpeedKph(default 30), travelBufferMinutes(default 15),
  createdAt, updatedAt

EventSource
  id, ownerId, provider, externalSourceId, name, feedUrlHash,
  feedUrlCiphertext, feedUrlIv, feedUrlTag, keyVersion, allowedHost,
  city?, countryCode?, socialWeight(default 5), status,
  pollIntervalMinutes(default 60), nextPollAt, leaseUntil?, lastPolledAt?,
  errorCode?, createdAt, updatedAt
  unique(ownerId, provider, externalSourceId); unique(id, ownerId)

DiscoveredEvent
  id, ownerId, sourceId, providerEventId, canonicalHash, title,
  descriptionExcerpt?, url?, startAt, endAt, timeZone?, venueName?,
  address?, city?, countryCode?, latitude?, longitude?, category?, tags[],
  status, sourceUpdatedAt?, discoveredAt, expiresAt, createdAt, updatedAt
  unique(sourceId, providerEventId); index(ownerId, startAt, status, city)
```

Use `Decimal(9,6)` for public venue latitude/longitude. Add checks for coordinate, preference, social-weight (`0..10`), polling (`15..1440` minutes), and event time bounds. Do not add an event-suggestion table: persist ranked suggestions as existing `BriefItem(kind='event', sourceType='discovered_event', sourceId=<DiscoveredEvent.id>)`, and learn from existing `BriefFeedback`.

## Encryption And Credential Rules

`PersonalDataCipherService` uses AES-256-GCM with a cryptographically random 12-byte IV, a 16-byte tag, and AAD `socos:v1:<purpose>:<ownerId>:<recordId>`. Generate the record ID before encryption. `PERSONAL_DATA_KEYS` is a JSON map of integer versions to base64-encoded 32-byte keys; `PERSONAL_DATA_ACTIVE_KEY_VERSION` selects new writes. Startup fails closed for malformed, missing, duplicate, or undersized keys.

Key rotation is always two-key compatible:

1. Add the new version without removing the old version, set it active, and deploy.
2. Run `pnpm --filter @socos/api personal-data:rekey -- --from=<old> --to=<new> --batch-size=100`; it re-encrypts every encrypted model in bounded transactions and is resumable.
3. Verify aggregate per-version counts are zero for the old version and decrypt smoke tests pass.
4. Keep both keys through application rollback and the 30-day backup-expiry window. Remove the old key only after both have elapsed.

OwnTracks credentials use a random 24-byte base64url username and random 32-byte base64url password. Store only `scrypt$32768$8$1$<16-byte-salt-b64url>$<32-byte-hash-b64url>`, derived with `N=32768`, `r=8`, `p=1`, `maxmem=64 MiB`, and compare with `timingSafeEqual`. Rotation invalidates the old password in the same transaction. `X-Limit-U` and `X-Limit-D`, when sent, must match the authenticated device; they never establish identity.

---

### Task 1: Build The Versioned Personal-Data Boundary

**Files:**
- Create: `services/api/src/modules/personal-data/personal-data-cipher.service.ts`
- Create: `services/api/src/modules/personal-data/personal-data-cipher.service.spec.ts`
- Create: `services/api/src/modules/personal-data/device-credential.service.ts`
- Create: `services/api/src/modules/personal-data/device-credential.service.spec.ts`
- Create: `services/api/src/modules/personal-data/personal-data.module.ts`
- Create: `services/api/src/cli/rekey-personal-data.ts`
- Create: `services/api/src/cli/rekey-personal-data.spec.ts`
- Modify: `services/api/package.json`

- [ ] Write failing tests for AES round trips, per-record AAD rejection, random IVs, active-key writes, old-key reads, malformed keyrings, redacted errors, scrypt format, constant-time verification behavior, credential rotation, and a resumable dry-run rekey command.
- [ ] Run `pnpm --filter @socos/api test -- --runInBand src/modules/personal-data src/cli/rekey-personal-data.spec.ts`; expect failure because the module does not exist.
- [ ] Implement the exact cipher and credential rules above. Expose typed `encrypt(purpose, ownerId, recordId, value)` and `decrypt(...)`; never expose raw keys. Add `personal-data:rekey` to the API package.
- [ ] Re-run the focused tests, then `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(api): add versioned personal data encryption`

### Task 2: Apply The Calendar And Location Schema Additively

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716150000_calendar_location/migration.sql`
- Modify: `scripts/migration-safety.integration.test.mjs`

- [ ] Extend migration safety tests first to assert all Migration 1 tables, named unique indexes, compound owner foreign keys, checks, and both fresh and upgrade paths. Also assert no existing column is dropped, renamed, or rewritten.
- [ ] Run `TEST_DATABASE_URL=<disposable-_test-db> node --test scripts/migration-safety.integration.test.mjs`; expect missing-table failure. The runner must reject a URL whose pathname does not end in `_test` and must never print the URL.
- [ ] Add the exact Prisma models and hand-authored forward-only SQL. Do not backfill or inspect personal rows.
- [ ] Run `pnpm --filter @socos/api prisma generate`, the migration safety test, and `pnpm --filter @socos/api type:check`.
- [ ] Commit: `feat(db): add encrypted calendar and location records`

### Task 3: Authenticate And Ingest OwnTracks Location

**Files:**
- Create: `services/api/src/modules/location/location.dto.ts`
- Create: `services/api/src/modules/location/location-device.service.ts`
- Create: `services/api/src/modules/location/location-device.service.spec.ts`
- Create: `services/api/src/modules/location/owntracks-auth.guard.ts`
- Create: `services/api/src/modules/location/owntracks-auth.guard.spec.ts`
- Create: `services/api/src/modules/location/location-ingest.service.ts`
- Create: `services/api/src/modules/location/location-ingest.service.spec.ts`
- Create: `services/api/src/modules/location/location.controller.ts`
- Create: `services/api/src/modules/location/location.controller.spec.ts`
- Create: `services/api/src/modules/location/location.module.ts`
- Modify: `services/api/src/app.module.ts`

OwnTracks validation is exact: maximum body 8 KiB; `_type='location'`; required `tst`, `lat`, and `lon`; optional `acc`, `alt`, `vel`, `cog`, `batt`, `t`, and `tid`; finite coordinates in legal ranges; nonnegative accuracy/velocity; battery `0..100`; timestamp no more than 10 minutes in the future. Offline history within retention is accepted. Normalize numbers and hash SHA-256 over `{deviceId,tst,lat,lon,acc,alt,vel,cog,batt,t}`; never store the raw payload.

- [ ] Write failing guard, DTO, controller, and service tests for no/invalid Basic auth, disabled flag, oversized body, malformed fields, future timestamps, owner mismatch, old queued samples, duplicate delivery, and one-time credential disclosure. Assert every accepted and duplicate request returns `200 []`.
- [ ] Run `pnpm --filter @socos/api test -- --runInBand src/modules/location`; expect failure.
- [ ] Implement device create/list/rotate/revoke and the OwnTracks endpoint. Old-but-expired samples return success without a row; duplicate hashes are no-ops; `recordedAt` comes from `tst` and `receivedAt` from the server. Update `lastSeenAt` monotonically.
- [ ] Import only `LocationModule` in `AppModule`; the human routes use `AuthGuard`, while the ingest route uses only `OwnTracksAuthGuard`.
- [ ] Re-run focused tests and typecheck.
- [ ] Commit: `feat(api): ingest authenticated owntracks samples`

### Task 4: Derive Visits, Resolve Context, And Enforce Retention

**Files:**
- Create: `services/api/src/modules/location/visit-derivation.service.ts`
- Create: `services/api/src/modules/location/visit-derivation.service.spec.ts`
- Create: `services/api/src/modules/location/location-context.service.ts`
- Create: `services/api/src/modules/location/location-context.service.spec.ts`
- Create: `services/api/src/modules/location/location-retention.service.ts`
- Create: `services/api/src/modules/location/location-retention.service.spec.ts`
- Create: `services/api/src/modules/location/location-alias.service.ts`
- Modify: `services/api/src/modules/location/location.controller.ts`
- Modify: `services/api/src/modules/location/location.module.ts`

Derivation v1 uses samples with `accuracyM <= 200`: open a visit after at least three samples remain within 150 m for at least 10 minutes; close it after samples stay more than 250 m away for at least five minutes. Use an inverse-accuracy-weighted encrypted centroid, cap a missing/zero accuracy weight at 10 m, and compute a deterministic source hash so retries cannot duplicate a visit. Do not reverse-geocode in v1.

Calendar city derivation only matches normalized encrypted event `locationText` against owner-created `LocationAlias` rows; no fuzzy geocoder or external call is allowed. Seed Dubai through the authenticated API or controlled production command, never in a migration.

- [ ] Write failing tests for Haversine boundaries, poor-accuracy exclusion, open/close thresholds, out-of-order retries, deterministic hashes, current/future precedence, alias normalization, missing data, and the Dubai fallback.
- [ ] Write failing retention tests for per-device cutoffs, bounded deletes, open visits, owner isolation, and the daily `03:15 UTC` schedule.
- [ ] Implement derivation after successful ingest, context resolution, alias CRUD, coarse context response, and bounded hard deletes. Raw retention defaults to 90 days and derived retention to 730 days.
- [ ] Run `pnpm --filter @socos/api test -- --runInBand src/modules/location` and typecheck.
- [ ] Commit: `feat(api): derive private location context`

### Task 5: Connect Google Calendar With Minimum-Scope OAuth

**Files:**
- Modify: `services/api/package.json`
- Create: `services/api/src/modules/calendar/calendar.dto.ts`
- Create: `services/api/src/modules/calendar/google-oauth.service.ts`
- Create: `services/api/src/modules/calendar/google-oauth.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-connection.service.ts`
- Create: `services/api/src/modules/calendar/calendar.controller.ts`
- Create: `services/api/src/modules/calendar/calendar.controller.spec.ts`
- Create: `services/api/src/modules/calendar/calendar.module.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] Add `googleapis@173.0.0` exactly and write failing tests for exact scopes, PKCE S256, 10-minute hashed state, owner binding, atomic one-use consumption, missing refresh token, partial/extra scopes, encrypted persistence, redacted provider errors, reconnect replacement, and disconnect cleanup.
- [ ] Run `pnpm --filter @socos/api test -- --runInBand src/modules/calendar/google-oauth.service.spec.ts src/modules/calendar/calendar.controller.spec.ts`; expect failure.
- [ ] Implement `connect`, public `callback`, connection status, selected-calendar patch, and disconnect. A reconnect transaction replaces the prior refresh token only after the new token is verified. `invalid_grant` sets `status='needs_reauth'`; it does not erase normalized events.
- [ ] Import only `CalendarModule` in `AppModule`. Verify the callback does not accept an owner ID, redirect URI, or scope from request input.
- [ ] Re-run focused tests, lockfile validation, and typecheck.
- [ ] Commit: `feat(api): connect read only google calendar`

### Task 6: Synchronize Calendar Data And Maintain Watches

**Files:**
- Create: `services/api/src/modules/calendar/calendar-sync.service.ts`
- Create: `services/api/src/modules/calendar/calendar-sync.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-watch.service.ts`
- Create: `services/api/src/modules/calendar/calendar-watch.service.spec.ts`
- Create: `services/api/src/modules/calendar/calendar-scheduler.service.ts`
- Create: `services/api/src/modules/calendar/calendar-scheduler.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar.controller.ts`
- Modify: `services/api/src/modules/calendar/calendar.module.ts`

Initial CalendarList sync selects `primary` automatically. Initial event sync uses `singleEvents=true`, `showDeleted=true`, a window of 180 days past through 365 days future, and pages at 2,500. Incremental requests use only the stored `syncToken` plus the same stable `singleEvents`, `showDeleted`, and page-size values. Include cancellations. On Google `410`, transactionally delete normalized events for that source, clear its token, mark `fullSyncRequired`, and schedule a new full sync.

Store event times/status/transparency in queryable columns and encrypt the fixed detail JSON. Treat `transparency='transparent'` and self-declined events as non-conflicts. Do not store attendee arrays. Rebuild `CityStay(source='calendar')` only for explicit `LocationAlias` matches.

Create one CalendarList watch and one events watch per selected source. Generate a UUID channel ID and random 32-byte token, send the raw token once to Google, and store only its SHA-256 hash. Persist resource ID and expiry. Validate webhook channel/resource/token plus monotonically increasing message number; duplicate/out-of-order messages are acknowledged. Renew within 24 hours using a six-hour scheduler and overlapping replacement, then stop the old channel. Google notifications are hints: a one-minute pending-sync worker and 15-minute catch-up sweep guarantee eventual polling. Use leases, exponential backoff with full jitter, and quota-aware owner/source staggering.

- [ ] Write failing sync tests for pagination, unchanged sync parameters, deletion, `410`, primary selection, recurrence expansion, all-day events, alias-derived city stays, quota retry, lease contention, and `invalid_grant`.
- [ ] Write failing watch/controller tests for spoofed headers, hash comparison, duplicate messages, durable-before-204 behavior, per-calendar channels, renewal overlap, expiry, and notification loss catch-up.
- [ ] Implement sync, watch, webhook, and schedulers behind `CALENDAR_SYNC_ENABLED`.
- [ ] Run `pnpm --filter @socos/api test -- --runInBand src/modules/calendar` and typecheck.
- [ ] Commit: `feat(api): sync calendar context and watches`

### Task 7: Persist And Poll Replaceable Event Sources

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716160000_event_discovery/migration.sql`
- Modify: `scripts/migration-safety.integration.test.mjs`
- Modify: `services/api/package.json`
- Create: `services/api/src/modules/events/events.types.ts`
- Create: `services/api/src/modules/events/event-source.service.ts`
- Create: `services/api/src/modules/events/event-source.service.spec.ts`
- Create: `services/api/src/modules/events/ics-event-discovery.adapter.ts`
- Create: `services/api/src/modules/events/ics-event-discovery.adapter.spec.ts`
- Create: `services/api/src/modules/events/event-discovery.service.ts`
- Create: `services/api/src/modules/events/event-discovery.service.spec.ts`
- Create: `services/api/src/modules/events/events.controller.ts`
- Create: `services/api/src/modules/events/events.controller.spec.ts`
- Create: `services/api/src/modules/events/events.module.ts`
- Modify: `services/api/src/app.module.ts`

The ICS adapter uses `ical.js@2.2.1`, a 10-second abort timeout, a 5 MiB response limit, and a 14-day discovery window. Require HTTPS and exact `allowedHost`; resolve DNS before each request and reject loopback, private, link-local, multicast, and metadata ranges for every A/AAAA result. Do not follow redirects. Reject items without stable `UID`, invalid times, or unsupported recurrence instead of inventing identity. Canonicalize recurring instances as `<UID>:<RECURRENCE-ID-or-start>`.

- [ ] Extend migration tests first and prove Migration 2 tables/checks fail.
- [ ] Write failing source/controller tests for encrypted URL handling, host approval, owner isolation, flags, leases, and redaction. Write failing adapter tests using a local fake fetch/DNS layer for valid ICS, recurrence, cancellation, size/timeout, redirects, DNS rebinding defenses, and parse errors.
- [ ] Add the exact Migration 2 schema, `ical.js@2.2.1`, source CRUD, preference upsert, adapter registry, and scheduled polling behind `EVENT_DISCOVERY_ENABLED`.
- [ ] Upsert by `(sourceId, providerEventId)`, expire absent past events, preserve provider timestamps, and store only normalized public event fields. One bad source must not block others.
- [ ] Run migration safety, `pnpm --filter @socos/api test -- --runInBand src/modules/events`, and typecheck.
- [ ] Commit: `feat(api): discover events from trusted ics feeds`

### Task 8: Rank Events Into The Existing Daily Brief

**Files:**
- Create: `services/api/src/modules/events/event-ranking.ts`
- Create: `services/api/src/modules/events/event-ranking.spec.ts`
- Create: `services/api/src/modules/events/event-recommendation.service.ts`
- Create: `services/api/src/modules/events/event-recommendation.service.spec.ts`
- Modify: `services/api/src/modules/events/events.module.ts`
- Modify: `services/api/src/modules/briefs/briefs.types.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.presenter.ts`
- Modify: `services/api/src/modules/briefs/briefs.presenter.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.module.ts`
- Modify: `packages/agent-core/src/tools/tool-schema.ts`
- Modify: `docs/integrations/hermes-social-brief.md`

Hard-exclude cancelled/ended events, disabled sources, an opaque Calendar conflict after travel padding, events beyond `maxDistanceKm`, and the same event/category dismissed in the prior 30 days. Compute travel as `ceil(distanceKm / travelSpeedKph * 60) + travelBufferMinutes`. Use Haversine distance when both coordinates exist; otherwise use 10 km for a matching city, exclude an explicit city mismatch, and mark distance unknown.

Score exactly 100 points maximum:

```text
time fit       25: <=48h 25, <=7d 20, <=14d 15
distance       25: round(25 * max(0, 1 - distanceKm/maxDistanceKm)); same-city fallback 15; unknown 0
interests      15: min(15, 5 * overlapping EventPreference.interestTags)
social value  15: min(15, EventSource.socialWeight + 5 for social/networking/community category)
contact fit    10: min(10, 2 * contacts whose non-demo labels/groups/tags overlap event tags)
novelty         5: 5 with no same-category action in 30d, otherwise 2
feedback        5: clamp(3 + accepted-category count - dismissed-category count, 0, 5) over 90d
```

Persist only score components, distance band (`<2`, `2-10`, `10-25`, `25-50`, `>50`, `unknown`), conflict result, context source/freshness, matched tag names, and planned city in `BriefItem.evidence`; never persist the location used for ranking. Add at most three `event` items and no event quests in this release.

- [ ] Write failing pure ranking tests for every boundary, exact 100-point cap, location precedence, travel-padded conflicts, all-day/transparent/declined Calendar events, demo exclusion, feedback cooldown, stable ties (`score desc`, `startAt asc`, `id asc`), and no-coordinate fallbacks.
- [ ] Write failing brief tests proving one transaction persists event items, retries do not duplicate them, feedback uses existing endpoints, and `EVENT_BRIEF_ENABLED=false` preserves current behavior.
- [ ] Add `DailyBriefV1_1` with `schemaVersion='1.1'` and `events[]`. New batches write `1.1`; the presenter must still accept persisted `1.0` batches and present them as `1.1` with `events: []`. Do not rewrite old batches.
- [ ] Inject `EventRecommendationService` through `EventsModule` into `BriefsModule`, retain existing people/date/quest limits, and sort kinds explicitly rather than lexically.
- [ ] Run focused event/brief/agent-core tests, `pnpm test`, and typecheck.
- [ ] Commit: `feat(briefs): add contextual event suggestions`

### Task 9: Prove Database, Security, And End-To-End Behavior

**Files:**
- Create: `services/api/test/calendar-location.integration.spec.ts`
- Create: `scripts/run-calendar-location-integration.mjs`
- Modify: `package.json`
- Modify: `scripts/security-regression.test.mjs`
- Modify: `scripts/security-regression.mjs`
- Modify: `docs/runbooks/database-backup-restore.md`
- Create: `docs/runbooks/calendar-location-operations.md`

- [ ] Add `test:calendar-location-integration` and a runner that requires `CALENDAR_LOCATION_TEST_DATABASE_URL`, rejects a pathname not ending `_test`, never prints the URL, migrates a disposable database, and uses synthetic Google/OwnTracks/ICS fixtures.
- [ ] First write failing integration cases for owner isolation, concurrent duplicate samples, concurrent webhook delivery, `410` rebuild, source polling lease, retention, old-key decrypt/new-key writes, rekey resume, brief retry, and deletion cascades.
- [ ] Extend security regression tests to require guards on all human/device/provider routes, reject owner identity from request data, scan for logging of sensitive fields/bodies/headers, require production feature flags, and fail when personal-data keys or Google secrets are exposed as build-time variables.
- [ ] Document aggregate-only production diagnostics, watch renewal, reauth, credential rotation, retention, key rotation, data deletion, backup expiry, and feature-flag rollback. State explicitly that backups retain deleted/encrypted data until their 30-day expiry.
- [ ] Run:

```bash
CALENDAR_LOCATION_TEST_DATABASE_URL=<disposable-_test-db> pnpm test:calendar-location-integration
TEST_DATABASE_URL=<disposable-_test-db> node --test scripts/migration-safety.integration.test.mjs
pnpm test
pnpm type:check
pnpm build
pnpm lint
node scripts/security-regression.mjs
git diff --check
```

- [ ] Commit: `test: verify calendar location and event context`

### Task 10: Deploy Disabled, Enroll The Pixel, Then Enable In Stages

**Files:**
- Modify: `docs/runbooks/calendar-location-operations.md`
- Modify: `.env.example`

- [ ] Add names only, never values, to `.env.example` and the runbook:

```text
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI=https://socos.rachkovan.com/api/integrations/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://socos.rachkovan.com/api/integrations/google-calendar/webhook
PERSONAL_DATA_KEYS
PERSONAL_DATA_ACTIVE_KEY_VERSION
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

- [ ] In Coolify, verify a successful PostgreSQL backup and disposable restore, 30-day backup expiry, HTTPS domain/health check, and a single migration runner. Add Google and cipher values as locked runtime-only secrets, never build arguments. Deploy both additive migrations with every flag false and verify `/health`, prior brief behavior, and aggregate schema checks.
- [ ] Configure the Google Cloud OAuth app as External/Production, add the two exact scopes and exact redirect URI, connect Yev, enable `CALENDAR_SYNC_ENABLED`, and verify aggregate source/event/watch counts plus last-sync timestamps. Confirm no event detail or token appears in logs.
- [ ] Create one location device and immediately place its one-time password in OwnTracks Android. Set HTTP mode, endpoint `https://socos.rachkovan.com/api/location/owntracks`, Basic credentials in app identification, device ID `pixel`, a two-character tracker ID, Move mode, 120-second interval, 100 m displacement, and 900-second ping. Enable precise location, Allow all the time, foreground notification, auto-start, unrestricted battery, and TLS certificate validation. Leave OwnTracks payload encryption off because transport is already TLS and the server does not implement OwnTracks payload encryption.
- [ ] Enable `LOCATION_INGEST_ENABLED`, manually publish once, and verify only device `lastSeenAt` and aggregate sample count. Exercise background movement and queued-offline delivery; confirm duplicates are stable and logs contain no location data. Then verify visit derivation and the stale-to-Calendar-to-Dubai fallback.
- [ ] Add one trusted ICS source with an exact allowed host. Enable `EVENT_DISCOVERY_ENABLED`, inspect normalized synthetic/staging results and production aggregate counts, then enable `EVENT_BRIEF_ENABLED`. Verify the next new `1.1` brief contains no more than three read-only, explainable event suggestions and old `1.0` batches still render.
- [ ] Record the production verification timestamp and non-sensitive aggregate results in the runbook. Commit: `docs: add calendar location rollout runbook`

## Rollback And Deletion

Rollback in reverse order: set `EVENT_BRIEF_ENABLED=false`, then `EVENT_DISCOVERY_ENABLED=false`, `LOCATION_INGEST_ENABLED=false`, and `CALENDAR_SYNC_ENABLED=false`; stop active Google channels during disconnect; deploy the prior image; leave both additive migrations and every required key version in place. The prior application ignores the new tables. Never roll back with table drops or by removing an old key.

If a Pixel credential is exposed, rotate it before re-enabling ingest. If a Google credential is exposed, revoke the OAuth grant, rotate the client secret, disconnect the Socos connection, and reconnect. Owner-requested deletion hard-deletes live Calendar/location/event rows through owner-scoped services and records an aggregate audit event; encrypted copies disappear from backups only after the documented 30-day expiry.

The release is complete only when all flags can independently disable their path, a restored backup has been proven, Calendar catch-up works without a webhook, an offline OwnTracks queue drains without duplication, no sensitive value appears in logs, an old-key row survives application rollback, and a Social Brief can render both persisted `1.0` and new `1.1` batches.

## Official References

- Google Calendar scopes: <https://developers.google.com/workspace/calendar/api/auth>
- Google OAuth web-server flow: <https://developers.google.com/identity/protocols/oauth2/web-server>
- Google Calendar incremental sync and `410`: <https://developers.google.com/workspace/calendar/api/guides/sync>
- Google Calendar push notifications: <https://developers.google.com/workspace/calendar/api/guides/push>
- Google Calendar quotas: <https://developers.google.com/workspace/calendar/api/guides/quota>
- OAuth testing-token lifetime: <https://support.google.com/cloud/answer/15549945?hl=en>
- Personal-use verification exception: <https://support.google.com/cloud/answer/13464323?hl=en>
- Google Location Sharing consumer feature: <https://support.google.com/accounts/answer/9363497?hl=en>
- Google Maps Timeline on Android: <https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DAndroid&hl=en>
- Google Maps Platform API catalog: <https://developers.google.com/maps/documentation/>
- Google Maps data portability schema: <https://developers.google.com/data-portability/schema-reference/maps>
- OwnTracks HTTP mode: <https://owntracks.org/booklet/tech/http/>
- OwnTracks JSON payloads: <https://owntracks.org/booklet/tech/json/>
- OwnTracks Android behavior: <https://owntracks.org/booklet/features/android/>
- Android location permissions: <https://developer.android.com/develop/sensors-and-location/location/permissions>
- Android background location limits: <https://developer.android.com/about/versions/oreo/background-location-limits>
- Coolify environment variables: <https://coolify.io/docs/knowledge-base/environment-variables>
- Coolify domains and HTTPS: <https://coolify.io/docs/knowledge-base/domains>
- Coolify health checks: <https://coolify.io/docs/knowledge-base/health-checks>
- Coolify database backups: <https://coolify.io/docs/databases/backups>
