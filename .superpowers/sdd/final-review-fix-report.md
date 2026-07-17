# Daily Cockpit Final Review Fix Report

Date: 2026-07-17
Base HEAD: `3ec3193`

## Finding

`QuestCompletionDialog.completeQuest` resolved the completion entry in
`IntentRegistry` before `buildQuestReceipt` validated the successful response.
A malformed or mismatched committed response therefore retired the stable
idempotency key even though the UI rejected the response. Retrying generated a
new key and could not request replay of the durable result under the original
intent.

## Scope

- Added a synthetic browser regression for a durably committed quest completion
  whose first response has a mismatched `questId`.
- The regression proves the first response produces a visible validation error,
  no receipt, and no awarded-XP copy.
- The retry reuses the exact same nonempty `Idempotency-Key` and exact completion
  body, while the already-created interaction evidence is not posted again.
- The durable valid replay produces exactly one focused receipt heading and one
  `+20 XP awarded` value.
- Moved registry resolution after successful receipt construction and validation.

No API, wire-contract, evidence, XP, approval, owner-scoping, schema, dependency,
or deployment changes were made.

## RED Evidence

Command, run before the production edit:

```bash
E2E_BASE_URL=http://127.0.0.1:3210 \
E2E_ALLOWED_HOSTS=127.0.0.1 \
pnpm --filter @socos/web exec playwright test \
  e2e/daily-cockpit.spec.ts \
  --grep "retries a mismatched committed quest response"
```

Result: exit 1, 1 failed. The test reached the final stable-key assertion and
reported different UUIDs for the first and retry requests. This was the expected
failure: the successful-but-mismatched response had caused the registry entry to
be resolved before semantic validation.

## Implementation

`completeQuest` now calls `buildQuestReceipt` immediately after `apiJson` returns.
Only a validated receipt permits `IntentRegistry.resolve`; validation failures
leave the existing intent and key available for retry. The validated receipt is
then returned unchanged.

## GREEN Evidence

- Focused Playwright command above: exit 0, 1/1 passed in 3.1 seconds.
- `pnpm --filter @socos/web test`: exit 0, 8 files and 50/50 tests passed.
- `pnpm --filter @socos/web type:check`: exit 0.
- `ESLINT_USE_FLAT_CONFIG=false pnpm --filter @socos/web exec eslint src/app/dashboard/today/_components/quest-completion-dialog.tsx e2e/daily-cockpit.spec.ts`: exit 0 with only ESLint's configuration deprecation notice.
- `git diff --check`: exit 0 before report creation and rerun as the final pre-commit gate.

## Files

- `.superpowers/sdd/final-review-fix-report.md`
- `apps/web/e2e/daily-cockpit.spec.ts`
- `apps/web/src/app/dashboard/today/_components/quest-completion-dialog.tsx`

## Concerns

- No functional blocker remains.
- ESLint emits its existing eslintrc deprecation notice; there are no lint errors.
- No ignored `.betabots` artifact was read, changed, or staged.
- No push or deployment was performed.
