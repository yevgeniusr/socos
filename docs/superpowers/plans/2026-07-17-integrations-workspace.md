# Integrations Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-quality authenticated workspace that activates and manages Google Calendar, Pixel OwnTracks, and allowlisted event discovery.

**Architecture:** Compose existing owner-scoped APIs in a client workspace with independent panel state. Add no aggregate backend and preserve all existing encryption, approval, feature-gate, and response contracts. Fix only the shared empty-response/proxy behavior needed by those APIs.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind, Vitest, Playwright, NestJS owner-scoped REST APIs, Coolify.

## Global Constraints

- Real contact, calendar, location, and event data remains only in Coolify PostgreSQL; all local fixtures are synthetic.
- Never persist or log OAuth tokens, one-time Pixel credentials, precise coordinates, private feed URLs, or personal rows.
- Treat only `503` with `code="integration_not_configured"` as disabled; preserve every other error.
- Disconnect/revoke/remove actions require explicit human confirmation and must not claim erasure.
- Outbound messages, introductions, invitations, merges, and deletions remain approval-required. Approval is not execution.
- Keep `CALENDAR_SYNC_ENABLED`, `LOCATION_INGEST_ENABLED`, `EVENT_DISCOVERY_ENABLED`, and `EVENT_BRIEF_ENABLED` false during code deployment.
- Use existing Material Symbols and dashboard visual conventions; do not add a UI dependency.
- Verify desktop and Pixel `412x915` layouts with no horizontal overflow.

---

### Task 1: Shared Empty-Response And Integration View Contracts

**Files:**
- Modify: `apps/web/src/lib/api-client.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/integration-contracts.ts`
- Create: `apps/web/src/app/dashboard/integrations/integration-view.test.ts`
- Create: `apps/web/src/app/dashboard/integrations/integration-view.ts`

**Interfaces:**
- Produces `LoadableIntegration<T>`, Calendar/location/event response types,
  `integrationFailure(error, fallback)`, and `parseCalendarResult(value)`.
- `apiJson<void>()` resolves `undefined` for HTTP `204` without parsing a body.

- [ ] **Step 1: Write failing tests**

Add an `apiJson<void>` test whose mocked response is `new Response(null,
{status: 204})`, and pure helper tests proving:

```ts
expect(integrationFailure(new ApiError("Integration is not configured", 503,
  "integration_not_configured"), "fallback")).toEqual({ status: "disabled" });
expect(parseCalendarResult("connected")).toBe("connected");
expect(parseCalendarResult("error")).toBe("error");
expect(parseCalendarResult("anything-else")).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @socos/web test -- src/lib/api-client.test.ts src/app/dashboard/integrations/integration-view.test.ts` and require failures caused by the missing behavior/modules.

- [ ] **Step 3: Implement the contracts**

In `apiJson`, return `undefined as T` immediately when `response.status ===
204`. Define exact public response types matching the existing Calendar,
location-device/context, event-source, and event-preference projections. Map
only the exact disabled error to `{status:"disabled"}` and retain safe messages
for generic failures.

- [ ] **Step 4: Verify GREEN**

Run the focused Vitest command and `pnpm --filter @socos/web type:check`.

- [ ] **Step 5: Commit**

Commit as `feat(integrations): add activation view contracts`.

### Task 2: Authenticated Integrations Workspace

**Files:**
- Modify: `apps/web/src/app/dashboard/_components/dashboard-shell.tsx`
- Create: `apps/web/src/app/dashboard/integrations/page.tsx`
- Create: `apps/web/src/app/dashboard/integrations/integrations-workspace.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/integration-section.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/google-calendar-panel.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/pixel-location-panel.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/event-discovery-panel.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/confirmation-dialog.tsx`
- Create: `apps/web/src/app/dashboard/integrations/_components/one-time-credentials-dialog.tsx`
- Create: `apps/web/e2e/integrations-workspace.spec.ts`

**Interfaces:**
- Consumes all Task 1 contracts and `apiJson`.
- Produces the route `/dashboard/integrations` and four-column mobile navigation.

- [ ] **Step 1: Write failing browser journeys**

Use synthetic localStorage plus `page.route("**/api/**")`. Cover these exact
observable behaviors:

```text
disabled: all three sections say Not enabled and no generic error appears
calendar: connect posts {}, callback announces result, source checkbox PATCHes
          {selected:boolean}, disconnect confirms and says retained context remains
pixel: create displays endpoint/username/password once, close removes password,
       rotate replaces credentials, revoke confirms without claiming deletion
events: create sends name/feed/city/country/weight/poll interval, list never shows
        feed URL, preference PUT sends balanced tags/distance/speed/buffer,
        source disable/remove use explicit controls
partial failure: one panel retries without removing other ready panels
mobile: Integrations is reachable at 412x915 and scrollWidth <= innerWidth
```

