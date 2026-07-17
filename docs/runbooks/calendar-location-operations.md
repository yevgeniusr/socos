# Calendar Location Operations

## Safety Boundary

Inspect only aggregate counts, statuses, timestamps, migration state, and fixed
error codes. Never print Calendar summaries, event IDs, OAuth tokens, precise
coordinates, OwnTracks payloads, ciphertext, MACs, feed URLs, provider
responses, or owner identifiers. Run production checks from the cloud
administration environment, not a workstation.

The rollout starts disabled. Production runtime must keep these gates false
until each stage below is explicitly enabled:

```text
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
EVENT_SOURCE_ALLOWED_HOSTS=
```

The production Google Calendar URLs are fixed:

```text
GOOGLE_CALENDAR_REDIRECT_URI=https://socos.rachkovan.com/api/integrations/google-calendar/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://socos.rachkovan.com/api/integrations/google-calendar/webhook
GOOGLE_CALENDAR_SETTINGS_RESULT_URL=https://socos.rachkovan.com/dashboard/integrations
PERSONAL_DATA_ACTIVE_KEY_VERSION=1
```

Keep Google credentials, `PERSONAL_DATA_KEYS`, and
`PERSONAL_DATA_INDEX_KEY` only in API runtime secrets. Do not pass them through
Docker build args, frontend public variables, command arguments, or logs.

## Deployment Gate

Before enabling any stage:

1. Trigger a fresh exact Coolify backup and verify the execution finished.
2. Restore that backup into a disposable in-cloud database.
3. Run migrations and Prisma validation against the restored database.
4. Prove zero schema diff between expected Prisma state and the restored
   database.
5. Compare preserved aggregate counts for the Calendar, location, event source,
   discovered event, and brief tables. Do not inspect row contents.
6. Confirm encrypted off-host replication and 30-day retention are active.
7. Deploy the expected main SHA with exactly one API startup path running
   migrations.
8. Verify `/` and `/api/health-check` return 200, guarded routes return 401
   unauthenticated, all four flags are disabled, and Brief V1 output is
   unchanged.

The production Traefik router must include this exact higher-priority route on
HTTP and HTTPS, rate limited to average 30 per minute with burst 10, chained to
the API service:

```text
Host(`socos.rachkovan.com`) && Path(`/api/location/owntracks`)
```

Application Basic auth remains authoritative; Traefik must not bypass it.

## Schedules

- Google Calendar list reconciliation runs on its scheduler cadence and records
  only pending timestamps, sync status, and safe error codes.
- Calendar event sync consumes due sources with short leases and retries with
  backoff. Webhook timestamps advance monotonically; duplicates are expected.
- Calendar watch renewal creates the replacement before retiring older local
  watches. If local persistence fails after a remote channel is created, the
  app attempts an immediate remote stop; any residual orphan is reconciled by
  later renewal or expiry.
- Location raw retention runs at 03:15 UTC. Use aggregate deleted counts only.
- Event source polling uses exact leases. A worker may complete only the lease
  it claimed; stale workers must not commit after takeover.

## Staged Enablement

### Google

User interaction is required in Google Cloud for API enablement, OAuth consent,
OAuth client creation, and final account consent. Configure only the exact two
read-only Calendar scopes, the production redirect URL, and the HTTPS webhook
URL. After credentials are present, enable `CALENDAR_SYNC_ENABLED=true`,
complete consent, and verify only aggregate connection, source, event, watch,
status, and timestamp counts.

### Pixel

User interaction is required for OwnTracks Android installation, precise and
background location permissions, battery settings, and entering one-time
credentials. Enable `LOCATION_INGEST_ENABLED=true`, create the device, capture
the one-time Basic auth credential, and configure OwnTracks Android HTTP mode
to `https://socos.rachkovan.com/api/location/owntracks` with TLS validation,
precise/background location, two-minute interval, 100 m displacement,
15-minute ping, and no OwnTracks payload encryption. Verify only success,
aggregate counts, and `lastSeenAt`.

### ICS

Certifying an ICS host as public is an operator decision. Add one lowercase
ASCII hostname to `EVENT_SOURCE_ALLOWED_HOSTS`, enable
`EVENT_DISCOVERY_ENABLED=true`, and add one source. Verify only allowed host,
aggregate source/event counts, statuses, and timestamps.

### Briefs

Enable `EVENT_BRIEF_ENABLED=true` last. Only new brief batches become V1.1 and
include at most three events. Stored V1 batches remain V1 and must not be
rewritten or dynamically upgraded.

## Reauth And Exposure Response

For Google reauth, leave the calendar feature enabled unless rollback is
required, ask the user to reconnect, and verify aggregate connection status.
For Google credential exposure, revoke the grant, rotate the client secret,
then disconnect and reconnect.

For Pixel OwnTracks credential exposure, disable location ingest, rotate the
device credential, update the phone HTTP password, and confirm only last-seen
timestamps and aggregate sample counts before re-enabling ingest.

## Rekey

Use the runtime image CLI `personal-data:rekey` with both the old and target
key versions present in `PERSONAL_DATA_KEYS`. Rekey is resumable and covers
Calendar, location, event-source, discovered-event, and event-brief encrypted
envelopes. Make the new key active, run rekey in cloud, and verify by aggregate
counts that zero old-version envelopes remain.

Do not rotate `PERSONAL_DATA_INDEX_KEY` in this release. Retain old and new
encryption keys through rollback plus the 30-day off-host backup expiry window.

## Deletion

Personal-context deletion uses an owner-row/advisory fence before counting,
deleting, auditing, and provider-stop preparation. The aggregate audit stores
only MACs, categories, row counts, and timestamps. A remote provider-stop
failure is recorded as operational follow-up; it must not resurrect local rows.

## Rollback

Reverse feature flags in this order when needed:

```text
EVENT_BRIEF_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
LOCATION_INGEST_ENABLED=false
CALENDAR_SYNC_ENABLED=false
```

Stop active Google channels, redeploy the last healthy secured image, and keep
additive migrations plus all encryption and index key material intact. Verify
rollback with health checks, guarded-route 401s, aggregate counts, scheduler
quietness, migration state, and absence of new safe error codes.

## Manual Boundaries

Automation may generate keys, configure safe API runtime secrets, trigger
backups/restores, deploy an exact SHA, verify aggregates, flip feature flags,
run rekey, and check Socos API health. User interaction remains required for
Google Cloud project/API/consent/OAuth client setup and final account consent;
Pixel app installation, Android precise/background/battery permissions, and
entering one-time credentials; and certifying an ICS hostname as public.
