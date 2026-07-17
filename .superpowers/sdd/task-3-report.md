# Task 3 Report: Truthful Approval Outcome Receipts

Status: `DONE`

## Implementation

- Added a pure `proposalReceipt` projection derived only from `ProposalHistoryResponse` proposal, grant, and outbox fields.
- Kept the decision separate from execution: approval always remains `Approval granted`; execution states are rendered independently.
- Made rejected and expired non-effects explicit with `Nothing sent` and `No XP or quest progress awarded`.
- Used `Execution not requested` when an approved proposal has no outbox, and avoided claiming XP/quest effects that the history response does not report.
- Added a compact semantic decision receipt to proposal rows while preserving the original server-projected preview.
- Removed raw `lastErrorCode` display so provider/private execution details are not exposed.
- Added a pure post-decision filter projection. Decisions made from `pending` move to the matching `approved` or `rejected` history filter; filters that already include the proposal are retained.
- Kept unavailable persisted envelopes fail-closed without a receipt.
- Mapped the real persisted outbox vocabulary: `pending` to queued, `processing` to running, plus completed, failed, and cancelled outcomes.
- Pinned the exact reviewed proposal locally after a successful decision POST. The pin remains visible through decided-history omissions, first-page limits, loading, and refresh errors.
- Merged newer durable grant/outbox state into the pin without replacing the exact reviewed preview. Monotonic progression prevents later stale, omitted, or failed history from regressing processing or terminal execution back to `Execution not requested`.
- Added a concise polite live confirmation and deterministic focus on the decided receipt heading for both approval and rejection. A hidden incrementing confirmation token makes repeated same-type decisions produce fresh live-region text while visible copy stays concise.

## TDD Evidence

Initial receipt RED:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
7 failed: missing proposalReceipt and completed execution replaced approval copy
```

Filter visibility RED:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
3 failed: missing proposalHistoryStatusAfterDecision
```

Unavailable-envelope RED:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
1 failed: unavailable action projected an approval receipt
```

Each RED was followed by the minimal implementation and a focused GREEN run.

Review follow-up RED:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
# 8 failed: real pending/processing/cancelled mappings and local pin helpers missing

E2E_BASE_URL=http://localhost:3103 E2E_ALLOWED_HOSTS=localhost \
  pnpm --filter @socos/web exec playwright test \
  e2e/daily-cockpit.spec.ts \
  --grep "performs durable cockpit actions with exact contracts"
# failed after approval: omitted decided history removed the exact reviewed preview
```

The first browser GREEN attempt then exposed a focus race and failed on the receipt heading. The focus effect was tightened to record completion only after the heading exists and actually receives focus; the rerun passed.

Third review RED:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
# 3 failed: durable pin merge and unique repeated-announcement projection missing

E2E_BASE_URL=http://localhost:3103 E2E_ALLOWED_HOSTS=localhost \
  pnpm --filter @socos/web exec playwright test \
  e2e/daily-cockpit.spec.ts \
  --grep "performs durable cockpit actions|announces and focuses consecutive approval receipts"
# durable response replaced the exact preview; repeated approval lacked a fresh confirmation token
```

## Verification

Final combined gate:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
# 8 files passed, 50 tests passed

pnpm --filter @socos/web type:check
# exit 0

ESLINT_USE_FLAT_CONFIG=false pnpm --filter @socos/web exec eslint \
  src/app/dashboard/approvals/proposal-view.ts \
  src/app/dashboard/approvals/proposal-view.test.ts \
  src/app/dashboard/approvals/_components/proposal-row.tsx \
  src/app/dashboard/approvals/approvals-workspace.tsx
# exit 0; only the repository's ESLint 9 legacy-config deprecation warning

E2E_BASE_URL=http://localhost:3103 E2E_ALLOWED_HOSTS=localhost \
  pnpm --filter @socos/web exec playwright test \
  e2e/daily-cockpit.spec.ts \
  --grep "performs durable cockpit actions|announces and focuses consecutive approval receipts"
# 2 passed
```

The shared Daily Cockpit journey now verifies approve and reject filter transitions, exact preview retention, receipt copy, no-execution/no-progress semantics, live confirmation, and focus. Its approved-history mock first returns durable processing state, then omits the proposal, then fails refresh; the receipt remains `Execution running` throughout. A second focused browser test verifies consecutive approvals produce different accessible confirmation text and focus the new receipt.

## Self-Review

- Receipt projection does not read or render payloads, credentials, raw execution errors, or invented report URLs.
- Approval remains a grant decision and is never relabeled as successful execution.
- The local fallback is created only after a successful decision response and changes only the proposal status known from that response. It preserves the exact preview object and does not invent a decision time, grant, outbox state, payload, or report URL.
- Durable grant/outbox state is merged monotonically into the pin while the original preview reference is retained.
- Staged scope is limited to the Task 3 approval implementation/tests, Task 3 E2E hunks, and this report. Concurrent Task 4 E2E and Today implementation changes remain unstaged.

## Coordination Note

`apps/web/e2e/daily-cockpit.spec.ts` also has concurrent unstaged Task 4 review edits. Only the Task 3 approval hunks are included in this commit, per parent coordination.
