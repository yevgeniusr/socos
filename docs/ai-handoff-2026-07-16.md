# Socos Current-State Handoff - 2026-07-16

This document is the source of truth for handing Socos to another AI. It records what is deployed, what exists only in the local checkout, what is actively being verified, and the order in which remaining work should be completed.

## Executive Summary

Socos is a personal-first, agent-driven CRM for maintaining relationships, remembering personal context, finding relevant events, coordinating celebrations and social adventures, and making social activity easier through useful gamification. The intended autonomy boundary is risk-based: Socos may read, summarize, log, update activity, and create suggestions automatically; outbound messages, introductions, invitations, merges, and deletions require explicit approval.

The backend and operating foundation are substantially built. Production contains all 106 requested Monica contacts in Coolify PostgreSQL, has durable briefs and gamification, exposes an authenticated 11-tool MCP interface, and delivers a daily brief through Hermes to Discord. Calendar, Pixel location, and public-event modules exist but remain deliberately disabled until account/device setup is completed.

The authenticated Contacts workspace is now implemented, independently reviewed, browser-proven at desktop and Pixel dimensions, pushed, and deployed. Production was verified at the exact reviewed code SHA with aggregate-only database evidence: 106 non-demo contacts and 7 isolated demos. The next highest-value product gap is the authenticated Daily Cockpit, followed by the invite flow, a real-backend Betabots gate, and staged Calendar/Pixel/event activation.

## Status At A Glance

| Area | State | Evidence / next boundary |
| --- | --- | --- |
| Security, CI, migrations, backups, Coolify | Done and deployed | Production is healthy on deployed code SHA `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`. |
| Monica import | Done and production-verified | 106 non-demo contacts; 7 demo contacts isolated. Real rows remain cloud-only. |
| Daily brief, relationship health, dates, reminders, quests, XP | Backend done; authenticated UI incomplete | Durable services and APIs exist. Build the Daily Cockpit next. |
| MCP/API agent interface | Core done and deployed | 11 authenticated tools; Hermes, Codex, and Claude clients validated. Outbound executors remain absent. |
| Hermes Discord | Brief delivery done | Daily job runs at 09:00 Asia/Dubai. Reply-to-action journeys still need full product verification. |
| Calendar, Pixel location, events | Code done; integrations disabled | Four feature flags are false. Google consent, Pixel enrollment, and an approved ICS source remain. |
| Public demo/sample workspace | Partially done and deployed | Useful product proof, but not proof of the authenticated personal workflow. |
| Contacts API | Done, reviewed, and deployed | Explicit owner-scoped projections, bounded pagination, safe profile mutations, and demo exclusion. |
| Interaction/reminder integrity | Done, reviewed, and deployed | Atomic writes and recurring-reminder completion; demo contacts cannot receive human reminders. |
| Contacts web workspace | Done, reviewed, browser-proven, and deployed | All 106 records are reachable; desktop and Pixel `412x915` journeys pass. |
| Invite request | Not implemented | Public CTA still reaches invite-code-only signup. |
| Betabots release gate | Partial and not passed | Directional cohort evidence exists; no real-backend-attested formal pass. |

## Repository And Production

- Repository: `https://github.com/yevgeniusr/socos`
- Checkout: `/Users/mac/Desktop/projects/personal/socos`
- Branch: `main`
- Reviewed and pushed Contacts code SHA: `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`
- Branch state before this document update: local `main` matched `origin/main`; working tree clean.
- Production: `https://socos.rachkovan.com`
- Coolify application UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Production deployed code SHA: `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`
- Coolify deployment UUID: `stat2ao60x8di527vtw5rhhk` (`finished`)
- Coolify application status after deployment: `running:healthy`

Contacts release commit chain:

```text
fd5f40b fix(contacts): close final review gaps
0f2e5d6 fix(web): stabilize contacts mobile proof
cc6613a test(web): verify contacts workspace journeys
635835f fix(web): contain add contact dialog focus
b9c223e docs: update Socos continuation handoff
2f27cce feat(web): add personal contacts workspace
8f8f841 fix(api): restore interaction reward notifications
02b95b7 fix(api): make contact actions atomic
ab2e5b8 fix(api): project contact mutation responses
ae0101e docs: refresh Socos AI continuation handoff
e077a2b feat(api): expose personal contact profiles
06ea29c docs: plan personal contacts workspace
```

## Product Direction From Mem0 And Second Brain

Mem0 was queried with `user_id="yev"` across all agent scopes. Relevant conclusions, without reproducing private notes, are:

