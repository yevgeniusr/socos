# Personal Contacts Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-demo Monica contact reachable and actionable through a responsive authenticated Contacts workspace with profile editing, contact methods, interactions, and reminders.

**Architecture:** Extend the existing owner-scoped Contacts API without a schema migration, converge interaction/reminder action integrity, then extract a route-backed dashboard shell with a server-driven `/dashboard/contacts` master-detail workspace. Keep selected-contact state in the URL and verify the UI with synthetic intercepted API data.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11, Prisma 6/PostgreSQL 15, Jest 29, Next.js 15, React 19, Tailwind CSS 4, Vitest 4, Playwright 1.58, pnpm 10.10.0.

## Global Constraints

- Coolify PostgreSQL remains the sole source of truth for real personal data. Never copy, print, log, screenshot, or commit production contact values.
- Tests, fixtures, and browser interceptions use synthetic people and values only.
- Every read and mutation derives `ownerId` from the authenticated request; caller-provided ownership is forbidden.
- Non-demo contacts are the default personal workspace. Demo contacts do not contribute list/facet totals.
- List and detail responses use explicit projections; provider source IDs and unrelated personal columns are not returned.
- Do not add a migration or frontend dependency for this slice.
- `contactFields` omitted means preserve, an empty array means clear, and a provided array means complete atomic replacement.
- At most one primary contact field is allowed per field type.
- `relationshipScore` is read-only; social links accept allowlisted keys with HTTP(S) values and are stored as JSON objects.
- Human interaction writes use the existing serializable transactional service; recurring reminder completion claims a pending row and creates at most one successor atomically.
- Use test-first development and record the failing command/output before production edits.
- Preserve existing agent/brief approval boundaries and disabled Calendar/location/event flags.
- Essential actions must work by keyboard and touch; mobile viewport target is `412x915` with no horizontal overflow or incoherent overlap.
- Deploy only an exact pushed SHA after fresh verification; production evidence remains aggregate-only.

---

### Task 1: Harden And Extend The Contact API Contract

**Files:**
- Modify: `services/api/src/modules/contacts/contacts.dto.ts`
- Modify: `services/api/src/modules/contacts/contacts.service.ts`
- Modify: `services/api/src/modules/contacts/contacts.controller.ts`
- Modify: `services/api/src/modules/contacts/contacts.dto.spec.ts`
- Modify: `services/api/src/modules/contacts/contacts.service.spec.ts`
- Modify: `services/api/src/modules/contacts/contacts.controller.spec.ts`

**Interfaces:**
- Consumes: existing `Contact`, `ContactField`, `Interaction`, and `Reminder` Prisma relations.
- Produces: bounded `ContactQueryDto`; `CreateContactDto.contactFields?`; `UpdateContactDto.contactFields?`, `groups?`, `firstMetDate?`, and `firstMetContext?`; explicit list response `{ contacts, total, offset, limit }`; explicit detail response including ordered `contactFields`; `/contacts/groups` facet endpoint.

- [ ] **Step 1: Write failing DTO/query contract tests**

Add tests that run values through `createApplicationValidationPipe()` and prove:

```ts
await expect(transform(ContactQueryDto, { limit: '25', offset: '0' }))
  .resolves.toMatchObject({ limit: 25, offset: 0 });
await expect(transform(ContactQueryDto, { limit: '101' })).rejects.toBeDefined();
await expect(transform(ContactQueryDto, { sortBy: 'ownerId' })).rejects.toBeDefined();
await expect(transform(ContactQueryDto, { group: 'Mentors' }))
  .resolves.toMatchObject({ group: 'Mentors' });
await expect(validateDto(CreateContactDto, {
  firstName: 'Synthetic',
  contactFields: [{ type: 'email', value: 'person@example.test', isPrimary: true }],
})).resolves.toEqual([]);
```

Also reject unsupported field types, blank/oversized values, non-boolean `isPrimary`, too many fields, invalid `groups`, arbitrary `relationshipScore`, unsafe social-link keys/URLs, and invalid/nullable first-met dates as defined by the design.

- [ ] **Step 2: Run DTO tests and record the expected RED result**

