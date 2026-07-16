# Personal Contacts Workspace Design

**Date:** 2026-07-16  
**Status:** Approved from the existing personal-first brief and user authorization  
**Primary user:** Yev  
**Deployment:** Existing Socos web/API on Coolify; PostgreSQL remains the sole source of truth

## Goal

Make the 106 imported Monica contacts directly usable in Socos without waiting for Calendar or Pixel activation. Yev must be able to find every non-demo contact, inspect remembered context and contact methods, edit relationship details, log an interaction, and schedule or complete a reminder from a desktop or Pixel-sized viewport.

## Considered Approaches

### 1. Route-backed dashboard workspace (selected)

Extract the authenticated dashboard shell, route `/dashboard` to `/dashboard/contacts`, and build a focused master-detail Contacts workspace. The selected contact is reflected as `?contact=<id>` so browser history and reload preserve context. Split the 865-line client into shell, API/types/query, list, profile, editor, interaction, reminder, and create modules while preserving the current visual language.

This is a modestly larger change than a local drawer, but it produces a stable navigation boundary, usable mobile behavior, and focused tests without introducing a new application or dependency. The extracted shell also gives the later Daily Brief and Approvals work a real place to live.

### 2. Drawer inside the current dashboard monolith

Keep all behavior inside `dashboard-client.tsx` and add a local drawer. This is the smallest diff, but it worsens the current monolith, has no URL/history semantics, and leaves the fixed desktop layout fragile on Pixel-width screens.

### 3. Full dashboard rewrite

Replace the dashboard with a new Today/Contacts/Approvals information architecture. This is the likely long-term direction, but it mixes the Contacts requirement with the still-unimplemented Daily Brief and approval inbox. The blast radius is too large for the next production slice.

## API Contract

`GET /api/contacts` remains offset-paginated and becomes bounded and deterministic:

- Default `limit=25`; valid range `1..100`.
- Default `offset=0`; minimum `0`.
- `search`, `label`, and `tag` are server-side filters.
- `group` is a server-side filter; label, tag, and group facets are owner-scoped and non-demo.
- `sortBy` is restricted to `createdAt`, `firstName`, `lastContactedAt`, `relationshipScore`, or `nextReminderAt`.
- `sortOrder` is restricted to `asc` or `desc`.
- The personal list and label/tag facets exclude `isDemo=true` rows.
- Response remains `{ contacts, total, offset, limit }`; the client derives page count and disables invalid navigation. List rows use an explicit projection and do not overfetch bio, contact methods, provenance IDs, or interaction content.

`GET /api/contacts/:id` adds ordered `contactFields` to an explicit owner-scoped detail projection containing recent interactions, pending reminders, and counts. It returns safe display provenance (`sourceSystem`, `importedAt`) but not the provider `sourceId`; no personal data is copied into another store.

Create and update accept an optional `contactFields` array. When present on update it is the complete replacement set, applied inside a serializable transaction through a nested Prisma relation update. Supported write types are `email`, `phone`, `address`, `website`, and `other`; values are trimmed, bounded, and may contain at most one primary field per type. Omitting `contactFields` preserves existing rows. An empty array clears them. The update contract also exposes `groups`, `firstMetDate`, and `firstMetContext`. Nullable dates can be cleared.

`relationshipScore` is read-only because it is system-calculated. Social links are stored as Prisma JSON objects, not JSON strings; the reader accepts the legacy string representation during transition. Write keys are allowlisted and values must be HTTP(S) URLs before the UI renders them as links.

No database migration is needed because `ContactField` and all profile columns already exist.

## Web Experience

The route-backed dashboard remains a quiet, dense personal work surface rather than a marketing screen.