- Build for Yev first and make the product useful within days before generalizing it.
- Minimize CRM administration and compensate for uneven social energy.
- Balance professional networking, friends, hobbies, learning, mentoring, and social adventures.
- Use Dubai as the current location fallback; ranking interests include AI, open source, education, founders, mentoring, events, travel, and digital-nomad context.
- Gamification should create meaningful accountability and tangible or partly random rewards. Cosmetic points alone are insufficient.
- Remember rich relationship context with provenance and correction controls.
- Preserve approval for outbound or destructive actions while allowing automatic reads, summaries, logging, activity updates, and suggestions.

Raw personal notes and contact contents must not be copied into this repository, test fixtures, logs, screenshots, or handoff documents.

## What Is Done

### Platform, Security, And Operations

- Restored reproducible pnpm monorepo builds, CI, Docker packaging, migrations, and health checks.
- Replaced bypassable authentication with signed JWT validation and guarded unsafe routes.
- Removed destructive runtime database administration paths and committed secrets; rotated affected credentials.
- Restricted the production database role, added security regression scans, and reconciled additive forward-only migrations.
- Configured Coolify backups and recorded restore/retention runbooks.
- Deployed the repaired platform and verified public, protected, MCP, and disabled-feature boundaries.

### Cloud Data And Monica Import

- Built a validated, idempotent Monica import path with provenance fields.
- Imported all 106 requested contacts into production Coolify PostgreSQL.
- Kept 7 demo contacts isolated from personal lists, briefs, scoring, and agent search where required.
- Validated production using aggregate counts only.

### Relationship Intelligence And Gamification Backend

- Implemented durable daily brief batches/items, relationship-health scoring, important dates, reminders, recommendations, feedback, and quests.
- Added evidence-based quest completion, XP, streaks, achievements, and notifications.
- Made generation idempotent and retained stable V1 behavior while event-aware V1.1 remains feature-gated.

### Agent Interface And Hermes

- Added agent clients with hashed credentials, granular scopes, mutation audits, idempotency, proposals, approvals, and exact approval validation.
- Exposed exactly 11 MCP tools for briefs, contacts, relationship health, dates, reminders, interactions, feedback, quests, proposals, and approved execution.
- Validated distinct production clients for Hermes, Codex, and Claude, including MCP initialization, tool listing, reads, and denial for insufficient scopes.
- Configured Hermes daily Discord delivery at 09:00 Asia/Dubai and manually validated a successful production run.
- Important limitation: approved outbound actions currently return `ACTION_EXECUTION_UNAVAILABLE` because provider-specific executors are not registered.

### Calendar, Pixel Location, And Events Foundation

- Added AES-256-GCM envelopes and HMAC indexes for sensitive context.
- Built read-only Google Calendar OAuth, sync, watch renewal, reconciliation, reconnect, and disconnect flows with minimal scopes.
- Built OwnTracks-compatible Pixel enrollment, authenticated ingest, encrypted coordinates, deduplication, visit derivation, retention, rotation, and revocation.
- Built allowlisted DNS-pinned HTTPS ICS discovery, normalized events, preferences, ranking, Calendar conflict handling, feedback, and brief suggestions.
- Added personal-context deletion, aggregate-only audit, resumable rekeying, packaging checks, synthetic PostgreSQL integration tests, and runbooks.
- Deployed all modules disabled-first. Current production flags remain:

