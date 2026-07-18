# Google Calendar Multi-Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect several Google accounts per Socos owner and deduplicate logical event occurrences across calendars and certified feeds without deleting provenance.

**Architecture:** Make Calendar connections independently addressable and identify each grant by the encrypted primary CalendarList ID plus owner MAC. Persist a conservative Google occurrence MAC from `iCalUID` and immutable occurrence time, while deduplicating ICS recommendation reads by their existing canonical MAC.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Google Calendar API v3, AES-256-GCM/HMAC, Next.js/React, Jest, Vitest, Playwright, Coolify.

## Global Constraints

- Keep exactly the two existing Google Calendar read-only scopes.
- Keep real account, calendar, event, contact, and location data in Coolify PostgreSQL only.
- Never print provider account IDs, calendar/event contents, tokens, credentials, coordinates, owner IDs, or private feed URLs.
- Keep every source row for provenance; deduplicate only logical occurrences at read boundaries.
- Reconnect, disconnect, source selection, watches, and cleanup must be owner- and connection-scoped.
- Outbound messages, introductions, invitations, merges, and deletes still require approval.
- Use forward-only migrations, a fresh restore gate, exact reviewed SHA deployment, and aggregate-only production verification.

---

### Task 1: Persist Account And Occurrence Identity

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260718210000_google_calendar_multi_account/migration.sql`
- Modify: `services/api/src/modules/personal-data/personal-data-envelope.registry.ts`
- Modify: `services/api/src/cli/rekey-personal-data.spec.ts`
- Modify: `scripts/migration-safety.integration.test.mjs`

**Interfaces:**
- Produces: optional encrypted `providerAccountId`, `providerAccountIdMac`, `oauthGeneration`, optional `CalendarEvent.canonicalMac`, and internal optional `BriefItem.sourceCanonicalMac`.

- [x] **Step 1: Write failing schema, envelope-registry, rekey, and migration-safety tests**

Assert that the owner-only connection unique index is absent; the owner/provider
compound unique exists; account envelopes are all-null or all-present; existing
primary source MACs backfill the legacy connection identity; and calendar
canonical MAC is indexed but not unique. The internal brief canonical MAC is
indexed for owner/source-type feedback lookup and is never returned by the
presenter.

- [x] **Step 2: Run the focused tests and confirm the expected failures**

Run `pnpm --filter @socos/api test -- --runInBand src/cli/rekey-personal-data.spec.ts` and `node --test scripts/migration-safety.integration.test.mjs`.

- [x] **Step 3: Add the forward migration and schema fields**

Backfill `providerAccountIdMac` from the connection's primary source MAC, falling
back to its first source. Leave only legacy rows with no source nullable. Add
the connection compound unique and occurrence index without a uniqueness rule.

- [x] **Step 4: Register the account envelope and make focused tests pass**

Use purpose `google-calendar-provider-account-id` and connection ID AAD.

- [x] **Step 5: Validate Prisma and commit**

Run `pnpm --filter @socos/api exec prisma validate`, `pnpm --filter @socos/api exec prisma generate`, focused tests, then commit `feat(calendar): persist multi-account identity`.

### Task 2: Make OAuth And Cleanup Connection-Scoped

**Files:**
- Modify: `services/api/src/modules/calendar/google-oauth.service.ts`
- Modify: `services/api/src/modules/calendar/google-oauth.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar.module.ts`
- Modify: `services/api/src/modules/calendar/calendar-connection.service.ts`
- Modify: `services/api/src/modules/calendar/calendar-connection.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar-watch.service.ts`
- Modify: `services/api/src/modules/calendar/calendar-watch.service.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar.controller.ts`
- Modify: `services/api/src/modules/calendar/calendar.controller.spec.ts`
- Modify: `services/api/src/modules/calendar/calendar.dto.ts`
- Modify: `services/api/test/calendar-location.integration.spec.ts`

**Interfaces:**
- Produces: `connect(ownerId)`, `reconnect(ownerId, connectionId)`, `listConnections(ownerId)`, and `disconnect(ownerId, connectionId)`.
- Produces: fixed callback outcomes `connected`, `duplicate`, `account_mismatch`, or `error`.

- [ ] **Step 1: Write failing OAuth and service tests**

Cover two different accounts, duplicate concurrent add, same-account reconnect,
different-account reconnect rejection, OAuth generation CAS, legacy identity
fail-closed, and exact scopes.

- [ ] **Step 2: Write failing cleanup and controller tests**

Prove account A disconnect cannot update, stop, clean, or delete account B and
cross-owner IDs return sanitized 404 responses.

- [ ] **Step 3: Run focused tests and confirm behavioral failures**

Run the four Calendar Jest specs with `--runInBand`.

- [ ] **Step 4: Resolve the primary CalendarList ID during OAuth**

Extend the OAuth client adapter with a read-only `calendarList.get('primary')`
call and validate a bounded non-empty ID before database writes.

- [ ] **Step 5: Implement add/reconnect/list/disconnect**

Encrypt/MAC the provider ID, reject duplicate add by the compound unique,
compare reconnect provider MAC and generation, and increment generation on
successful reconnect or disconnect.

- [ ] **Step 6: Scope every watch cleanup helper by connection ID**

Replace owner-first cleanup selectors and pass enumerated connection IDs from
maintenance.

- [ ] **Step 7: Expose connection-specific routes and run tests**

Run focused Calendar unit/integration tests, API typecheck, security regression,
and commit `feat(calendar): manage multiple google accounts`.

### Task 3: Deduplicate Logical Event Occurrences

**Files:**
- Modify: `services/api/src/modules/calendar/calendar-sync.service.ts`
- Modify: `services/api/src/modules/calendar/calendar-sync.service.spec.ts`
- Create: `services/api/src/modules/events/event-occurrence-identity.ts`
- Create: `services/api/src/modules/events/event-occurrence-identity.spec.ts`
- Modify: `services/api/src/modules/events/ics-event-discovery.adapter.ts`
- Modify: `services/api/src/modules/events/ics-event-discovery.adapter.spec.ts`
- Modify: `services/api/src/modules/events/event-discovery.service.ts`
- Modify: `services/api/src/modules/events/event-discovery.service.spec.ts`
- Modify: `services/api/src/modules/events/event-recommendation.service.ts`
- Modify: `services/api/src/modules/events/event-recommendation.service.spec.ts`
- Modify: `services/api/src/modules/location/location-alias.service.ts`
- Modify: `services/api/src/modules/location/location-alias.service.spec.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.ts`
- Modify: `services/api/src/modules/briefs/brief-generator.service.spec.ts`
- Modify: `services/api/src/modules/briefs/brief-feedback.service.ts`
- Modify: `services/api/src/modules/briefs/brief-feedback.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.presenter.spec.ts`

**Interfaces:**
- Produces: `NormalizedProviderEvent.canonicalIdentity: string | null`, stored owner-scoped `CalendarEvent.canonicalMac`, framed ICS identities, and internal brief canonical feedback identity.
- Consumes: `DiscoveredEvent.canonicalMac` for recommendation deduplication and exact calendar suppression.

- [ ] **Step 1: Write failing Google occurrence identity tests**

Cover matching `iCalUID` across source-local IDs, recurring instances separated
by `originalStartTime`, moved instances retaining identity, all-day instances,
cancelled tombstones, and missing `iCalUID` returning null.

- [ ] **Step 2: Write failing ICS recommendation deduplication tests**

Cover same canonical MAC across two active sources, deterministic winner,
cancelled/disabled filtering, null keys remaining distinct, pre-limit
deduplication, selected Calendar suppression, and feedback stability when the
representative source changes.

- [ ] **Step 3: Run tests and confirm the expected duplicate behavior**

Run the two focused Jest specs with `--runInBand`.

- [ ] **Step 4: Persist Google canonical occurrence MACs**

Add `iCalUID` to the provider type and derive one framed occurrence identity
shared with the ICS adapter, without using titles, descriptions, locations, or
fuzzy time matching.

- [ ] **Step 5: Collapse ICS candidates after filtering**

Use a database window partition so canonical deduplication happens before the
candidate cap. Keep the deterministic strongest/current source row; each null
canonical value receives its own partition.

- [ ] **Step 6: Deduplicate downstream state and feedback**

Paginate source readiness, suppress exact canonical occurrences already on a
selected nondeclined Calendar, collapse Calendar-derived stays and busy checks,
and store the internal canonical MAC on new event BriefItems. Presenter output
must remain unchanged.

- [ ] **Step 7: Run focused and Calendar/location/brief integration tests**

Commit `feat(events): deduplicate cross-source occurrences`.

### Task 4: Render And Manage Multiple Accounts

**Files:**
- Modify: `apps/web/src/lib/integration-contracts.ts`
- Modify: `apps/web/src/app/dashboard/integrations/integration-view.ts`
- Modify: `apps/web/src/app/dashboard/integrations/integration-view.test.ts`
- Modify: `apps/web/src/app/dashboard/integrations/_components/google-calendar-panel.tsx`
- Modify: `apps/web/src/app/dashboard/integrations/integrations-workspace.tsx`
- Modify: `apps/web/e2e/integrations-workspace.spec.ts`

**Interfaces:**
- Consumes: connection arrays and source `connectionId` from Task 2.

- [ ] **Step 1: Write failing view and browser tests**

Cover account grouping, persistent add action, exact-account reconnect and
disconnect, independent failures, aggregate source summary, and discovery
polling for a newly connected source-less account.

- [ ] **Step 2: Run focused tests and confirm the singular UI fails**

Run the integration-view Vitest and focused integrations Playwright cases.

- [ ] **Step 3: Implement account-grouped state and actions**

Preserve abort/epoch protection and per-source optimistic queues. A failed
account action reloads truthful state without erasing other accounts.

- [ ] **Step 4: Verify desktop and Pixel layouts**

Run at 1440x1000 and 412x915, checking no overlap, horizontal overflow, nested
cards, or undersized action targets.

- [ ] **Step 5: Run web typecheck/lint/tests and commit**

Commit `feat(web): manage google calendar accounts`.

### Task 5: Review, Restore-Gate, Deploy, And Verify

**Files:**
- Modify: `docs/ai-handoff-2026-07-17.md`
- Modify: this plan

- [ ] **Step 1: Run the full focused verification matrix**

Run Prisma validation/generation, migration safety, Calendar/event/API tests,
web unit/browser tests, typechecks, lint, security/package tests, build, and
`git diff --check`.

- [ ] **Step 2: Complete independent task and whole-slice reviews**

Block release on Critical or Important findings involving OAuth ownership,
concurrency, duplicate identity, watch cleanup, migration safety, encryption,
or source provenance.

- [ ] **Step 3: Push the exact reviewed SHA and run the cloud restore gate**

Require a fresh backup, disposable restricted restore, migration application,
schema drift check, aggregate invariants, and cleanup proof.

- [ ] **Step 4: Deploy the exact reviewed SHA without changing feature flags**

Require `running:healthy`, health 200, Calendar guard 401, OwnTracks guard 401,
and Calendar webhook fixed 404.

- [ ] **Step 5: Verify aggregate production state**

Confirm the existing Google connection, selected/synced sources, Pixel device
and sample freshness, event source polling, and zero safe integration errors.
Do not connect another Google account on the user's behalf.

- [ ] **Step 6: Record receipts and remaining user action**

Document only SHA/deployment/backup IDs, migration and aggregate counts, test
results, and that the user may now use `Add Google account` for each grant.
