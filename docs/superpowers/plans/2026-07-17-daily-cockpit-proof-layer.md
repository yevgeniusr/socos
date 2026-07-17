# Daily Cockpit Proof Layer Implementation Plan

**Goal:** Close the repeated reminder proof and quest discoverability friction
from the valid post-fix cohort without changing backend wire contracts.

## Global Constraints

- Approval is not execution.
- XP is displayed only from server-verified quest evidence.
- Preserve DailyBrief V1/V1.1, exact reminder request bodies, stable intent
  keys, owner scoping, and response-loss behavior.
- Never infer reminder type from free text.
- Use synthetic data only.

## Task 1: Structured Person-Date Reminder Draft

Files: `cockpit-view.ts`, `cockpit-view.test.ts`, `brief-focus-list.tsx`, and
`daily-cockpit.spec.ts`.

1. Add failing unit/browser tests for exact contact plus `daysAway` matching,
   birthday prefill from a person card, and follow-up fallback when no exact
   structured date exists.
2. Verify RED.
3. Add a pure matching helper and use the matching date draft when available.
4. Verify focused GREEN and commit.

## Task 2: Persistent Reminder Receipt And Quest Entry Point

Files: `cockpit-view.ts`, `cockpit-view.test.ts`, `reminder-dialog.tsx`,
`daily-cockpit.tsx`, `quest-list.tsx`, and `daily-cockpit.spec.ts`.

1. Add failing tests proving no receipt before POST success; a successful exact
   request yields one focused `Reminder created` receipt with type/title/time;
   refresh failure cannot remove it; response-loss retry reuses the exact key
   and yields one receipt; Pixel shows and follows an open-quest header link.
2. Verify RED.
3. Build the receipt from the final submitted body only after API success, keep
   it independent of refresh state, and focus it after dialog close. Add the
   pending-quest anchor and focusable target.
4. Run web unit tests, typecheck, focused lint, build, and Daily Cockpit plus
   Contacts Playwright. Commit.

## Task 3: Review And Formal Gate

1. Obtain fresh read-only task and whole-slice review; fix all Critical and
   Important findings test-first.
2. Run broad web/API/agent/infrastructure/security/database verification as
   required by changed scope.
3. Run a new real-PostgreSQL, UI-authenticated, GPT-5.5, real-Chrome cohort.
   Use durable completion patterns, not transient toast text.
4. Require happiness at least 70, no Critical defects, at least 90% applicable
   journey completion, and no unresolved high-confidence trust blocker before
   backup, push, or deployment.