```text
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

Google Maps Timeline/Location Sharing is not the implemented location ingress. The selected history path is OwnTracks-compatible reporting from the Pixel.

### Public Product Proof

- Fixed the public demo navigation and added a product-proof section.
- Added `/sample-workspace` with synthetic interaction capture, memory extraction, ranked suggestions, and approval-before-outbound behavior.
- Added launch/access and data-control explanations.
- Production-smoked the public routes. These pages remain demonstration surfaces, not authenticated workflow evidence.

### Personal Contacts Slice: Tasks 1 And 2

The design and execution plan are in:

- `docs/plans/2026-07-16-personal-contacts-workspace-design.md`
- `docs/superpowers/plans/2026-07-16-personal-contacts-workspace.md`

Task 1, contact profiles API, is done and independently approved:

- Bounded deterministic pagination, allowlisted sorting, server search, and owner-scoped label/tag/group facets.
- All personal reads exclude demo contacts and use explicit safe projections.
- Detail includes ordered contact methods, recent interactions, pending reminders, and counts.
- Create/update support nested contact methods, social links, groups, dates, and first-met context.
- Updates are serializable; complete contact-method replacement is atomic.
- Mutation responses no longer expose full Prisma rows or provider source IDs.
- Verification: 4 suites, 65 tests; API typecheck and diff check passed.

Task 2, contact action integrity, is done and independently approved:

- Human and agent interaction writes converge on one validated serializable service.
- Compatibility routes use typed inputs and route-owned contact IDs.
- Recurring reminder completion atomically claims a pending reminder and creates at most one successor.
- Reward notifications occur only after commit while preserving human and agent response contracts.
- Verification: 6 suites, 103 broad contact-action tests; focused interaction/gamification 27/27; API typecheck and diff check passed.

### Personal Contacts Workspace: Shipped

Commits `2f27cce` through `fd5f40b` implement and harden:

- Route-backed `/dashboard/contacts`; `/dashboard` redirects there.
- An authenticated dashboard shell that preserves logout, navigation, stats, XP, reminders, and toasts.
- Debounced server search, independent facets, abortable requests, stable pagination, and `Showing A-B of N`.
- URL-backed selection using `?contact=<id>` so all 106 contacts are reachable beyond the first page.
- Accessible desktop side-sheet and full-screen mobile contact profile.
- Profile viewing/editing for identity, memory, work, cadence, dates, first-met context, labels/tags/groups, social links, and contact methods.
- Interaction logging, reminder creation/completion, and Add Contact with the correct nested `contactFields` contract.
- Draft-preserving mutation errors and refresh-after-mutation behavior.
- Live Tab/Shift+Tab focus containment in the Add Contact dialog with trigger restoration.
- Explicit minimal nested contact projections with owner filters and pending-reminder filters.
- Human reminder creation rejects demo contacts before persistence or notification.
- No new dependency, database migration, second token store, personal fixtures, or personal-value logging.

Independent review found no remaining Critical, Important, or Minor issues after fixes. Final verification passed:

```text
API contact slice: 6 suites, 104/104
API typecheck and production build: pass
Web Vitest: 4 files, 14/14
Web typecheck and production build: pass
Web lint: pass, 0 errors; 38 pre-existing warnings
Contacts Playwright: 2/2 on desktop and Pixel 412x915
Task 4 Pixel stability repeat: 5/5; final-SHA Pixel case: 1/1
Node security/package tests: 58/58; Coolify operations tests: 6/6
E2E host policy: 5/5
Security scanner: pass across 501 tracked files
git diff --check: pass
```

Production smoke after deployment:

```text
/=200 /sample-workspace=200 /auth/signup=200
/dashboard/contacts=200 /api/health-check=200
/api/mcp=401
POST /api/location/owntracks with empty body=503 (feature disabled)
contacts_non_demo=106 contacts_demo=7 contacts_total=113
```

The database query ran inside the Coolify host and emitted aggregate counts only. No production row or credential was copied into the workspace.

## In Progress

No implementation slice is partially edited at this handoff. The next slice to start is the authenticated Daily Cockpit. The research-weighted eight-persona Betabots wave remains incomplete: bots 001-005 completed, 006-007 were interrupted, and 008 did not start. It lacked real-backend attestation, so its findings are qualitative and cannot satisfy the release gate.

## What Is Left

### P1: Build The Authenticated Daily Cockpit

- Surface today's durable brief, relationship reasoning, important dates, event suggestions, reminders, and quests.
- Give every item small executable actions: done, snooze, dismiss, create reminder, open contact, or propose outbound action.
- Add an approval inbox/history showing previews, approvals, execution status, and audit evidence.
- Make XP, streaks, achievements, accountability, and reward feedback useful rather than decorative.
- Add weekly reflection/campaign loops, celebrations, and social-adventure planning.

### P1: Complete Personal Integrations

These need explicit user/device actions only at the final setup boundary:

1. Configure production Google OAuth, ask Yev to approve the two read-only Calendar scopes, verify aggregate sync/watch state, then enable Calendar sync.
2. Enroll the Pixel in OwnTracks over HTTPS with precise background location, verify aggregate device/sample timestamps, then enable location ingest.
3. Add at least one operator-certified public ICS source and preferences, verify sanitized discovery/ranking, then enable event discovery.
4. Enable event brief items only after Calendar/location/events are verified; preserve existing V1 brief batches.
5. Back up before production schema/config changes and enable one flag at a time with rollback by flag disable/redeploy.

### P1: Close The Invite Dead End

- Add a durable invite-request record and public normalized-email endpoint.
- Return the same generic `202` for new, duplicate, honeypot, and notifier-failure cases.
- Add edge rate limiting/body limits, expiry/cleanup, and no-PII Discord/Hermes notification.
- Add fail-closed reviewer-only paginated APIs and a review UI.
- Keep registration invite-code-only.

### P1: Real-Backend Betabots Gate

- Add a safe integrity endpoint that actually checks PostgreSQL and returns a fixed attestation, or a sanitized `503` on failure.
- Run eight synthetic Yev-like personas with real-backend attestation and no access to personal contacts/location.
- Iterate on repeated or high-severity findings while preserving unhappy stories.
- Gate: happiness >=70, no critical defects, >=90% applicable core-journey completion, and no unresolved high-confidence trust/usability blocker.

### P2: Complete The Agentic Product

- Add proactive introduction ranking and approval-first introductions. Current warm-introduction suggestions may return `INSUFFICIENT_GRAPH_DATA`.
- Implement provider-specific approved executors for messages, introductions, invitations, merges, and deletions with exact preview binding, idempotency, audit, rollback behavior, and synthetic end-to-end tests.
- Add richer memory extraction/review with provenance, confidence, correction, export, and deletion controls.
- Add import-integrity UI covering counts, preserved labels/groups, and duplicate decisions.
- Add event providers only after the certified ICS path proves useful.
- Add product analytics for brief delivery, response rate, accepted actions, stale-contact reduction, false positives, and weekly retention.
- Decide public pricing/access only after the personal workflow is demonstrably useful.

### Deferred Security Hardening

- Move browser authentication from localStorage bearer tokens to an httpOnly-cookie/BFF boundary as a dedicated cross-client and routing slice.
- Add database constraints for `ContactField` ownership/uniqueness after a migration plan and backup.
- Keep risky deletion and merge UI inside the approval system rather than adding direct contact controls.

## Known Risks And Truth Boundaries

- Calendar, location, event discovery, and event briefs are disabled in production.
- Approved outbound actions have no real executors.
- The invite-request CTA remains a dead end for users without a code.
- Betabots have not passed a real-backend-attested release gate.
- Backend capability does not equal a complete product surface; briefs, approvals, integrations, and richer gamification remain underexposed in the authenticated web app.
- Browser authentication still relies partly on localStorage bearer tokens; the httpOnly-cookie/BFF hardening slice is deferred.
- Never expose production contact rows, interaction bodies, exact coordinates, OAuth data, tokens, database URLs, invite codes, private keys, or Coolify credentials.

## Operating Rules For The Next AI

- Work directly in `/Users/mac/Desktop/projects/personal/socos`; preserve unrelated changes and inspect `git status` before editing.
- Use Mem0 with `user_id="yev"` across all agent scopes. If no native tool exists, use the configured local bridge; never print credentials or raw personal memory dumps.
- Use test-driven, sub-agent implementer/reviewer cycles for substantial slices. Do not run overlapping implementation agents against the same files.
- Use synthetic fixtures and screenshots. Production checks are aggregate-only; Coolify PostgreSQL remains the sole source of truth for real personal data.
- Preserve server-side approval for outbound/destructive actions.
- Use additive forward-only migrations, verify a backup before schema changes, deploy an exact pushed SHA, and verify that exact SHA in production.
- Do not enable personal-integration flags before credentials, explicit consent/device setup, and staged verification.
- Keep `.betabots/` ignored and do not commit browser profiles or runtime evidence containing personal data.
- Update this document and `.superpowers/sdd/progress.md` after each reviewed/deployed slice.

## Authoritative Files

1. `docs/ai-handoff-2026-07-16.md`
2. `.superpowers/sdd/progress.md`
3. `docs/plans/2026-07-16-personal-contacts-workspace-design.md`
4. `docs/superpowers/plans/2026-07-16-personal-contacts-workspace.md`
5. `.superpowers/sdd/task-1-report.md`
6. `.superpowers/sdd/contacts-task-2-report.md`
7. `.superpowers/sdd/contacts-task-3-report.md`
8. `.superpowers/sdd/contacts-task-4-report.md`
9. `.superpowers/sdd/contacts-final-review-fix-report.md`
10. `docs/plans/2026-07-15-personal-first-socos-design.md`
11. `docs/runbooks/database-backup-restore.md`
12. `docs/runbooks/calendar-location-operations.md`
13. `docs/validation/agent-interface-v1.md` as historical evidence, not current release identity.

Older README/PRD/MVP/API documents and unchecked plan boxes contain stale claims. Prefer current code, the progress ledger, task reports, and this handoff.

## Continuation Prompt For Another AI

```text
You are taking over Socos, a personal-first agent-driven CRM. Work directly in `/Users/mac/Desktop/projects/personal/socos` on `main`. The user has authorized direct implementation, cloud deployment, and sub-agent-driven work, and does not want routine questions. Ask only when an external consent/device action is genuinely required.