Run:

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/contacts/contacts.dto.spec.ts
```

Expected: FAIL because the query bounds/enums and nested field/profile contracts do not exist.

- [ ] **Step 3: Implement the DTO contract minimally**

Use `@Type(() => Number)`, `@IsInt()`, `@Min()`, `@Max()`, `@IsEnum()`, `@ValidateNested({ each: true })`, `@ArrayMaxSize(20)`, and `@Type(() => ContactFieldDto)`. Define fixed enums:

```ts
export enum ContactSortBy {
  CREATED_AT = 'createdAt',
  FIRST_NAME = 'firstName',
  LAST_CONTACTED_AT = 'lastContactedAt',
  RELATIONSHIP_SCORE = 'relationshipScore',
  NEXT_REMINDER_AT = 'nextReminderAt',
}

export enum SortOrder { ASC = 'asc', DESC = 'desc' }
export const CONTACT_FIELD_TYPES = ['email', 'phone', 'address', 'website', 'other'] as const;
```

Defaulting stays in the service; validation only accepts `limit 1..100`, `offset >= 0`, and the fixed sort values.

- [ ] **Step 4: Write failing service tests**

Add focused tests proving:

```ts
expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ ownerId: 'synthetic-owner', isDemo: false }),
  skip: 25,
  take: 25,
}));
expect(detail.contactFields).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'email', value: 'person@example.test' }),
]));
expect(prisma.contact.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    contactFields: { deleteMany: {}, create: expect.any(Array) },
  }),
}));
```

Cover list/facet demo exclusion including groups, deterministic allowlisted sorting, exact list/detail projections, absence of `sourceId`, owner-scoped non-demo detail, fields preserved when omitted, fields cleared by `[]`, whitespace normalization, duplicate-primary rejection, serializable replacement, `firstMetDate` conversion/clearing, groups/context persistence, and social-links object/legacy-string reads.

- [ ] **Step 5: Run service tests and record the expected RED result**

Run:

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/contacts/contacts.service.spec.ts
```

Expected: FAIL because list isolation, detail fields, nested writes, and profile conversion are missing.

- [ ] **Step 6: Implement the minimum service behavior**

Use constants `DEFAULT_LIMIT=25` and `MAX_LIMIT=100`. Build the order with an allowlisted DTO enum and stable `id` tie-breaker. Add `isDemo:false` to list, count, label, tag, and group queries. Use Prisma `select` objects for list/detail instead of spreading full rows. Include contact fields with:

```ts
contactFields: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] }
```

Normalize provided fields by trimming `type`, `value`, and optional `label`; throw `BadRequestException` for blank values or more than one primary per type. For update, destructure `contactFields` before building scalar data and use:

```ts
contactFields: contactFields === undefined
  ? undefined
  : { deleteMany: {}, create: normalizeContactFields(contactFields) }
```

Convert `birthday`, `anniversary`, and `firstMetDate` only when present; preserve `undefined` and map explicit `null` to database `null`.

Run the ownership check and update in a serializable Prisma transaction so concurrent complete-replacement writes cannot interleave. Add `isDemo:false` to personal detail/update queries. Add `GET /contacts/groups` before `GET /contacts/:id` in controller route order.

Store `socialLinks` as an object. Add a compatibility parser for legacy JSON strings, allowlist `linkedin`, `twitter`, `instagram`, `facebook`, `github`, and `website`, and accept only `http:` or `https:` URLs.

- [ ] **Step 7: Verify Task 1 green**