- Search is debounced and resets pagination to the first page.
- Labels come from `/api/contacts/labels`, not only the loaded page.
- The header reports `Showing A-B of N` and exposes previous/next controls with stable dimensions.
- Clicking a row or pressing Enter opens the contact profile; quick actions remain separate controls.
- Opening and closing a profile updates `?contact=<id>` and browser history without losing the list query.
- The profile is a right-side panel on desktop and a full-screen sheet on mobile. It traps the visual workflow without nesting cards inside cards.
- Read mode shows identity, work, relationship score, importance/cadence, bio, labels/tags/groups, contact methods, important dates, first-met context, source system/import date, interaction timeline, and pending reminders.
- Edit mode updates profile fields and the complete contact-method set.
- Interaction logging uses the validated global `/api/interactions` endpoint.
- Reminder creation uses `/api/reminders`; completion uses `/api/reminders/:id/complete`.
- All mutations refresh the selected profile and current list page rather than assuming a local optimistic shape.
- Add Contact sends contact methods through `contactFields`, fixing the current email/phone `400` failure.

The existing desktop sidebar is hidden below the large breakpoint and replaced by a compact mobile header. The workspace and profile use restrained primary, green, and amber accents so the existing dark palette does not collapse into one hue. Controls use the existing icon system, accessible names, visible focus states, and no hover-only access to essential actions.

## State And Error Handling

List state is `{ search, label, offset, limit, sortBy, sortOrder }`. Only the contacts request is refetched when that state changes; user stats, labels, and global reminders load independently. Stale list responses are ignored with `AbortController` so fast search input cannot overwrite newer results.

The profile has independent loading, saving, interaction, and reminder states. Failed mutations preserve the user's input and show an inline error plus the existing toast. A missing/deleted contact closes the panel after reporting the failure. Authentication failures continue through the shared `apiFetch` token behavior.

Real contact values must never be logged. Remove the current console messages that include contact names/IDs. Synthetic values only are permitted in tests and screenshots.

## Action Integrity

The profile uses one validated interaction implementation. Both `/api/interactions` and the compatibility `/api/contacts/:id/interactions` route delegate to `InteractionsService`; the compatibility route accepts a typed body without caller ownership. Human writes use the existing serializable transaction path, keep `lastContactedAt` at the latest actual `occurredAt`, and award XP/audit records atomically. Demo contacts remain excluded from the personal action path.

Recurring reminder completion becomes an atomic claim. Inside one transaction, Socos verifies owner/contact parity and `status='pending'`, changes the reminder to completed exactly once, and creates at most one successor. A repeated or concurrent completion cannot create duplicate reminders. Notifications happen only after commit.

## Verification

- Jest service/DTO/controller tests prove bounded queries, sort allowlists, non-demo list isolation, explicit projections, owner-scoped detail, contact-field inclusion/replacement, primary-field validation, date clearing, social-link compatibility, and unchanged fields when omitted.
- Jest interaction/reminder tests prove a single validated transactional interaction path, historical chronology, rollback, owner/contact parity, and idempotent recurring completion.
- Vitest pure tests prove query encoding, pagination bounds, and display-window calculations.
- Playwright with intercepted synthetic API data proves page 1/page 2 reachability, server search/filter reset, profile rendering, edit payloads, interaction logging, reminder scheduling/completion, keyboard opening, and mobile no-overflow behavior.
- Build, typecheck, lint, focused tests, broad relevant tests, and `git diff --check` run before deployment.
- Deployment uses an exact pushed SHA. Production smoke checks public/protected status codes and an authenticated synthetic or aggregate-only path; it never prints contact rows.

## Deferred From This Slice

- Path-style `/dashboard/contacts/:id` URLs; this release uses `?contact=<id>` inside the route-backed workspace.
- Daily Brief, approval inbox, Calendar/Pixel setup UI, and proactive introduction UI.
- Contact deletion UI; deletion remains a risky action and should join the later approval flow.
- New memory extraction or LLM behavior. This slice exposes the existing stored bio/context safely.
- Moving browser authentication from localStorage bearer tokens to an httpOnly-cookie/BFF boundary. This remains a separate security slice because production Traefik routing and all auth clients must change together; no new contact code may expand token exposure.