First read:
1. `docs/ai-handoff-2026-07-16.md` (authoritative state and roadmap)
2. `.superpowers/sdd/progress.md`
3. `docs/plans/2026-07-16-personal-contacts-workspace-design.md`
4. `docs/superpowers/plans/2026-07-16-personal-contacts-workspace.md`
5. `.superpowers/sdd/task-1-report.md`
6. `.superpowers/sdd/contacts-task-2-report.md`
7. `.superpowers/sdd/contacts-task-3-report.md`
8. `.superpowers/sdd/contacts-task-4-report.md`
9. `.superpowers/sdd/contacts-final-review-fix-report.md`
10. `docs/plans/2026-07-15-personal-first-socos-design.md`
11. `docs/runbooks/database-backup-restore.md`
12. `docs/runbooks/calendar-location-operations.md`
13. `git status --short --branch` and `git log --oneline -12`

Recover product context from Mem0 when useful. Search `user_id="yev"` across all agent scopes, never Codex-only by default. If no native Mem0 tool is exposed, use the configured local MCP bridge/source at `/Users/mac/Desktop/projects/claw/second-brain/mem0_rest_mcp.py` or the available `second-brain/scripts/mem0_query.py profile --top-k 20`. Use conclusions for prioritization, but never put raw private notes, contact rows, interaction contents, exact locations, or credentials in code, logs, tests, screenshots, or documents.