Run:

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/contacts
pnpm --filter @socos/api type:check
```

Expected: all Contacts tests pass and typecheck exits `0`.

- [ ] **Step 8: Commit**

```bash
git add services/api/src/modules/contacts
git commit -m "feat(api): expose personal contact profiles"
```

### Task 2: Converge Interaction And Reminder Action Integrity

**Files:**
- Modify: `services/api/src/modules/interactions/interactions.dto.ts`
- Modify: `services/api/src/modules/interactions/interactions.service.ts`
- Modify: `services/api/src/modules/interactions/interactions.service.spec.ts`
- Modify: `services/api/src/modules/contacts/contacts.controller.ts`
- Modify: `services/api/src/modules/contacts/contacts.controller.spec.ts`
- Modify: `services/api/src/modules/contacts/contacts.service.ts`
- Modify: `services/api/src/modules/reminders/reminders.service.ts`
- Modify: `services/api/src/modules/reminders/reminders.service.spec.ts`

**Interfaces:**
- Consumes: existing `InteractionsService.createForAgent()` serializable transaction and existing reminder routes.
- Produces: one typed human interaction implementation used by both REST routes; atomic/idempotent pending-reminder completion.

- [ ] **Step 1: Write failing interaction convergence tests**

Prove that human `InteractionsService.create()` opens a serializable transaction, rejects demo/cross-owner contacts, persists interaction/XP/contact chronology atomically, and sets `lastContactedAt` to the maximum actual `occurredAt` rather than wall-clock time. Add a controller test proving `POST /contacts/:id/interactions` validates the body and delegates to `InteractionsService` with the route `contactId`; the Contacts service no longer owns duplicate interaction logic.

- [ ] **Step 2: Run interaction tests and record the expected RED result**

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/interactions src/modules/contacts/contacts.controller.spec.ts
```

Expected: FAIL because the human and compatibility routes still use divergent non-transactional implementations.

- [ ] **Step 3: Implement the single validated interaction path**

Add a typed contact-route DTO that omits caller `contactId`. Make `InteractionsService.create()` call the same transaction implementation as agent writes and map its result to the existing human response contract. Inject `InteractionsService` into `ContactsController` for the compatibility routes and remove `ContactsService.createInteraction/getInteractions`. Preserve the global `/api/interactions` route.

- [ ] **Step 4: Write failing recurring-reminder completion tests**

Cover two completions of the same recurring reminder, concurrent claim count `0`, transaction rollback if successor creation fails, owner/contact parity, non-recurring completion, and notification only after a successful commit. The second completion must not create another successor.

- [ ] **Step 5: Run reminder tests and record the expected RED result**

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/reminders/reminders.service.spec.ts
```

Expected: FAIL because successor creation and completion are separate writes without a pending-row claim.

- [ ] **Step 6: Implement atomic reminder completion**

Open one transaction, find the owner/contact-matched pending reminder, claim it with `updateMany({ where: { id, ownerId, status: 'pending' }, data: ... })`, require `count===1`, create a recurring successor only after the claim, and load the completed row for the response. Send any notification after the transaction commits.

- [ ] **Step 7: Verify Task 2 green and commit**

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/interactions src/modules/contacts src/modules/reminders
pnpm --filter @socos/api type:check
git add services/api/src/modules/interactions services/api/src/modules/contacts services/api/src/modules/reminders
git commit -m "fix(api): make contact actions atomic"
```

### Task 3: Build The Route-Backed Contacts Workspace

**Files:**
- Create: `apps/web/src/app/dashboard/layout.tsx`
- Create: `apps/web/src/app/dashboard/_components/dashboard-shell.tsx`
- Create: `apps/web/src/app/dashboard/contacts/page.tsx`
- Create: `apps/web/src/app/dashboard/contacts/contact-query.ts`
- Create: `apps/web/src/app/dashboard/contacts/contact-query.test.ts`
- Create: `apps/web/src/app/dashboard/contacts/contacts-workspace.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/contact-list.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/contact-profile.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/contact-editor.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/interaction-form.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/reminder-form.tsx`
- Create: `apps/web/src/app/dashboard/contacts/_components/contact-create-dialog.tsx`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/contact-contracts.ts`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Delete: `apps/web/src/app/dashboard/dashboard-client.tsx`

**Interfaces:**
- Consumes: Task 1 list/detail/create/update contracts and Task 2 action integrity through `/api/interactions`, `/api/reminders`, and `/api/reminders/:id/complete`.
- Produces: route-backed `/dashboard/contacts`, selected contact query state, focused workspace/profile/form components, shared contact contracts, and pure `buildContactQuery()`/`getPageWindow()` helpers.

- [ ] **Step 1: Write failing query/pagination tests**

Define the intended pure API:

```ts
expect(buildContactQuery({
  search: ' mentor ', label: 'AI Founders', group: 'Mentors', offset: 25, limit: 25,
  sortBy: 'lastContactedAt', sortOrder: 'desc',
})).toBe('limit=25&offset=25&search=mentor&label=AI+Founders&group=Mentors&sortBy=lastContactedAt&sortOrder=desc');

