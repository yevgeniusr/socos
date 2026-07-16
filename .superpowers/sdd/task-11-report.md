# Task 11 Report: Allowlisted Public Event Discovery

## Delivered

- Added owner-scoped event source and event preference APIs with encrypted sensitive fields, authenticated search indexes, strict validation, redacted responses, and race-safe preference creation.
- Added literal-flag event discovery scheduling, PostgreSQL `SKIP LOCKED` claiming, bounded concurrency, lease fencing, jittered retry backoff, and transactional set-based persistence.
- Added strict HTTPS source allowlisting and a DNS-pinned fetch transport that rejects mixed or non-public DNS answers, redirects, oversized/invalid responses, unsupported encodings, and deadline overruns.
- Added bounded ICS parsing for UTC, date-only, and embedded `VTIMEZONE` events; recurrence expansion; exceptions, moves, cancellations, `EXDATE`, `DTEND`, and `DURATION`; normalized metadata; and stable canonical identities.
- Expire only absent events that have already ended after a complete successful feed parse. Failed or partial polls leave the prior event set intact.
- Registered `EventsModule`, added startup validation for `EVENT_SOURCE_ALLOWED_HOSTS`, and added the `ical.js` runtime dependency.

## Security And Resource Limits

- Source URLs require exact ASCII allowlisted hostnames, HTTPS, no userinfo, no fragment, no non-default port, and no IP literal.
- Fetches resolve once and pin the approved address through connection setup while retaining TLS hostname and certificate validation.
- Feed bytes, decoded bytes, component count, recurrence work, persistence chunk size, request deadline, and transaction duration are bounded.
- Recurrence iteration accepts only a deliberately bounded subset of simple `HOURLY`, `DAILY`, `WEEKLY`, `MONTHLY`, and `YEARLY` rules; sparse `BY*`, `RDATE`, `EXRULE`, and multiple-rule inputs are rejected before iteration.
- Public failures use fixed messages and do not expose feed contents, URLs, DNS details, parser internals, encryption material, or owner identifiers.
- Independent security re-review approved the implementation with no Critical or Important findings remaining.

## Verification

- Focused sparse recurrence case under a hard 30-second process timeout: 1 passed in 22 ms; no orphan Jest process remained.
- Event module Jest suite: 7 suites, 95 tests passed.
- Personal-data configuration and AppModule Jest suites: 2 suites, 29 tests passed.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm --filter @socos/api type:check`: passed.
- `pnpm --filter @socos/api build`: passed.
- Focused events ESLint: 0 errors, 5 existing-style test-only warnings.
- `git diff --check`: passed.