- [ ] **Step 2: Verify RED**

Start the existing production-build web/API test stack and run
`pnpm --filter @socos/web exec playwright test e2e/integrations-workspace.spec.ts --project=chromium`.
Require failure because the route and nav do not exist.

- [ ] **Step 3: Implement the workspace**

Load panels independently with an `AbortController`. Use
`window.location.assign(authorizationUrl)` for OAuth. Consume only
`calendar=connected|error`, announce it in an `aria-live` receipt, then
`router.replace("/dashboard/integrations")`. Keep one-time credentials only in
component state. Use native checkboxes/toggles for Calendar/source selection,
number inputs for bounded retention and travel values, and full-screen mobile
dialogs with focus trap/restore. Never render a submitted event feed URL.

Replace the disabled Calendar nav item with:

```ts
{ label: "Integrations", icon: "hub", href: "/dashboard/integrations" }
```

Render the first four nav items in `grid-cols-4` on mobile.

- [ ] **Step 4: Verify GREEN**

Run the focused Playwright suite, web Vitest, web typecheck, web lint, and web
production build. Confirm no console/page errors and no Pixel overflow.

- [ ] **Step 5: Commit**

Commit as `feat(integrations): add Calendar Pixel and event controls`.

### Task 3: OAuth Return And Deployment Contracts

**Files:**
- Modify: `scripts/docker-packaging.test.mjs`
- Modify: `docker-compose.prod.yml`
- Modify: `services/api/.env.example`
- Modify: `docs/runbooks/calendar-location-operations.md`
- Modify: `docs/ai-handoff-2026-07-17.md`

**Interfaces:**
- Produces the fixed production OAuth result URL
  `https://socos.rachkovan.com/dashboard/integrations`.

- [ ] **Step 1: Change the packaging assertion first**

Require this exact Compose value:

```text
GOOGLE_CALENDAR_SETTINGS_RESULT_URL=https://socos.rachkovan.com/dashboard/integrations
```

- [ ] **Step 2: Verify RED**

Run `node --test scripts/docker-packaging.test.mjs`; require failure against the
old `/dashboard` URL.

- [ ] **Step 3: Update deployment and operator documentation**

Change the production Compose value, local example, runbook, and handoff. Keep
the OAuth callback itself fixed and input-independent. Do not enable any flag.

- [ ] **Step 4: Verify GREEN**

Run the packaging test, security scanner, `git diff --check`, and the workspace
typecheck/build.

- [ ] **Step 5: Commit**

Commit as `chore(integrations): return OAuth to activation workspace`.

### Task 4: Review, Beta Gate, And Staged Production Activation

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ignored durable ledger)
- Modify after release: `docs/ai-handoff-2026-07-17.md`

- [ ] **Step 1: Independent task and whole-slice review**

Review Tasks 1-3 for API fidelity, one-time-secret handling, truthful deletion
copy, callback safety, accessibility, and mobile layout. Fix every Critical or
Important finding and re-review.

- [ ] **Step 2: Broad verification**

Run web/API tests, typechecks, builds, lint, infrastructure/security/package
tests, real PostgreSQL migration/calendar-location integration, and both
Contacts and Daily Cockpit Playwright suites.

- [ ] **Step 3: Focused synthetic Betabot cohort**

Run at least five human-paced GPT-5.5 sessions on a real Nest/Next/PostgreSQL
stack with synthetic Calendar, Pixel, and ICS fixtures. Require every activation
journey to complete, median happiness at least 70, no Critical defect, and no
secret or precise-coordinate exposure.

- [ ] **Step 4: Deploy disabled-first**

Take and verify a fresh Coolify backup, push `main`, deploy the exact SHA, require
`running:healthy`, smoke the public/authenticated boundaries, and confirm all
four flags are false.

- [ ] **Step 5: Activate one dependency at a time**

Enable Calendar, complete read-only Google consent, and verify aggregate
connection/source/watch state. Enable location, enroll the Pixel, and verify
aggregate device/sample timestamps. Configure `www.meetup.com`, create a
certified Dubai AI ICS source, enable discovery, and verify aggregate source and
event counts. Enable event briefs last and verify only aggregate brief/event
counts plus the user-visible ranked suggestions. Roll back the current flag on
any failed health or integrity check.

