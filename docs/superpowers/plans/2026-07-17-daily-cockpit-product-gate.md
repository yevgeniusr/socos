# Daily Cockpit Product Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the repeated context, action-semantics, reminder, and outcome-traceability friction that caused the valid five-person Daily Cockpit cohort to fail its release gate.

**Architecture:** Keep DailyBrief V1/V1.1 unchanged and derive better decision context from existing `reason`, `lastInteractionAt`, `health`, `evidence`, and date fields. Carry an explicit client-side reminder draft into the existing idempotent reminder dialog. Project outcome receipts from existing proposal grant/outbox state and the verified quest completion response; do not create or imply outbound execution.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Vitest, Playwright, NestJS/Prisma contracts already in place

## Global Constraints

- Automatic reads, summaries, logging, activity updates, and suggestions remain allowed.
- Outbound messages, introductions, invitations, merges, and deletions require approval.
- Approval is not execution; no UI may claim an action was sent or performed because a grant exists.
- XP is awarded only for server-verified quest evidence, never for draft, approval, rejection, or a UI click.
- Preserve exact proposal preview/payload/payload-hash binding, stable intent keys, atomic human idempotency, and owner scoping.
- Preserve the exact DailyBrief V1/V1.1 wire contracts.
- Use synthetic test data only and keep `.betabots/` ignored.

---

### Task 1: Explicit Contact Logging Semantics

**Files:**
- Modify: `apps/web/src/app/dashboard/contacts/_components/contact-list.tsx`
- Modify: `apps/web/src/app/dashboard/contacts/_components/contact-profile.tsx`
- Modify: `apps/web/src/app/dashboard/contacts/_components/interaction-form.tsx`
- Test: `apps/web/e2e/contacts-workspace.spec.ts`

**Interfaces:**
- Consumes: existing `ContactQuickAction = "call" | "message" | "reminder"` routing.
- Produces: visible `Log call` and `Log message` commands that still open the existing interaction form and write no outbound action.

- [ ] **Step 1: Add a failing browser assertion**

Assert that list/profile quick actions are named `Log call` and `Log message`, and that selecting `Log message` opens a form headed `Log interaction` without any sent/delivered copy.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @socos/web exec playwright test e2e/contacts-workspace.spec.ts --grep "logs a message"`; expect a label mismatch.

- [ ] **Step 3: Implement the copy-only semantic correction**

Keep the internal action value `message`, but change every user-facing quick-action label/title/accessible name from `Message` to `Log message` and `Call` to `Log call` where it represents retrospective CRM logging. Do not add a send button or proposal flow in this task.

- [ ] **Step 4: Verify GREEN**

Run the focused Playwright test and `pnpm --filter @socos/web type:check`; expect exit 0.

- [ ] **Step 5: Commit**

Commit only Task 1 files with `fix(contacts): clarify interaction logging actions`.

---

### Task 2: Explainable Focus Cards And Structured Reminder Drafts

**Files:**
- Modify: `apps/web/src/app/dashboard/today/cockpit-view.ts`
- Modify: `apps/web/src/app/dashboard/today/cockpit-view.test.ts`
- Modify: `apps/web/src/app/dashboard/today/_components/brief-focus-list.tsx`
- Modify: `apps/web/src/app/dashboard/today/_components/reminder-dialog.tsx`
- Modify: `apps/web/src/app/dashboard/today/daily-cockpit.tsx`
- Test: `apps/web/e2e/daily-cockpit.spec.ts`

**Interfaces:**
- Produces: `ReminderDraft` containing `contact`, `type`, `title`, `scheduledAt`, and `sourceLabel`.
- Produces: pure view helpers for strongest signal and last-interaction labels using only stable DailyBrief fields.

- [ ] **Step 1: Add failing unit and browser tests**

Cover: cadence evidence renders as `61 days overdue`; `lastInteractionAt` renders as a date or `No interaction logged`; the health score is secondary to an explainable band/reason; opening from a birthday date preloads type `birthday`, the date title, and the source date; opening from a person item preloads `followup` for tomorrow without changing stable wire contracts.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @socos/web test -- cockpit-view.test.ts` and the matching Daily Cockpit Playwright grep; expect missing helpers/prefills.

- [ ] **Step 3: Implement pure context helpers and `ReminderDraft` flow**

Select the strongest known signal in this order: pending date/reminder reason supplied by the item, `days_overdue`, then the existing reason. Display `healthBandLabel` with the numeric score as secondary evidence. Build the reminder draft from structured item fields; never infer reminder type from free text. Serialize the existing exact reminder body and continue using `IntentRegistry` for its final value.

- [ ] **Step 4: Verify GREEN**

Run web unit tests, focused Playwright, and web typecheck; expect exit 0.