Current state before the handoff-document commit:
- Production: `https://socos.rachkovan.com`
- Coolify app UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Reviewed/pushed/deployed Contacts code SHA: `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`
- Coolify deployment UUID: `stat2ao60x8di527vtw5rhhk`, status `finished`; application `running:healthy`.
- Production contains 106 non-demo Monica contacts plus 7 isolated demos.
- Hermes, Codex, and Claude MCP clients are validated; Hermes posts a daily Discord brief at 09:00 Asia/Dubai.
- Calendar, location, event discovery, and event brief flags are false.
- Contacts Task 1 is implemented/review-approved at `e077a2b` + `ab2e5b8`; Contacts tests 65/65 and API typecheck pass.
- Contact-action Task 2 is implemented/review-approved at `02b95b7` + `8f8f841`; broad tests 103/103 and API typecheck pass.
- Contacts Tasks 3/4 are implemented and review-approved through `fd5f40b`. Final gates: API 104/104, web Vitest 14/14, final-SHA Playwright 2/2 including Pixel 1/1, prior Pixel stability repeat 5/5, security/package 58/58, Coolify operations 6/6, host policy 5/5, typechecks/builds/scanner/diff pass.
- Production smoke: public and Contacts routes `200`, MCP unauthenticated `401`, disabled OwnTracks `503`, aggregate contacts `106/7/113`.

Immediate execution order:
1. Build the authenticated Daily Cockpit with today's durable brief, important dates, reminders, quests, ranked suggestions, executable item actions, approval inbox/history, and useful XP/streak/reward feedback.
2. Build the enumeration-resistant invite-request queue and reviewer UI while keeping registration invite-code-only.
3. Add a safe real-PostgreSQL integrity attestation and run eight synthetic Yev-like Betabots against the real backend. Iterate until happiness >=70, no critical defects, >=90% applicable core-journey completion, and no unresolved high-confidence blocker.
4. Prepare Google Calendar consent, Pixel OwnTracks enrollment, and one certified ICS source. Ask Yev only for the actual OAuth/device steps. Enable one feature flag at a time after backup and aggregate verification.
5. Add proactive introduction ranking and provider-specific approved outbound executors.
6. Add richer memory provenance/correction/export/deletion, weekly social campaigns, celebrations/adventures, import-integrity UI, and product analytics.

Non-negotiable constraints:
- Real personal data stays only in Coolify PostgreSQL. Use synthetic tests; production inspection is aggregate-only.
- Never expose tokens, database URLs, OAuth values, private keys, invite codes, Coolify credentials, contact contents, interaction contents, or precise locations.
- Preserve server-side approval for outbound messages, introductions, invitations, merges, and deletions.
- Use additive forward-only migrations and a verified backup before schema changes.
- Deploy only an exact pushed SHA and verify it after deployment.
- Do not enable Calendar/location/event flags without explicit consent/device setup and staged verification.
- Preserve unrelated user changes; never reset or rewrite them.
- Keep `.betabots/` ignored.

For substantial work, start with a written design/plan, use a fresh test-first implementer and a separate read-only reviewer, and run Betabots when the user-facing slice is usable. Fix all Critical/Important findings and record exact evidence in `.superpowers/sdd/progress.md`. Do not claim completion based on sample/marketing pages; prove the authenticated personal workflow.
```
