# Task 3 Report: Truthful Approval Outcome Receipts

Status: `DONE_WITH_CONCERNS`

## Implementation

- Added a pure `proposalReceipt` projection derived only from `ProposalHistoryResponse` proposal, grant, and outbox fields.
- Kept the decision separate from execution: approval always remains `Approval granted`; queued, running, completed, and failed execution states are rendered independently.
- Made rejected and expired non-effects explicit with `Nothing sent` and `No XP or quest progress awarded`.
- Used `Execution not requested` when an approved proposal has no outbox, and avoided claiming XP/quest effects that the history response does not report.
- Added a compact semantic decision receipt to proposal rows while preserving the original server-projected preview.
- Removed raw `lastErrorCode` display so provider/private execution details are not exposed.
- Added a pure post-decision filter projection. Decisions made from `pending` move to the matching `approved` or `rejected` history filter; filters that already include the proposal are retained.
- Kept unavailable persisted envelopes fail-closed without a receipt.

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

## Verification

Final combined gate:

```text
pnpm --filter @socos/web test -- proposal-view.test.ts
# 8 files passed, 42 tests passed

pnpm --filter @socos/web type:check
# exit 0

ESLINT_USE_FLAT_CONFIG=false pnpm --filter @socos/web exec eslint \
  src/app/dashboard/approvals/proposal-view.ts \
  src/app/dashboard/approvals/proposal-view.test.ts \
  src/app/dashboard/approvals/_components/proposal-row.tsx \
  src/app/dashboard/approvals/approvals-workspace.tsx
# exit 0; only the repository's ESLint 9 legacy-config deprecation warning
```

An isolated Playwright approval journey ran against local Next.js on port 3103 and passed. It verified approve and reject redirects, exact preview retention, and all required receipt copy.

The shared `daily-cockpit.spec.ts` was not modified because the parent agent owns it for concurrent Tasks 2/4. Two attempts to run its existing durable journey did not reach the approval assertions: one stopped at the pre-existing dashboard redirect expectation, and the second stopped at an in-progress Task 4 `Quest verified` assertion. No Task 3 E2E hunk remains in that shared file.

## Self-Review

- Receipt projection does not read or render payloads, credentials, raw execution errors, or invented report URLs.
- Approval remains a grant decision and is never relabeled as successful execution.
- The workspace re-fetches the proposal from its durable decided-history filter instead of fabricating grant/outbox state locally.
- Staged scope is limited to the four approval implementation/test files and this report.

## Concern

The exact shared cockpit Playwright spec could not produce a clean run while concurrent Task 4 changes were incomplete. The isolated approval browser journey passed, but the parent should rerun the combined shared journey after integrating Tasks 2/4 E2E work.
