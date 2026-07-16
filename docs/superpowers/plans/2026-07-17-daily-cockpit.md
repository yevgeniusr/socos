# Authenticated Daily Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/dashboard/today` the production-useful authenticated Socos workflow for durable brief recommendations, verified quests, reminders, momentum, and human approval decisions.

**Architecture:** Compose existing owner-scoped domain APIs in the Next.js client so panels fail independently. Add two narrowly scoped NestJS read contracts: bounded approval history with human-readable previews, and a quest action target that makes server-owned evidence usable without changing the versioned Hermes DailyBrief schema.

**Tech Stack:** NestJS, Prisma, class-validator, TypeScript, Next.js 15, React 19, Tailwind CSS 4, Vitest, Jest, Playwright

## Global Constraints

- Coolify PostgreSQL is the only source of truth for real data. Use synthetic fixtures and aggregate-only production validation.
- Preserve the stable `DailyBrief` V1/V1.1 response used by Hermes and MCP.
- Exclude `isDemo=true` contacts from every cockpit read and mutation.
- Derive owner identity only from JWT or the existing agent principal; reject identity fields in bodies and queries.
- `accept`, snooze, and dismiss never award XP. Quest XP requires server-verified interaction or completed-reminder evidence.
- Browser proposal creation is not part of this slice. Agents create proposals through authenticated MCP; the browser approves or rejects them.
- Approval is not execution. UI copy must never imply a message, invitation, introduction, merge, or deletion was performed merely because a grant exists.
- Preserve stable idempotency keys for unresolved brief feedback and quest completion intents.
- Keep cards at 8px radius or less, controls at least 44px, Material Symbols fixed-width, and Pixel `412x915` free of horizontal overflow.
- Do not add a database migration or dependency other than the existing workspace `@socos/agent-core` package.

---

### Task 1: Add The Safe Approval History Read Model

**Files:**
- Create: `services/api/src/modules/agent-security/action-proposal.dto.ts`
- Create: `services/api/src/modules/agent-security/action-proposal.presenter.ts`
- Modify: `services/api/src/modules/agent-security/action-proposal.service.ts`
- Modify: `services/api/src/modules/agent-security/approval.controller.ts`
- Modify: `services/api/src/modules/agent-security/approval.controller.spec.ts`
- Modify: `services/api/src/modules/agent-security/action-proposal.service.spec.ts`
- Modify: `scripts/security-regression.test.mjs`

**Interfaces:**
- Consumes: existing `ActionProposal`, `ApprovalGrant`, `ActionOutbox`, and `AgentClient` rows.
- Produces: `GET /api/agent-proposals/history?status=all&limit=20&offset=0` returning `ProposalHistoryResponse` from the design.
- Preserves: current `GET /api/agent-proposals` pending-array contract and approve/reject routes.

- [ ] **Step 1: Write failing DTO and controller contract tests**

Add route metadata expectations for `GET history`, prove `ApprovalHistoryQueryDto` accepts only `all|pending|approved|rejected|expired`, and prove transformed `limit`/`offset` bounds of `1..50` and `>=0`.

```ts
expect(routes).toEqual([
  "GET /",
  "GET history",
  "POST :proposalId/approve",
  "POST :proposalId/reject",
]);
await expect(
  pipe.transform(
    { status: "unknown", limit: "500", offset: "-1" },
    { type: "query", metatype: ApprovalHistoryQueryDto }
  )
).rejects.toMatchObject({ status: 400 });
```

- [ ] **Step 2: Run the controller test and confirm RED**