expect(getPageWindow({ total: 106, offset: 25, limit: 25 }))
  .toEqual({ start: 26, end: 50, page: 2, pageCount: 5, hasPrevious: true, hasNext: true });
```

Cover empty results, final partial page, stale offset clamping, and omitted empty filters.

- [ ] **Step 2: Run query tests and record the expected RED result**

Run:

```bash
pnpm --filter @socos/web exec vitest run src/app/dashboard/contacts/contact-query.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure query helpers and shared contact contracts**

Wrap same-origin `authFetch` in a small `apiJson<T>()` helper that parses success/error bodies without logging headers or personal values; do not create another token store. Define exact list/detail/form types in `contact-contracts.ts`; do not invent top-level `email` or `phone` on `Contact`. Implement `buildContactQuery` with `URLSearchParams` and `getPageWindow` with bounded integer arithmetic.

- [ ] **Step 4: Extract the dashboard shell and route**

Move authentication/navigation/user stats into `dashboard/layout.tsx` and `_components/dashboard-shell.tsx`. Make `/dashboard` redirect to `/dashboard/contacts`. The Contacts nav is active at the new route. Hide the desktop sidebar below `lg`, provide a compact mobile header, use `min-h-[100dvh]`, and never depend on the removed right rail for contact totals.

- [ ] **Step 5: Build `ContactsWorkspace` and contact list**

Implement independent list state with `limit=25`, 250 ms debounced search, label/tag/group facets from owner-scoped endpoints, abortable list requests, error/empty/loading states, stable previous/next controls, `Showing A-B of N`, and list refresh after mutations. Reset `offset=0` on search or facet change. Fetch only contacts when query state changes.

Every row is a keyboard-focusable button-like control with an accessible name and `onClick` opening the profile. Keep call/message/reminder shortcuts visible on touch-sized screens or move them into an explicit actions menu; do not rely on hover for essential behavior.

- [ ] **Step 6: Build the route-backed contact profile**

Use `?contact=<id>` with `useSearchParams` and router history. Implement a desktop side sheet and `412x915` full-screen mobile sheet with read/edit modes. Render and edit the fields specified in the design. Use full replacement for `contactFields`; preserve unsupported existing values by mapping them to `other` only when the user explicitly edits them. Do not silently discard a stored field.

Provide validated forms for:

```ts
POST /api/interactions
{ contactId, type, title, content, occurredAt }

POST /api/reminders
{ contactId, type, title, description, scheduledAt }

PUT /api/reminders/:id/complete
```

On success, refetch the detail and current page. Preserve entered values on failure and show inline errors.

- [ ] **Step 7: Fix Add Contact through `ContactCreateDialog`**

Send contact methods as:

```ts
contactFields: [
  ...(email ? [{ type: 'email', value: email, label: 'personal', isPrimary: true }] : []),
  ...(phone ? [{ type: 'phone', value: phone, label: 'mobile', isPrimary: true }] : []),
]
```

Remove all console logging of contact names/IDs. Refresh the first list page after create rather than injecting an incomplete local shape.

- [ ] **Step 8: Verify Task 3 green**

Run:

```bash
pnpm --filter @socos/web exec vitest run src/app/dashboard/contacts/contact-query.test.ts
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
```

