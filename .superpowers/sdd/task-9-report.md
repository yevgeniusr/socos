# Task 9 Implementation Report

## Delivered

- Fenced calendar-list and selected-source workers using exact lease timestamps and claimed pending generations.
- Exact Google full/incremental pagination, terminal-token-only atomic commits, moving-window replacement, `410` fail-close, fixed safe retry state, and `invalid_grant` reauthentication transitions.
- Encrypted calendar/source/event identities and tokens, exact encrypted event details, DST-correct all-day normalization, sparse tombstones, recurring identity, and transaction-compatible Calendar CityStay rebuilds.
- Overlapping renewable watches with durable-before-retire ordering, crash cleanup, disconnect fencing, timing-safe webhook MAC validation, monotonic signed-BIGINT messages, and resumable best-effort stop processing.
- One-minute workers, 15-minute catch-up and deterministic SHA-256 reconciliation slots, six-hour watch maintenance, and daily bounded OAuth-attempt pruning.
- Authenticated source listing/selection and public `POST /api/integrations/google-calendar/webhook` boundaries.
- Task 14 deletion seam: `prepareOwnerStops` followed by `stopPreparedBestEffort`.
- Review hardening for webhook enqueue rollback, reconnect-generation fencing,
  per-target watch election, resumable disconnect cleanup, selected-source watch
  retirement, missed reconciliation slots, and maintenance pagination beyond the
  first 100 records.
- Calendar-derived stays are removed on disconnect and no longer rebuilt from
  disconnected sources; local source selection remains authoritative across list
  refreshes.

## Verification

- `pnpm --filter @socos/api exec jest --runInBand src/modules/calendar`: 7 suites, 90 tests passed.
- `pnpm --filter @socos/api exec jest --runInBand src/modules/location/location-alias.service.spec.ts`: 1 suite, 6 tests passed.
- `pnpm --filter @socos/api type:check`: passed.
- `pnpm --filter @socos/api build`: passed.
- `git diff --check`: passed.

All provider fixtures are synthetic. No production provider, token, calendar, location, or contact data was accessed or persisted locally.

Race hardening preserves future retry generations during watch creation and
releases sync leases without overwriting webhook-advanced work.
