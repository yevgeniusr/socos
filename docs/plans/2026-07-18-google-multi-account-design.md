# Google Calendar Multi-Account And Event Deduplication Design

## Goal

Allow one Socos owner to connect several Google accounts, manage each account
independently, and avoid presenting the same logical event more than once when
it appears through several calendars or certified feeds.

## Account Model

`GoogleCalendarConnection` becomes many-to-one with `User`. Each connection
stores an encrypted Google provider account identifier and an owner-scoped MAC.
The provider identifier is the authenticated account's primary CalendarList
entry ID, obtained with the existing `calendar.calendarlist.readonly` scope.
No profile, email, write, or broad Calendar scope is added.

The database retains `@@unique([id, ownerId])` for owner-scoped foreign keys and
adds `@@unique([ownerId, providerAccountIdMac])` to reject duplicate grants.
The existing owner-only unique constraint is removed. An `oauthGeneration`
counter provides an explicit compare-and-swap boundary for reconnect and
disconnect; background synchronization may update timestamps without
invalidating an in-flight grant.

Existing connections are backfilled from their encrypted primary
`CalendarSource`. Until an existing row has a verified provider identity, Socos
will not start an add-account flow for that owner. This fails closed instead of
risking a duplicate account.

## API And Lifecycle

The authenticated surface is connection-specific:

```text
POST   /api/integrations/google-calendar/connect
GET    /api/integrations/google-calendar/connections
POST   /api/integrations/google-calendar/connections/:connectionId/reconnect
DELETE /api/integrations/google-calendar/connections/:connectionId
GET    /api/integrations/google-calendar/sources
PATCH  /api/integrations/google-calendar/calendars/:sourceId
```

Add-account OAuth attempts contain no expected connection. Reconnect attempts
contain the exact owner-scoped connection ID, provider MAC, and OAuth
generation. The callback obtains the primary CalendarList entry before any
write. A duplicate add or different-account reconnect fails without modifying
an existing connection. Callback outcomes are fixed safe codes only.

Disconnect, remote watch stopping, Calendar-derived stay cleanup, and final row
deletion all receive `(ownerId, connectionId)`. No cleanup helper may select an
arbitrary connection by owner after this migration.

## Event Identity

Source rows are never merged or deleted for deduplication. Provenance, source
selection, cancellation, and independent sync remain intact.

Google events gain an owner-scoped canonical occurrence MAC derived from:

```text
iCalUID + originalStartTime
```

For a non-recurring event, normalized start time is used when
`originalStartTime` is absent. If Google omits `iCalUID`, the canonical MAC is
left null and the event remains source-local. This avoids unsafe title/time
heuristics. Google documents `iCalUID` as the cross-system event identifier and
`originalStartTime` as the immutable identifier of a recurring instance.

Certified ICS events already store an owner-scoped `canonicalMac` derived from
UID and recurrence identity. Both Google and ICS now use one length-safe framed
identity encoding so the same imported occurrence can match across provider
boundaries without delimiter collisions. Recommendation reads collapse rows
with the same non-null canonical MAC before the candidate limit. Selection is
deterministic and retains one source row for provenance. Null identities remain
distinct.

A discovered occurrence already present on a selected Google calendar is not
recommended unless every matching calendar copy is cancelled, transparent, or
declined. Brief items persist only the internal canonical MAC so dismiss and
snooze continue to apply if a different source becomes the representative; the
presenter never exposes that field. Calendar busy checks and Calendar-derived
city stays collapse by canonical occurrence before their respective limits.

## UI

The Integrations panel renders one unframed account section per connection.
Each section shows its provider label, status, sync state, independent calendar
checkboxes, reconnect action, and connection-scoped disconnect confirmation.
`Add Google account` is always available once legacy identity backfill is
complete. Discovery polling continues while any active account has no sources.

## Safety And Verification

- Exact two read-only scopes remain mandatory.
- Provider account IDs, event IDs, refresh tokens, calendar names, and event
  details remain encrypted or MACed according to their lookup requirements.
- OAuth state remains owner-bound, encrypted, single-use, and ten-minute
  limited.
- Cross-owner connection actions return the same sanitized not-found response.
- Source-readiness checks paginate all selected calendars rather than trusting
  the first 100 rows.
- Production verification uses only aggregate counts, statuses, safe codes, and
  timestamps. It never prints account IDs, calendar names, event content,
  credentials, or coordinates.
- The schema change requires a fresh Coolify backup, disposable restore gate,
  exact-SHA deploy, and aggregate post-deploy verification before use.