- [ ] **Step 5: Commit**

Commit only Task 2 files with `feat(cockpit): add actionable context and reminder prefills`.

---

### Task 3: Truthful Approval Outcome Receipts

**Files:**
- Modify: `apps/web/src/app/dashboard/approvals/proposal-view.ts`
- Modify: `apps/web/src/app/dashboard/approvals/proposal-view.test.ts`
- Modify: `apps/web/src/app/dashboard/approvals/_components/proposal-row.tsx`
- Modify: `apps/web/src/app/dashboard/approvals/approvals-workspace.tsx`
- Test: `apps/web/e2e/daily-cockpit.spec.ts`

**Interfaces:**
- Produces: pure receipt projection with decision, execution, and progress copy from `ProposalHistoryResponse` only.

- [ ] **Step 1: Add failing receipt tests**

Assert rejected means `Nothing sent` and `No XP or quest progress awarded`; approved with no outbox means `Execution not requested`; queued/running/completed/failed outbox states are rendered without converting approval into execution; a just-decided proposal remains visible by switching to its decided history filter or retaining a local receipt.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @socos/web test -- proposal-view.test.ts`; expect missing receipt projection.

- [ ] **Step 3: Implement receipts from existing state**

Add concise receipt rows. Preserve the exact reviewed preview before approval. Do not expose payloads, credentials, private error details, or invent a report URL that the API does not provide.

- [ ] **Step 4: Verify GREEN**

Run proposal unit tests, the approval Playwright journey, and web typecheck; expect exit 0.

- [ ] **Step 5: Commit**

Commit only Task 3 files with `feat(approvals): show truthful decision receipts`.

---

### Task 4: Verified Quest Completion Receipt

**Files:**
- Modify: `apps/web/src/app/dashboard/today/_components/quest-completion-dialog.tsx`
- Modify: `apps/web/src/app/dashboard/today/_components/quest-list.tsx`
- Modify: `apps/web/src/app/dashboard/today/daily-cockpit.tsx`
- Modify: `apps/web/src/app/dashboard/today/cockpit-view.ts`
- Modify: `apps/web/src/app/dashboard/today/cockpit-view.test.ts`
- Test: `apps/web/e2e/daily-cockpit.spec.ts`

**Interfaces:**
- Produces: `QuestReceipt = { questId, title, evidenceType, verifiedAt, xpAwarded }` populated only after the server accepts evidence.

- [ ] **Step 1: Add failing receipt tests**

Assert the receipt is absent before success; after verified interaction/reminder completion it shows evidence type, verification time, and server-owned quest XP; retries cannot duplicate the receipt or XP; focus moves to the receipt heading.

- [ ] **Step 2: Verify RED**

Run the focused cockpit unit and Playwright quest tests; expect the receipt to be absent.

- [ ] **Step 3: Implement the post-success receipt**

Create the receipt only from a successful quest completion response plus the quest's server-presented reward. Keep the dialog open on errors, preserve lost-response recovery, and never award or display progress for an unverified interaction/reminder.

- [ ] **Step 4: Verify GREEN**

Run cockpit unit tests, both interaction/reminder quest Playwright journeys, and web typecheck; expect exit 0.

- [ ] **Step 5: Commit**

Commit only Task 4 files with `feat(cockpit): show verified quest receipts`.

---

### Task 5: Review, Broad Verification, Betabots, And Release

- [ ] Obtain a fresh read-only review for every task and fix all Critical/Important findings test-first.
- [ ] Run API focused/default tests, web and agent-core tests, typechecks, builds, lint, infrastructure/security/database suites, real-PostgreSQL idempotency integration, migration harness, and desktop/Pixel Playwright.
- [ ] Run the formal real-backend Betabots cohort with real PostgreSQL, UI-created auth, real browsers, GPT-5.5 minds, synthetic data, four-to-five minutes or six-to-eight actions, and at least one required completed activity.
- [ ] Require happiness at least 70, no Critical defects, at least 90% applicable journey completion, and no unresolved high-confidence trust blocker.
- [ ] Take and verify a fresh Coolify backup, push the exact reviewed SHA, deploy that SHA, require `running:healthy`, and perform aggregate-only production smoke without enabling Calendar/location/event flags.

## Self-Review

- Spec coverage: all four repeated formal-cohort product findings have an explicit task; the short-session measurement limitation is addressed in Task 5.
- Stable contracts: no task changes DailyBrief V1/V1.1 or weakens approval, XP, owner, evidence, or idempotency boundaries.
- Type consistency: `ReminderDraft` and `QuestReceipt` are defined once in their owning slice and passed explicitly.
- Placeholder scan: no deferred implementation placeholder is part of the release scope.
