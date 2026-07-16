# Calendar Location Operations

## Safety Boundary

Inspect only aggregate counts, statuses, timestamps, and fixed error codes.
Never print Calendar summaries, event IDs, OAuth tokens, precise coordinates,
OwnTracks payloads, ciphertext, MACs, feed URLs, provider responses, or owner
identifiers. Run production checks from the cloud administration environment,
not a workstation.

## Schedules

- Google Calendar list reconciliation runs on its scheduler cadence and records
  only pending timestamps, sync status, and safe error codes.
- Calendar event sync consumes due sources with short leases and retries with
  backoff. Webhook timestamps advance monotonically; duplicates are expected.
- Calendar watch renewal creates the replacement before retiring older local
  watches. If local persistence fails after a remote channel is created, the
  app attempts an immediate remote stop; any residual orphan is reconciled by
  later renewal/expiry.
- Location raw retention runs at 03:15 UTC. Use aggregate deleted counts only.
- Event source polling uses exact leases. A worker may complete only the lease
  it claimed; stale workers must not commit after takeover.

## Reauth And Rotation

For Google reauth, set the calendar feature flag off only if rollback is
required, ask the user to reconnect, and verify aggregate connection status.
For Pixel OwnTracks rotation, rotate the device credential, update the phone
HTTP password, and confirm only last-seen timestamps and sample counts. Do not
inspect payloads or coordinates.

## Rekey

Use the runtime image CLI `personal-data:rekey` with two key versions present:
the old version and the target version. Rekey is resumable and covers Calendar,
location, event-source, discovered-event, and event-brief encrypted envelopes.
Keep the index key unchanged; this release does not support MAC/index rotation.
After rekey, retain old encryption keys through rollback plus the 30-day
off-host backup expiry window.

## Deletion

Personal-context deletion uses an owner-row/advisory fence before counting,
deleting, auditing, and provider-stop preparation. The aggregate audit stores
only MACs, categories, row counts, and timestamps. A remote provider-stop
failure is recorded as operational follow-up; it must not resurrect local rows.

## Rollback

Reverse feature flags in this order when needed: `EVENT_BRIEF_ENABLED`,
`EVENT_DISCOVERY_ENABLED`, `LOCATION_INGEST_ENABLED`, then
`CALENDAR_SYNC_ENABLED`. Keep runtime secrets present during rollback so old
encrypted rows and backups remain decryptable. Verify rollback with health
checks, aggregate counts, scheduler quietness, and absence of new safe error
codes.