Run:

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/agent-security/approval.controller.spec.ts
```

Expected: failure because the DTO and `GET history` route do not exist.

- [ ] **Step 3: Implement the exact query DTO and guarded route**

Create defaults and validation:

```ts
export type ProposalHistoryStatus =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export class ApprovalHistoryQueryDto {
  @IsOptional()
  @IsIn(["all", "pending", "approved", "rejected", "expired"])
  status: ProposalHistoryStatus = "all";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
```

The controller method must call only:

```ts
history(
  @Request() request: AuthenticatedRequest,
  @Query() query: ApprovalHistoryQueryDto
) {
  return this.proposals.listHistory(request.user.userId, query);
}
```

- [ ] **Step 4: Write failing service/presenter tests**

Cover all of these exact behaviors:

- stale pending proposals are marked expired before the read;
- owner filter is present on update, count, findMany, and all reference lookups;
- newest-first pagination is `createdAt desc, id desc`;
- `status=all` has no status predicate; every other value is exact;
- presenter excludes `ownerId`, `clientId`, `payloadHash`, raw `payload`, and metadata;
- message, introduction, invitation, merge, and delete previews are strict action-specific unions;
- contact IDs resolve only through `{ownerId,isDemo:false}` and fall back to `Unavailable contact`;
- grant/outbox status is included without payload or credentials;
- count and list use the same owner/status filter.

- [ ] **Step 5: Run the service test and confirm RED**

Run:

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/agent-security/action-proposal.service.spec.ts
```

Expected: failure because `listHistory` and the presenter do not exist.

- [ ] **Step 6: Implement the minimal presenter and batched reference resolution**

Use one explicit Prisma select for proposals, client, grant, and outbox. Collect referenced contact IDs from the persisted preview, query those contacts once with:

```ts
{
  where: { id: { in: contactIds }, ownerId, isDemo: false },
  select: { id: true, firstName: true, lastName: true },
}
```

Return ISO-serializable `Date` values through NestJS and the exact discriminated preview shape. Parse persisted JSON defensively and return `{ type: "unavailable", label: "Unavailable preview" }` for malformed or unsupported previews. For delete targets that are not contacts, use a bounded label such as `Interaction record` or `Reminder record`; do not query or expose bodies.

- [ ] **Step 7: Extend the security regression route assertions**

Assert the new route remains guarded and the history source contains no credential/token lookup, direct executor call, or unbounded `findMany`.

- [ ] **Step 8: Verify and commit Task 1**

Run:

```bash
pnpm --filter @socos/api test -- --runInBand \
  src/modules/agent-security/approval.controller.spec.ts \
  src/modules/agent-security/action-proposal.service.spec.ts
pnpm --filter @socos/api type:check
node --test scripts/security-regression.test.mjs
git diff --check
```

Commit:

```bash
git add services/api/src/modules/agent-security scripts/security-regression.test.mjs
git commit -m "feat(api): expose safe proposal history"
```

---

### Task 2: Expose Server-Owned Quest Action Targets

**Files:**
- Modify: `services/api/src/modules/briefs/brief-feedback.service.ts`
- Modify: `services/api/src/modules/briefs/brief-feedback.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.controller.ts`
- Modify: `services/api/src/modules/briefs/briefs.controller.spec.ts`
- Modify: `scripts/security-regression.test.mjs`

**Interfaces:**
- Consumes: authenticated owner, quest ID, persisted `Quest.targetId`, and brief-item contact.
- Produces: `GET /api/briefs/quests/:questId/action` returning the `QuestAction` union in the design.
- Preserves: the exact `DailyBrief` V1/V1.1 response and existing quest completion endpoint.

- [ ] **Step 1: Write failing controller and service tests**

Controller tests must prove the guarded static route and owner-only call. Service tests must prove:

```ts
{
  questId: "quest-interaction",
  completionType: "interaction",
  contact: { id: "contact-synthetic", name: "Synthetic Person" },
}
```

and:

```ts
{
  questId: "quest-reminder",
  completionType: "reminder",
  contact: { id: "contact-synthetic", name: "Synthetic Person" },
  reminder: {
    id: "reminder-synthetic",
    title: "Synthetic follow-up",
    scheduledAt: new Date("2026-07-18T08:00:00.000Z"),
    status: "pending",
  },
}
```

Also prove identical `404` for foreign quest, missing contact, demo contact, mismatched reminder/contact, and invalid stored completion type. Assert explicit selects omit contact/reminder bodies and owner IDs.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter @socos/api test -- --runInBand \
  src/modules/briefs/briefs.controller.spec.ts \
  src/modules/briefs/brief-feedback.service.spec.ts
```

Expected: failure because the read method and route do not exist.

- [ ] **Step 3: Implement `getQuestAction` with least-privilege reads**

Read the quest through `{id,ownerId}` with `completionType`, `targetId`, and brief-item `contactId`. Resolve the non-demo contact with a minimal name select. For reminder quests, require the target reminder to match owner, target ID, brief-item contact ID, and non-demo contact parity. Throw `NotFoundException("Quest action not found")` for every non-servable case.

- [ ] **Step 4: Add the controller route without changing DailyBrief**

```ts
@Get("quests/:questId/action")
questAction(
  @Request() request: AuthenticatedRequest,
  @Param("questId") questId: string
) {
  return this.feedback.getQuestAction(request.user.userId, questId);
}
```

- [ ] **Step 5: Extend the security regression and verify stable presenter tests**

Run:

```bash
pnpm --filter @socos/api test -- --runInBand \
  src/modules/briefs/briefs.controller.spec.ts \
  src/modules/briefs/brief-feedback.service.spec.ts \
  src/modules/briefs/briefs.presenter.spec.ts
pnpm --filter @socos/agent-core test
pnpm --filter @socos/api type:check
node --test scripts/security-regression.test.mjs
git diff --check
```

- [ ] **Step 6: Commit Task 2**

```bash
git add services/api/src/modules/briefs scripts/security-regression.test.mjs
git commit -m "feat(api): expose verified quest targets"
```

---

### Task 3: Build The Readable Today And Approvals Workspaces

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/api-client.test.ts`
- Create: `apps/web/src/lib/cockpit-contracts.ts`
- Create: `apps/web/src/app/dashboard/today/cockpit-view.ts`
- Create: `apps/web/src/app/dashboard/today/cockpit-view.test.ts`
- Create: `apps/web/src/app/dashboard/today/page.tsx`
- Create: `apps/web/src/app/dashboard/today/daily-cockpit.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/brief-focus-list.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/quest-list.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/reminder-list.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/momentum-summary.tsx`
- Create: `apps/web/src/app/dashboard/approvals/page.tsx`
- Create: `apps/web/src/app/dashboard/approvals/approvals-workspace.tsx`
- Create: `apps/web/src/app/dashboard/approvals/_components/proposal-row.tsx`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/dashboard/_components/dashboard-shell.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `DailyBrief` as a type-only import from `@socos/agent-core`, cockpit contracts, and existing `apiJson`.
- Produces: `/dashboard/today`, `/dashboard/approvals`, root redirect, real desktop/mobile navigation, independent panel states.
- Defers: mutations other than explicit brief generation and approval-history filtering to Task 4.

- [ ] **Step 1: Write failing pure-view and API-error tests**

Cover:

- V1 has no events and V1.1 preserves ordered events;
- quest-to-item association and counts;
- ready-empty, not-ready, partial-error, and loaded view states;
- health/status labels include text, not only color;
- dates use `Intl.DateTimeFormat` with the brief timezone;
- `ApiError` retains a top-level safe response `code` such as `BRIEF_NOT_READY`;
- unknown error bodies never become codes.

- [ ] **Step 2: Run web tests and confirm RED**

```bash
pnpm --filter @socos/web test -- \
  src/lib/api-client.test.ts \
  src/app/dashboard/today/cockpit-view.test.ts
```

Expected: failures because the contracts and view functions do not exist.

- [ ] **Step 3: Add the workspace type dependency and contracts**

Add `"@socos/agent-core": "workspace:*"` to web dependencies. Import `DailyBrief` only as a type. Define exact approval history, quest action, reminder, streak, and gamification responses in `cockpit-contracts.ts`; do not use `any` or raw Prisma types.

- [ ] **Step 4: Implement structured `ApiError.code`**

Extend the error parser to return `{message,code}` only when `code` is a non-empty string. Preserve existing status/message behavior and add tests for JSON, string, array-message, and malformed bodies.

- [ ] **Step 5: Implement the read-only Today orchestration**

Fetch brief, reminders, stats, streak, and approval history independently with abort controllers. On exact `ApiError(404,"BRIEF_NOT_READY")`, render one `Generate today's brief` command; call `POST /api/briefs/generate` only after that explicit command. Use semantic sections and lists with `aria-busy`, alert/retry, and distinct empty states.

- [ ] **Step 6: Implement the dedicated Approvals workspace**

Use `?status=all|pending|approved|rejected|expired` in the route and request. Render exact action-specific previews, client name, decision/grant/execution status, timestamps, and truthful copy. Pending items show disabled action placeholders until Task 4; approved items say `Approval granted`, never `Sent`.

- [ ] **Step 7: Update the shell and mobile navigation**

Root `/dashboard` redirects to `/dashboard/today`. Sidebar order is Today, Contacts, Approvals, then disabled Calendar/Gamification/Settings. Add a fixed safe-area mobile nav with three 44px destinations and bottom padding on page content. Brand links to `/dashboard/today`. Expose existing user/stats/upcoming count through context so Today does not duplicate those shell reads.

- [ ] **Step 8: Implement the restrained responsive layout**

Use `lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]`, full-width section bands, individual repeated cards only, and no nested cards. Add reduced-motion overrides for existing animations. Confirm every fixed-format control has stable dimensions and text wrapping.

- [ ] **Step 9: Verify and commit Task 3**

```bash
pnpm --filter @socos/web test
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
git diff --check
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add daily cockpit workspaces"
```

---

### Task 4: Add Durable Cockpit Actions And Browser Proof

**Files:**
- Create: `apps/web/src/app/dashboard/today/intent-registry.ts`
- Create: `apps/web/src/app/dashboard/today/intent-registry.test.ts`
- Create: `apps/web/src/app/dashboard/today/_components/brief-item-actions.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/snooze-dialog.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/reminder-dialog.tsx`
- Create: `apps/web/src/app/dashboard/today/_components/quest-completion-dialog.tsx`
- Modify: `apps/web/src/app/dashboard/today/daily-cockpit.tsx`
- Modify: `apps/web/src/app/dashboard/today/_components/brief-focus-list.tsx`
- Modify: `apps/web/src/app/dashboard/today/_components/quest-list.tsx`
- Modify: `apps/web/src/app/dashboard/today/_components/reminder-list.tsx`
- Modify: `apps/web/src/app/dashboard/approvals/approvals-workspace.tsx`
- Modify: `apps/web/src/app/dashboard/approvals/_components/proposal-row.tsx`
- Create: `apps/web/e2e/daily-cockpit.spec.ts`
- Modify: `apps/web/.gitignore` only if new generated browser artifacts are not already ignored

**Interfaces:**
- Consumes: brief feedback, quest action/completion, interaction create, reminder create/complete, proposal approve/reject.
- Produces: truthful Keep/Snooze/Dismiss, reminder, verified quest, reminder-complete, approval, and rejection journeys.
- Preserves: the same key across retries of one unresolved feedback/quest intent.

- [ ] **Step 1: Write failing intent-registry tests**

Prove keys match the server regex, the same `resource+operation+canonical body` reuses a key, changed bodies receive a different key, `resolve()` clears only the matching intent, and transport failure does not clear it.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @socos/web test -- src/app/dashboard/today/intent-registry.test.ts
```

- [ ] **Step 3: Implement Keep, snooze, and dismiss**

Post exact bodies and `Idempotency-Key`. Label `accept` as `Keep`, never `Done`. Snooze choices are `24 hours` and `7 days` using absolute future instants. Dismiss has an optional 500-character reason. Disable only the affected item, retain dialog input on error, and refetch the durable brief after every resolved or unknown outcome.

- [ ] **Step 4: Implement contact and reminder actions**

Open contacts with `/dashboard/contacts?contact=<encoded-id>`. The reminder dialog posts the existing exact DTO, uses one submit attempt per click, and refreshes reminders on success. Upcoming reminder completion uses `PUT /api/reminders/:id/complete` and updates both shell count and Today list.

- [ ] **Step 5: Implement verified quest completion**

Fetch the quest action target when the quest expands.

- Interaction: collect type/title/notes/occurredAt, create the interaction, retain the returned interaction ID, then complete the quest with that ID and a stable key.
- Reminder: display the exact target reminder, complete it once, retain the reminder ID, then complete the quest with that ID and a stable key.
- If evidence creation/completion succeeds but quest completion fails, retry only the quest request with retained evidence/key.
- After success, refresh brief, reminders, dashboard stats, and streak.

- [ ] **Step 6: Implement approval decisions**

Pending proposal rows call approve/reject, disable only that row, retain errors, and refetch history. Approval success displays the returned grant state and expiry, never execution success. No browser code calls an approved-action executor.

- [ ] **Step 7: Write the intercepted Playwright journey**

Synthetic interception must prove:

- `/dashboard` redirects to Today and desktop/mobile nav is usable;
- exact `404 BRIEF_NOT_READY` generation fallback;
- V1 and V1.1 rendering without fake events;
- exact feedback bodies and regex-valid stable idempotency headers;
- contact URL opening and reminder creation/completion;
- interaction quest creates evidence then completes with its returned ID;
- reminder quest loads and completes the exact existing target before quest completion;
- pending approval approve/reject and history refresh with truthful status copy;
- independent brief/reminder/approval failures do not blank successful sections;
- keyboard operation, focus restoration, Escape behavior, and reduced-motion-compatible dialogs;
- `document.documentElement.scrollWidth <= 412` at Pixel `412x915`.

- [ ] **Step 8: Run the browser proof against a local production build**

```bash
pnpm --filter @socos/web build
pnpm --filter @socos/web start -- -p 3210
SOCOS_E2E_BASE_URL=http://127.0.0.1:3210 \
  pnpm --filter @socos/web exec playwright test e2e/daily-cockpit.spec.ts
```

Expected: all desktop and Pixel cases pass with synthetic data only. Stop the server after the suite.

- [ ] **Step 9: Verify and commit Task 4**

```bash
pnpm --filter @socos/web test
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
git diff --check
git add apps/web
git commit -m "feat(web): make daily cockpit actionable"
```

---

### Task 5: Independent Review, Betabots, Deployment, And Evidence

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Create: `.superpowers/sdd/daily-cockpit-task-*.md` reports
- Modify: `docs/ai-handoff-2026-07-16.md`

**Interfaces:**
- Consumes: reviewed Tasks 1-4.
- Produces: exact-SHA deployment and current handoff evidence.

- [ ] **Step 1: Obtain independent task reviews**

After each task, give a fresh read-only reviewer the plan task, commit range, and relevant tests. Fix every Critical/Important finding test-first and require an explicit re-review verdict.

- [ ] **Step 2: Run broad verification**

```bash
pnpm --filter @socos/api test -- --runInBand \
  src/modules/agent-security/approval.controller.spec.ts \
  src/modules/agent-security/action-proposal.service.spec.ts \
  src/modules/briefs/briefs.controller.spec.ts \
  src/modules/briefs/brief-feedback.service.spec.ts \
  src/modules/briefs/briefs.presenter.spec.ts
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
pnpm --filter @socos/agent-core test
pnpm --filter @socos/agent-core type:check
pnpm --filter @socos/web test
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
node --test scripts/security-regression.test.mjs scripts/package-guards.test.mjs scripts/coolify-operations.test.mjs
node scripts/security-regression.mjs
git diff --check
```

- [ ] **Step 3: Run the synthetic Betabots cohort**

Use the Betabots skill with at least five research-weighted Yev-like personas covering low-energy day, professional networking, close-friend maintenance, important-date urgency, and approval skepticism. Bots use only the browser and synthetic intercepted or staging data. Fix repeated high-severity usability/trust defects, preserve unhappy stories, and rerun affected journeys.

- [ ] **Step 4: Push and deploy an exact reviewed SHA**

Push `main`, verify `origin/main`, deploy with `scripts/coolify.sh`, and require Coolify to report the exact full SHA and `running:healthy`. Do not enable Calendar, location, event discovery, or event brief flags in this slice.

- [ ] **Step 5: Run aggregate-only production smoke**

Verify public health, authenticated-route protection, Today/Approvals route availability, MCP protection, disabled OwnTracks behavior, and the existing aggregate `106` non-demo / `7` demo contact invariant. Do not emit personal rows or proposal previews.

- [ ] **Step 6: Update evidence and handoff**

Record exact commits, review verdicts, test counts, browser/Pixel results, Betabots findings, deployment UUID/SHA, health status, aggregate smoke, and remaining Calendar/Pixel/outbound/invite roadmap. Commit the documentation locally without triggering an unnecessary second runtime deployment.

## Self-Review

- Spec coverage: approval history, safe previews, quest targets, read-only states, supported actions, verified XP, reminders, approvals, responsive navigation, browser proof, Betabots, deployment, and handoff all have explicit tasks.
- Stable contract: no task changes `DailyBrief` V1/V1.1.
- Security: no browser agent credential, direct outbound execution, owner body field, demo contact, raw database type, or production fixture is introduced.
- Type consistency: `ProposalHistoryResponse` and `QuestAction` match the design and are consumed by the web contracts.
- Placeholder scan: no TBD/TODO/"similar to" implementation steps remain.