Expected: query tests pass; typecheck/build exit `0`; lint has no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/dashboard apps/web/src/lib/api-client.ts apps/web/src/lib/contact-contracts.ts
git commit -m "feat(web): add personal contacts workspace"
```

### Task 4: Prove The Workspace In A Real Browser

**Files:**
- Create: `apps/web/e2e/contacts-workspace.spec.ts`
- Modify if required by an observed defect: `apps/web/src/app/dashboard/contacts/**/*.tsx`
- Modify if required by an observed defect: `apps/web/src/app/dashboard/_components/dashboard-shell.tsx`

**Interfaces:**
- Consumes: Task 3 UI and the existing staging-only Playwright host policy.
- Produces: synthetic browser evidence for pagination, search/filter, profile/edit, interaction/reminder actions, keyboard access, and mobile layout.

- [ ] **Step 1: Write the failing intercepted Playwright test**

Use `page.addInitScript(() => localStorage.setItem('socos_token', 'synthetic-token'))` and intercept only synthetic responses. Assert:

- `/dashboard` redirects to `/dashboard/contacts`;
- first contacts request uses `limit=25&offset=0` and renders `Showing 1-25 of 106`;
- Next requests `offset=25` and exposes a synthetic page-two contact;
- search `mentor` resets offset and reaches the server query;
- selecting a label reaches the server query;
- Enter on a contact updates `?contact=<id>` and opens a detail panel containing synthetic bio, contact method, important date, interaction, and reminder;
- save sends the expected `PUT /api/contacts/:id` payload including `contactFields`;
- interaction and reminder forms send validated payloads and reminder completion calls the correct endpoint.

- [ ] **Step 2: Run the browser test and record the expected RED result**

Start a local production web server on an unused port after building, then run:

```bash
E2E_BASE_URL=http://127.0.0.1:3010 \
E2E_ALLOWED_HOSTS=127.0.0.1 \
pnpm --filter @socos/web exec playwright test e2e/contacts-workspace.spec.ts --project=chromium --workers=1
```

Expected: FAIL on the first missing/incorrect workspace behavior.

- [ ] **Step 3: Fix only defects demonstrated by the browser test**

Keep API responses synthetic. Add accessible dialog labels/focus behavior, stable control sizes, and mutation refreshes needed to satisfy the test. Do not weaken assertions to match defective behavior.

- [ ] **Step 4: Add and run the mobile layout case**

Set viewport to `{ width: 412, height: 915 }`, open a profile, and assert:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
await expect(page.getByRole('dialog', { name: /contact profile/i })).toBeVisible();
await expect(page.getByRole('button', { name: /close profile/i })).toBeVisible();
```

Capture local synthetic screenshots for inspection but do not commit Playwright output.

- [ ] **Step 5: Run broad verification**

```bash
pnpm --filter @socos/api exec jest --runInBand src/modules/contacts src/modules/interactions src/modules/reminders
pnpm --filter @socos/api type:check
pnpm --filter @socos/web test
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
node --test scripts/security-regression.test.mjs scripts/docker-packaging.test.mjs
git diff --check
```

Expected: every command exits `0`; lint may report existing warnings but no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/contacts-workspace.spec.ts apps/web/src/app/dashboard
git commit -m "test(web): verify contacts workspace journeys"
```

### Task 5: Deploy And Record Production Evidence

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/ai-handoff-2026-07-16.md`

**Interfaces:**
- Consumes: reviewed Task 1-4 commits and existing Coolify scripts/runbooks.
- Produces: exact-SHA deployment, aggregate-only smoke evidence, and an updated recovery handoff.

- [ ] **Step 1: Run final whole-slice review and fix Critical/Important findings**

Generate a review package from the pre-slice base SHA through `HEAD`. Have a fresh reviewer check the design, all task reports, the full diff, owner isolation, destructive replacement semantics, accessibility, and test coverage. Re-run focused tests for every fix.

- [ ] **Step 2: Push and deploy the exact reviewed SHA**

Confirm `git status` is clean, push `main`, verify the remote SHA, and deploy using `scripts/coolify.sh` with `COOLIFY_EXPECTED_COMMIT_SHA` set to the full reviewed SHA. Do not echo the token.

- [ ] **Step 3: Smoke production without exposing rows**

Verify public/protected status codes, application health, exact image SHA, migration count unchanged, and aggregate non-demo contact count remains `106`. Use an authenticated controlled synthetic account for UI mutation smoke if one is already provisioned; otherwise do not mutate Yev's rows.

- [ ] **Step 4: Update durable records and commit**

Append task commit/review results to `.superpowers/sdd/progress.md`. Update the handoff with deployed SHA, Coolify deployment UUID, verification commands, aggregate evidence, remaining Daily Brief/integration/invite/Betabots work, and any unresolved Minor findings.
