# Integration Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multiple Google calendars visible after OAuth, activate Pixel location ingest, and activate a useful certified event-discovery source in production.

**Architecture:** Keep one encrypted Google connection per Socos owner and its existing many independently selectable `CalendarSource` rows. Close the asynchronous source-discovery gap in the web client, then use the staged Coolify activation wrapper for location and event discovery. Seed only an owner-scoped certified public ICS source; the 49-item global catalogue remains metadata-only until connector-specific ingestion is implemented.

**Tech Stack:** Next.js/React, Playwright, NestJS, PostgreSQL/Prisma, Coolify activation tooling, OwnTracks, ICS.

## Global Constraints

- Real contacts, calendars, coordinates, feeds, and preferences remain cloud-only.
- Never print credentials, OAuth state/code, feed contents, coordinates, owner identifiers, or event contents.
- Google and event access remain read-only; outbound actions continue to require approval.
- Multiple calendars inside one Google account are in scope. Multiple Google accounts are not part of this change.
- Location and discovery activation must update production and preview together, create a fresh backup, deploy an exact pushed SHA, pass fixed smokes, and roll back automatically on failure.
- The user must perform Google consent and Pixel app permission/credential entry.

---

### Task 1: Calendar Source Discovery UX

**Files:**
- Modify: `apps/web/src/app/dashboard/integrations/_components/google-calendar-panel.tsx`
- Modify: `apps/web/src/app/dashboard/integrations/integration-view.ts`
- Test: `apps/web/src/app/dashboard/integrations/integration-view.test.ts`
- Test: `apps/web/e2e/integrations-workspace.spec.ts`

**Interfaces:**
- Consumes: singular `CalendarConnectionResponse` plus many `CalendarSourceResponse` rows.
- Produces: a truthful `Discovering calendars` empty state and bounded refresh until sources arrive.

- [x] **Step 1: Write failing summary and browser tests**

Assert that an active connection with zero sources reports `Discovering calendars`, and that a synthetic source endpoint returning an empty list before returning two rows causes both calendar checkboxes to appear without a page reload.

- [x] **Step 2: Run the focused tests and verify RED**

Run the integration-view unit test and the focused Playwright integrations test. The summary assertion and automatic appearance assertion must fail for the missing behavior.

- [x] **Step 3: Implement bounded discovery refresh**

When the connection is active and the source list is empty, retain the ready state, show a discovery status, and schedule an abort-safe reload. Stop scheduling once sources arrive, the component unmounts, the connection stops being active, or the retry limit is reached.

- [x] **Step 4: Run focused and web verification**

Run the two focused tests, web type checking, and web lint. Require zero failures.

- [x] **Step 5: Commit**

Commit the tested UI behavior without schema or OAuth changes.

### Task 2: Location Activation

**Files:**
- Modify: `docs/ai-handoff-2026-07-17.md`

**Interfaces:**
- Consumes: `scripts/run-coolify-activation.mjs location-enable <exact-sha>`.
- Produces: `LOCATION_INGEST_ENABLED=true` in equal production/preview profiles and public OwnTracks returning unauthenticated `401` instead of disabled `503`.

- [x] **Step 1: Verify activation tests and exact source SHA**

Run the activation wrapper tests, confirm a clean pushed commit, and use that exact 40-character SHA.

- [x] **Step 2: Activate location**

Run the checked-in location activation operation. Require a fresh positive-size backup, exact deployment commit, health `200`, Calendar guard `401`, OwnTracks `401`, and Calendar webhook `404`.

- [x] **Step 3: Verify authenticated aggregate state**

Confirm the owner can list location devices and current coarse context without printing device identity or location values. Do not create a device outside the visible one-time credential flow.

- [x] **Step 4: Record the receipt**

Update the handoff with only fixed deployment/backup identifiers, flags, and aggregate status.

### Task 3: Event Discovery Activation And Initial Source

**Files:**
- Modify: `docs/ai-handoff-2026-07-17.md`

**Interfaces:**
- Consumes: `scripts/run-coolify-activation.mjs event-discovery-enable <exact-sha> calendar.google.com`, the Python Software Foundation public calendar subscription, and owner-scoped event preferences.
- Produces: `EVENT_DISCOVERY_ENABLED=true`, a certified Python Events ICS source, and balanced social preferences.

- [x] **Step 1: Certify the feed without storing contents**

Require direct HTTPS `200` from `calendar.google.com`, `text/calendar`, no redirect, public DNS, and a decoded size under the five-megabyte fetch limit.

- [x] **Step 2: Activate discovery**

Run the checked-in discovery activation operation for `calendar.google.com`. Require a fresh backup, exact deployment, and fixed smokes.

- [x] **Step 3: Create useful owner-scoped configuration**

Through the authenticated API, add the Python Events public ICS source with global/online context and a conservative poll interval. Save balanced interests covering professional networking, hobbies, learning, and social adventures. Never print the private stored feed URL or event data.

- [x] **Step 4: Verify aggregate polling state**

Verify only source count, status, safe error code, timestamps, and discovered-event count after a bounded scheduler window. Do not print event titles or locations.

- [x] **Step 5: Record and commit operational state**

Update the handoff, run `git diff --check`, commit the documentation-only receipt, and push it without redeploying the documentation commit.

### Task 4: Final Review

**Files:**
- Review all changed files and production receipts.

- [x] **Step 1: Run focused regression checks**

Run Calendar integration UI tests, activation tests, API type checking, security regression, and repository diff checks.

- [x] **Step 2: Independent review**

Review OAuth ownership, timer cleanup, feature dependency order, feed allowlisting, cloud-only persistence, and production/application SHA separation.

- [x] **Step 3: Final live verification**

Verify production health, Calendar aggregate connection/source state, location endpoint auth state, event source aggregate state, and the 49-item catalogue count.
