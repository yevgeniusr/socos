# Task 4 Report: Contacts Browser Proof

## Status

DONE

Base: `635835f1c86c70a14a2529bd559121aad8bf7c46`

## Scope

- Added deterministic Playwright evidence for the authenticated Contacts workspace.
- All API interception uses synthetic owners, contacts, interaction text, reminders, and credentials.
- Added repository ignores for local Playwright reports and test output.
- No production UI, API, schema, dependency, or personal data changed in this task.

## Initial Browser Evidence

After writing the complete intercepted browser suite, the first run was:

```bash
E2E_BASE_URL=http://127.0.0.1:3010 \
E2E_ALLOWED_HOSTS=127.0.0.1 \
pnpm --filter @socos/web exec playwright test \
  e2e/contacts-workspace.spec.ts --project=chromium --workers=1
```

Result: one desktop test failed and the Pixel test passed. The failure was test-only: `toMatchObject` incorrectly required an explicit `relationshipScore: undefined` property even though the production payload correctly omitted it. After correcting that assertion, the second run exposed another test-only strict-locator ambiguity between `Remind` and `Complete reminder ...`. Making the intended `Remind` selector exact resolved it. No product defect was concealed or weakened; the assertions now directly prove both forbidden-field omission and the intended button target.

The current workspace behavior, including the separately reviewed Task 3 focus fix, satisfied the complete browser specification without additional production edits.

## Green Browser Evidence

Final focused command:

```bash
E2E_BASE_URL=http://127.0.0.1:3010 \
E2E_ALLOWED_HOSTS=127.0.0.1 \
pnpm --filter @socos/web exec playwright test \
  e2e/contacts-workspace.spec.ts --project=chromium --workers=1
```

Result: **PASS**, 2 tests passed in 5.6 seconds.

The desktop journey proves:

- `/dashboard` redirects to `/dashboard/contacts`.
- The first list request uses `limit=25` and `offset=0` and renders `Showing 1-25 of 106`.
- Next requests `offset=25`, renders `Showing 26-50 of 106`, and exposes a page-two contact.
- Debounced `mentor` search and the `AI Founders` label both reset the server offset to zero.
- Enter on a contact updates `?contact=synthetic-mentor` and opens the accessible profile.
- The profile renders synthetic memory, contact method, important dates, interaction, and reminder evidence.
- Profile editing sends the complete edited `contactFields` array while omitting `ownerId`, `sourceId`, and `relationshipScore`.
- Interaction and reminder creation send the expected validated payloads.
- Reminder completion calls the expected contact-owned reminder endpoint.

The Pixel `412x915` journey proves:

- Add Contact focus wraps from the first modal control to the last and back with Shift+Tab/Tab.
- The contact profile is visible as a full-screen dialog with a visible close control.
- `document.documentElement.scrollWidth <= window.innerWidth` is true.
- A local synthetic screenshot was visually inspected: the sheet, actions, score, relationship details, methods, and dates are readable with no overlap. Generated Playwright output was not committed.

## Broad Verification

```text
Web Vitest: 4 suites, 14 tests passed
Web typecheck: passed
Web lint: passed with 0 errors and 38 pre-existing warnings
Web production build: passed; 13 pages generated
Contacts/interactions/reminders Jest: 6 suites, 103 tests passed
API typecheck: passed
Security and packaging node tests: 58/58 passed
Prettier check: passed
git diff --check: passed
```

## Files Changed

- `.gitignore`
- `apps/web/e2e/contacts-workspace.spec.ts`
- `.superpowers/sdd/contacts-task-4-report.md`

## Self-Review

- Synthetic fixtures use reserved `.test` email/URL values and contain no production contact or location values.
- The API handler rejects unhandled synthetic routes with a fixed 404, so a missing interception cannot silently reach a real backend.
- Assertions inspect URL query parameters and mutation bodies instead of relying only on rendered text.
- The host policy requires an explicit non-production allowlist and the test ran only on loopback.
- Playwright reports, screenshots, traces, and test results are now ignored repository-wide.

## Concerns

None. Task 5 still requires an independent review of this test task and a whole-slice review before push/deployment.
