# Socos AI Continuation Handoff - 2026-07-17

This is the current source of truth for handing Socos to another AI. It supersedes `docs/ai-handoff-2026-07-16.md`, which remains useful as the exact record of the last deployed Contacts release.

## Executive Summary

Socos is a personal-first, agent-driven CRM intended to help Yev maintain relationships, remember rich personal context, track dates and reminders, discover relevant events from plans and location, coordinate celebrations and social adventures, and make social activity easier through meaningful gamification.

The production foundation is substantial: the secured application is deployed on Coolify, all 106 requested Monica contacts are in cloud PostgreSQL, the Contacts workspace is live, durable briefs and gamification exist, an authenticated 11-tool MCP surface is available to Hermes/Codex/Claude clients, and Hermes has delivered a Discord daily brief. Calendar, Pixel location, and event-discovery backends exist but remain disabled until consent/device/source setup.

The current local checkout is ahead of production. The authenticated Daily Cockpit, real-PostgreSQL Betabots integrity attestation, response-loss-safe human idempotency, and CI-isolated PostgreSQL concurrency proof are implemented and committed locally. Broad verification, real PostgreSQL migration/concurrency proof, desktop/Pixel browser proof, and independent review are clean. A valid five-person real-backend Betabots run completed, but the release gate failed on happiness and journey completion. The current release is therefore not deployed: the next AI must reduce the repeated action/context friction, rerun the affected journeys, then commit, push, deploy the exact reviewed SHA, and perform aggregate-only production smoke.

## Product And Autonomy Contract

Build for Yev first, make it useful in days, and generalize only after the personal workflow works. The desired social mix is professional networking, friends, hobbies, learning, mentoring, and social adventures.

Risk-based autonomy is non-negotiable:

- Socos may automatically read, summarize, log interactions, update activity, and create suggestions.
- Socos must require approval for outbound messages, introductions, invitations, merges, and deletions.
- Approval is not execution. The product must never say an action was sent or performed merely because an approval grant exists.

Mem0 was checked with `user_id="yev"` across all agent scopes. Relevant durable direction, without copying private notes, is:

- Minimize CRM administration and compensate for uneven social energy.
- Prefer useful accountability, progression, and partly unpredictable rewards over cosmetic points.
- Preserve rich relationship context with provenance and correction controls.
- Dubai is the current fallback location; relevant themes include AI, open source, education, founders, mentoring, events, travel, and digital-nomad context.
- A second-brain Socos note also proposes favorite things in custom categories with purpose-built widgets, such as bookshelf-style public profile widgets. This is future backlog, not implemented.

Never copy raw personal notes, contact rows, interaction contents, exact locations, credentials, or private calendar data into the repository, tests, logs, screenshots, prompts, or handoff documents.

## Current Repository Truth

Recorded on 2026-07-17 in `/Users/mac/Desktop/projects/personal/socos`:

```text
branch: main
reviewed product HEAD before this handoff commit: 87e8c8bed9edff83da181d7b249c6341ee706cf9
origin/main: fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd
state before this handoff commit: local main is ahead by 15 commits
expected state after this handoff commit: local main is ahead by 16 commits with a clean tracked worktree
```

Do not reset, checkout, clean, stash, or rewrite the current work. Continue on the existing checkout and preserve every unrelated user change.

Local commits after the deployed Contacts release:

```text
e6bee88 docs: plan authenticated daily cockpit
cde4bbf feat(api): expose safe proposal history
5055782 feat(api): expose verified quest targets
24547ba feat(web): add daily cockpit workspaces
d0fa0e0 fix(api): fail closed on invalid proposal history
f8effc8 feat(web): make daily cockpit actionable
cf934d3 feat(api): add PostgreSQL integrity attestation
752646c fix(api): revalidate proposals before approval
a3a0ade fix(web): harden daily cockpit actions
8b40abe test(api): verify health attestation over HTTP
a904d90 fix(cockpit): harden approvals and retries
3744153 fix(api): retry concurrent idempotent mutations
c571016 fix(ci): isolate human idempotency integration
87e8c8b test(api): preserve in-tree integration discovery
```

The fifteenth ahead commit is the earlier handoff commit `c784098`. There are no uncommitted product-code changes. Preserve the documentation changes and do not reset, checkout, clean, stash, or rewrite the worktree.

## Production Truth

- URL: `https://socos.rachkovan.com`
- Coolify application UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Last reviewed, pushed, and deployed SHA: `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`
- Last deployment UUID: `stat2ao60x8di527vtw5rhhk`
- Live state re-queried while preparing this handoff: application `running:healthy`, branch `main`
- Last aggregate-only database proof: 106 non-demo contacts, 7 isolated demos, 113 total

The configured Coolify CLI context authenticated successfully against Coolify `4.0.0-beta.472`. The four integration flags were also re-queried through the API and remained exactly `false`; no sensitive environment values were emitted. Coolify still exposes no pinned application SHA, so the last deployment record remains the authoritative production commit evidence.

The Daily Cockpit and attestation/idempotency commits are not pushed or deployed. Production remains on the Contacts release until a new exact-SHA deployment is completed.

## Capability Matrix

| User need | Current state | Remaining boundary |
| --- | --- | --- |
| Keep in touch with existing connections | Contacts, interaction history, relationship health, reminders, daily brief, and recommendations exist; Contacts UI is deployed | Reduce Daily Cockpit action/context friction, pass the formal gate, deploy, then improve weekly planning and proactive cadence |
| Suggest events from location and plans | Calendar, Pixel history, ICS discovery, ranking, conflict checks, and V1.1 brief code exist | Complete Google consent, Pixel enrollment, certified ICS source, staged flag activation, and UI proof |
| Track important dates | Important-date backend and contact date editing are deployed; brief surfaces exist locally | Prefill date-aware reminders, pass the Daily Cockpit gate, and add richer celebration workflows |
| Proactively connect useful people | Relationship recommendations exist; approval system exists | Build graph-quality introduction ranking; current warm-intro strategy may return `INSUFFICIENT_GRAPH_DATA` |
| Celebrations, reminders, social adventures | Reminders, quests, celebration/domain models, and some services exist | Productize celebration campaigns, gifts, group plans, adventures, and weekly reflection |
| Remember everything about connections | 106 contacts imported with rich fields/provenance; interactions and contact details are supported | Add memory extraction/review, confidence, provenance UI, correction, export, deletion, and deduplication UX |
| Gamify being social | XP, levels, streaks, achievements, quests, evidence verification, and notifications exist | Add visible evidence/outcome receipts, then accountability, rewards, campaigns, and anti-pointless-grind tuning |
| Agent-friendly CRM | Authenticated REST/MCP, clients, scopes, idempotency, audits, proposals, approvals, and docs exist | Add provider executors and a packaged Codex/Claude plugin; prove Hermes reply-to-action journeys |

## Done And Deployed

### Platform, Security, And Operations

- Repaired pnpm monorepo builds, CI, Docker packaging, migrations, startup, and health checks.
- Replaced bypassable authentication with signed JWT validation and guarded unsafe routes.
- Removed destructive runtime database administration paths and committed secrets; rotated affected credentials.
- Restricted the production database role and added security, package, host-policy, migration, and Coolify regression tests.
- Reconciled additive forward-only migrations and configured Coolify backups with restore/retention runbooks.
- Deployed and verified public, protected, MCP, and disabled-feature boundaries.

### Monica Data And Contacts

- Built a validated, idempotent Monica import with provenance.
- Imported all 106 requested real contacts into Coolify PostgreSQL; real data was not saved locally.
- Isolated 7 demo contacts from personal lists, scoring, briefs, and agent search where required.
- Built owner-scoped, bounded Contacts APIs with explicit projections, search, facets, pagination, nested fields, dates, first-met context, interactions, and reminders.
- Made contact updates, interaction writes, and recurring reminder completion atomic.
- Built and deployed `/dashboard/contacts`, including all-record pagination, URL-backed contact selection, editing, interaction logging, reminders, Add Contact, desktop side sheet, Pixel full-screen profile, focus containment, and trigger restoration.
- Final deployed Contacts evidence: API 104/104, web 14/14, Playwright 2/2 including Pixel, prior Pixel stability 5/5, builds/typechecks/security checks passed, and independent review found no remaining findings.

### Daily Brief And Relationship Intelligence Backend

- Persisted durable daily brief batches/items, relationship-health scoring, important dates, reminders, recommendations, feedback, and quests.
- Added evidence-based quest completion, XP, streaks, achievements, and notifications.
- Kept generation idempotent and preserved stable DailyBrief V1 while event-aware V1.1 remains gated.
- Hermes can read the same durable brief contract through REST/MCP.

### MCP, Agent Security, And Hermes

- Added hashed agent credentials, granular scopes, mutation audits, stable idempotency, proposals, approval grants, and exact approval binding.
- Exposed exactly 11 authenticated MCP tools covering briefs, contacts, relationship health, dates, reminders, interactions, feedback, quests, proposals, and approved execution.
- Validated separate Hermes, Codex, and Claude production clients for MCP initialization, tool listing, allowed reads, and insufficient-scope denial.
- Configured Hermes daily Discord delivery at 09:00 Asia/Dubai and manually validated a successful run.
- Documented MCP setup in `docs/integrations/socos-mcp.md`, `hermes-mcp.md`, `codex-mcp.md`, and `claude-mcp.md`.

Limitations:

- Approved provider actions currently return `ACTION_EXECUTION_UNAVAILABLE`; no message/introduction/invitation/merge/delete executor is registered.
- There is no packaged Codex plugin manifest or Claude plugin bundle in this repository. The remote MCP client documentation exists, but the requested first-class plugin remains to be built.
- Hermes reply parsing/action round trips need a complete production product verification pass.

### Calendar, Pixel Location, And Event Foundation

- Built AES-256-GCM envelopes, HMAC indexes, resumable rekeying, deletion, aggregate audit, and safe configuration boundaries.
- Built read-only Google Calendar OAuth, sync, watch renewal, reconciliation, reconnect, and disconnect with minimal scopes.
- Built OwnTracks-compatible Pixel enrollment, authenticated ingest, encrypted coordinates, deduplication, visits, retention, credential rotation, and revocation.
- Built allowlisted DNS-pinned HTTPS ICS discovery, normalization, preferences, ranking, Calendar conflicts, feedback, and event-aware brief suggestions.
- Added synthetic PostgreSQL integration proof, packaging checks, and operations runbooks.
- Deployed everything disabled-first. Last verified production flags:

```text
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

Google Maps Timeline/Location Sharing is not the implemented live ingress. The selected precise-history path is OwnTracks-compatible reporting from the Pixel.

### Public Product Proof

- Fixed `Watch Demo` navigation and added concrete product proof.
- Added `/sample-workspace` showing a synthetic interaction-to-memory-to-suggestion-to-approval loop.
- Added launch/access and data-control explanations.
- Earlier Betabots confirmed the demo navigation fix, but still identified the invite-only dead end and lack of authenticated workflow proof.

## Done Locally But Not Deployed: Daily Cockpit And Betabots Attestation

Design and execution plan:

- `docs/plans/2026-07-17-daily-cockpit-design.md`
- `docs/superpowers/plans/2026-07-17-daily-cockpit.md`

Committed implementation:

- Safe, bounded `GET /api/agent-proposals/history` with owner scoping, strict previews, contact reference resolution, grant/outbox status, and defensive malformed-history presentation.
- Owner-scoped `GET /api/briefs/quests/:questId/action` for server-owned interaction/reminder evidence without changing DailyBrief V1/V1.1.
- `/dashboard/today` and `/dashboard/approvals`; `/dashboard` redirects to Today.
- Desktop and Pixel navigation for Today, Contacts, and Approvals.
- Independently loading brief, reminder, stats/streak, and approval panels with truthful error/empty states.
- Keep, snooze, dismiss, reminder creation/completion, verified interaction/reminder quest completion, proposal approval/rejection, and stable intent-key infrastructure.
- Synthetic Playwright coverage for desktop/Pixel navigation, generation fallback, V1/V1.1, actions, approvals, partial failures, and overflow.

Committed hardening:

- Backend approval revalidates the exact persisted proposal preview before creating a grant; malformed/unreviewable proposals fail closed.
- Approval buttons are hidden for unavailable action/preview envelopes.
- Snooze retains an absolute deadline across retry, preserving request body and idempotency key.
- Reminder creation/completion no longer reports a successful write as failed merely because the follow-up refresh failed.
- Reminder-backed quest retry re-reads the server-owned action target so an ambiguous committed completion can proceed to quest evidence submission.
- Focus containment, busy-state Escape/backdrop guards, and trigger restoration cover feedback, reminder, snooze/dismiss, and quest dialogs.
- Desktop and Pixel momentum states no longer fabricate levels, contacts, or XP while stats are loading or unavailable.
- E2E proves snooze retry uses the same body/key and reminder-backed quest recovery after a committed PUT response is lost.

Committed real-backend attestation:

- Public `GET /api/health-check/postgresql` executes one bounded Prisma `SELECT 1`.
- Success returns the exact Betabots `mode/auth/database/mocksDetected` contract with `Cache-Control: no-store`.
- Connection failure returns a sanitized `503` through the production exception filter without database details.
- A real Nest HTTP-pipeline test proves unauthenticated success, exact JSON, no-store on success/failure, sanitized wire failure, and the unchanged legacy health endpoint.

Committed trust and response-loss hardening:

- Approval canonicalizes and binds the human-reviewed preview, executable payload, and persisted payload hash before issuing a grant.
- Owner-scoped `HumanIdempotencyRecord` persistence commits reminder/interaction results in the same Serializable transaction as the domain write and XP award.
- Concurrent same-key requests retry with a fresh transaction after PostgreSQL serialization/unique conflicts, then replay the winner without duplicate writes or notifications.
- Keyed mutations perform bounded owner-scoped cleanup of expired idempotency rows.
- The forward-only migration, aggregate verifier, disposable migration harness, Docker packaging, dedicated CI runner, and default Jest discovery all cover the new table and concurrency path.
- The dedicated destructive integration runner accepts only explicitly named disposable PostgreSQL databases, strips unrelated secrets/env, resets migrations, and runs only the exact integration spec.

Fresh combined verification through local HEAD `87e8c8bed9edff83da181d7b249c6341ee706cf9`:

```text
API focused Jest: 13 suites, 162/162 passed
API default Jest: 94 suites, 1,036/1,036 passed; human integration excluded, Monica integration preserved
Agent core Vitest: 2 files, 25/25 passed
Web Vitest: 8 files, 29/29 passed
API, agent-core, and web typechecks: passed
API and web production builds: passed
Web lint: 0 errors, 38 pre-existing warnings
Infrastructure/security/package/host-policy tests: 72/72 passed
Database and Docker operations: 40/40 passed
Disposable PostgreSQL migration harness: 10/10 passed with all 11 migrations
Real PostgreSQL idempotency concurrency/cleanup: 2/2 passed
Dedicated runner/discovery/CI packaging: 4/4 passed
Security scanner: passed, 540 tracked files checked before handoff-doc commit
Daily Cockpit plus Contacts Playwright: 11/11 passed
Pixel proof: 412x915 included
git diff --check: passed
```

The PostgreSQL attestation and the complete Daily Cockpit hardening series received fresh independent read-only `APPROVE` verdicts with no Critical or Important findings. Review iterations caught and closed preview/payload/hash drift, lost-response duplication, quest focus loss, concurrent Serializable snapshot behavior, incomplete migration verification, integration-test CI discovery, and preservation of the Monica integration suite. The latest direct serial Jest runs exited cleanly; an earlier pnpm-wrapped focused run had emitted a worker force-exit warning after passing.

## In Progress And Release Boundary

There are no uncommitted product-code changes. The formal run at `.betabots/runs/20260717-020626-daily-cockpit-real-postgres` used five UI-created accounts, isolated persistent PostgreSQL, real Chrome sessions, GPT-5.5 minds, human pace, and synthetic CRM data. Its integrity evidence is valid and scoreable:

```text
environment: valid=true, verified=true, scoreCap=100
sessions: 5/5 complete; 34 screenshots; 17 UI actions
failures: 0 bot, 0 browser action, 0 product request
LLM: 22 calls, 0 failures, 0 fallbacks
scores: 43, 51, 39, 69, 100
mean/median: 60.4 / 51
happy >=70: 1/5
journeys achieved: 1/5
applicable signals observed: 11/23 (47.8%)
release gate: FAIL
```

The generic runner evidence check passed 5/5, but it required zero AI turns and zero completed activities; it is not a substitute for the product journey gate. There were no Critical defects. Approval safety was the clear success: the UI distinguished pending approval, active grant, and execution-not-performed truthfully.

Repeated product friction to fix next:

1. Enrich Today focus cards with role/company, last interaction, the strongest concrete reminder/date/cadence reason, and an explainable risk label. A naked `0/100` felt guilt-heavy and forced users to open the profile for basic context.
2. Rename the existing Contacts action from `Message` to `Log message`; it opens retrospective interaction logging, not an outbound composer. Add a separate approval-required `Draft message` path only if it includes the exact body before approval and never sends directly.
3. Carry structured important-date/reminder context into the reminder form: prefill type, title, date, and source from server-owned data. Do not infer type from free text; preserve stable idempotency for the final exact body.
4. Add compact outcome receipts. Rejection should visibly say nothing was sent and no XP/progress was awarded. Approved proposals need a durable execution state/report link. Verified quest completion should show evidence type/time and awarded XP.

The two-minute cohort also imposed only three to four actions per participant; some form journeys ended before submit without request failures. The rerun should use four to five minutes or a six-to-eight-action budget, require at least one completed activity, and include direct completion journeys. Do not misclassify the unsaved forms as backend failures.

Release boundary:

1. Implement the repeated friction fixes test-first without weakening approval, evidence, or idempotency contracts.
2. Obtain a fresh independent review and rerun affected real-backend journeys until happiness is at least 70, no Critical defects remain, at least 90% of applicable journeys complete, and there is no high-confidence trust blocker.
3. Commit the documentation and product changes, push `main`, and verify the exact origin SHA.
4. Take and verify a fresh Coolify backup, deploy that exact SHA, and run aggregate-only production smoke.
5. Update `.superpowers/sdd/progress.md` and this handoff with the final deployment UUID, exact deployed SHA, and smoke evidence.

One prior review claim was false and must not trigger a route rewrite: `POST /api/contacts/:id/interactions` does exist in `services/api/src/modules/contacts/contacts.controller.ts` and supplies the route-owned `contactId`. The synthetic Cockpit interaction-quest route is valid.

The invalid directional artifact remains at `.betabots/runs/20260717-012558-daily-cockpit-directional/`. A later one-bot runner smoke proved Chrome, Playwright resolution, and GPT-5.5 operation, but correctly remained invalid because it used synthetic authentication/mock responses. Only the formal `20260717-020626` run is valid product evidence. Keep all `.betabots/` artifacts ignored and never transfer scores from an invalid run.

## Remaining Roadmap

### P0: Improve, Revalidate, And Deploy Daily Cockpit

- Complete the five release-boundary items in the preceding section.
- Preserve stable DailyBrief contracts and server-side approval boundaries.
- Require desktop and Pixel `412x915` browser proof with no overflow.
- Do not enable Calendar/location/event flags as part of this deployment.

### P1: Activate Personal Integrations

Only the final account/device steps require Yev:

1. Configure production Google OAuth and ask Yev to consent to the two read-only Calendar scopes.
2. Verify aggregate Calendar sync/watch state, then enable `CALENDAR_SYNC_ENABLED`.
3. Enroll the Pixel in OwnTracks over HTTPS with precise background location.
4. Verify aggregate device/sample timestamps, then enable `LOCATION_INGEST_ENABLED`.
5. Add one operator-certified public ICS source plus preferences and verify sanitized discovery/ranking.
6. Enable `EVENT_DISCOVERY_ENABLED`, then `EVENT_BRIEF_ENABLED` last. Existing V1 batches must remain stable.
7. Back up before production schema/config changes and enable one flag at a time with rollback by flag disable/redeploy.

The integration modules currently expose operational APIs and runbooks, not an enabled authenticated Settings experience. Add a restrained setup/status surface after the staged backend activation path is proven; do not expose credentials, exact coordinates, or calendar contents in it.

### P1: Close The Invite Dead End

- Add a durable invite-request record and normalized-email public endpoint.
- Return the same generic `202` for new, duplicate, honeypot, and notifier-failure cases.
- Add edge rate/body limits, expiry/cleanup, and no-PII Hermes/Discord notification.
- Add fail-closed reviewer-only pagination and review UI.
- Keep registration invite-code-only.

### P1: Expand The Formal Real-Backend Betabots Gate

- The safe PostgreSQL integrity attestation is implemented locally at `/api/health-check/postgresql`, independently approved, and proved by the valid five-person run; it still awaits deployment with the Daily Cockpit release.
- Run at least eight Yev-like personas with real browsers, LLM minds, real staging/production-like backend, human pace, and synthetic contacts/calendars/locations only.
- Include low-energy, professional, close-friend, important-date, event, gamification, and approval-skeptical journeys.
- Iterate while preserving unhappy stories.
- Gate: happiness at least 70, no Critical defects, at least 90% applicable journey completion, and no unresolved high-confidence trust/usability blocker.

### P1: First-Class Agent Packaging

- Create a real Codex plugin with `.codex-plugin/plugin.json`, remote MCP configuration, minimal skills, setup/health guidance, and no embedded credentials.
- Provide equivalent Claude installation guidance or bundle format supported by the target environment.
- Add contract tests ensuring plugin examples match the 11-tool production MCP surface and current authentication headers.
- Verify Hermes reply parsing, action confirmation, stable idempotency, audit creation, and approval prompts end to end.

### P2: Complete Proactive Social Operations

- Build relationship-graph and warm-introduction ranking with approval-first introductions.
- Add provider-specific approved executors for messages, introductions, invitations, merges, and deletions with exact preview binding, idempotency, audit, rollback behavior, and synthetic end-to-end tests.
- Add weekly social planning/reflection, celebrations, gifts, group events, social adventures, and meaningful reward campaigns.
- Add proactive date preparation, such as gift/celebration planning before the date rather than a same-day reminder.

### P2: Complete Relationship Memory And Monica Parity

- Add memory extraction/review with provenance, confidence, correction, export, deletion, and conflict handling.
- Add import-integrity UI for counts, labels/groups, preserved fields, and duplicate decisions.
- Add deduplication/merge through the approval system, never direct destructive controls.
- Audit Monica parity systematically instead of relying on the stale README/PRD claims.
- Add favorite-things categories and purpose-built widgets only after the core personal loop is useful.

### P2: Analytics And Security Hardening

- Measure brief delivery, reply rate, accepted suggestions, completed actions, stale-contact reduction, false positives, approval latency, and weekly retention without logging personal content.
- Move browser auth from localStorage bearer tokens to an httpOnly-cookie/BFF boundary as a dedicated cross-client slice.
- Add planned `ContactField` ownership/uniqueness constraints after backup and forward-only migration design.
- Decide public pricing/access only after the personal workflow is demonstrably useful.

## Verification And Deployment Checklist

Run from `/Users/mac/Desktop/projects/personal/socos` after completing the open Daily Cockpit fixes:

```bash
pnpm --filter @socos/api test -- --runInBand \
  src/modules/agent-security/approval.controller.spec.ts \
  src/modules/agent-security/action-proposal.service.spec.ts \
  src/modules/briefs/briefs.controller.spec.ts \
  src/modules/briefs/brief-feedback.service.spec.ts \
  src/modules/briefs/briefs.presenter.spec.ts
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
HUMAN_IDEMPOTENCY_TEST_DATABASE_URL=postgresql://.../socos_human_idempotency_test_local_test \
  pnpm test:human-idempotency-integration
pnpm --filter @socos/agent-core test
pnpm --filter @socos/agent-core type:check
pnpm --filter @socos/web test
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
node --experimental-strip-types --test \
  scripts/security-regression.test.mjs \
  scripts/docker-packaging.test.mjs \
  scripts/coolify-ops.test.mjs \
  scripts/e2e-host-policy.test.mjs
node scripts/security-regression.mjs
git diff --check
```

Browser proof:

```bash
pnpm --filter @socos/web exec next start -p 3210
E2E_BASE_URL=http://127.0.0.1:3210 \
E2E_ALLOWED_HOSTS=127.0.0.1 \
  pnpm --filter @socos/web exec playwright test \
  e2e/daily-cockpit.spec.ts e2e/contacts-workspace.spec.ts
```

After independent approval, commit and push intentionally. Confirm `git rev-parse HEAD` equals `git rev-parse origin/main`. Deploy only with the exact full SHA:

```bash
COOLIFY_EXPECTED_COMMIT_SHA="$(git rev-parse HEAD)" \
  scripts/coolify.sh deploy swwcg80gkw4k0k4oco8w8wgw
```

Require the deployment UUID, `finished` status, exact commit, and `running:healthy`. Production smoke must be aggregate-only: public/health routes, protected Today/Approvals behavior, unauthenticated MCP denial, disabled OwnTracks behavior, and the `106/7/113` contact invariant. Never print proposal previews or personal rows.

## Authoritative Reading Order

1. `docs/ai-handoff-2026-07-17.md`
2. `git status --short --branch` and `git diff`
3. `docs/plans/2026-07-17-daily-cockpit-design.md`
4. `docs/superpowers/plans/2026-07-17-daily-cockpit.md`
5. `.superpowers/sdd/progress.md`
6. `docs/ai-handoff-2026-07-16.md` for the deployed Contacts evidence
7. `docs/plans/2026-07-15-personal-first-socos-design.md`
8. `docs/runbooks/database-backup-restore.md`
9. `docs/runbooks/calendar-location-operations.md`
10. `docs/integrations/socos-mcp.md`

README, PRD, MVP, and older API documents contain stale architecture and capability claims. Prefer current code, plans, task reports, progress ledger, and this handoff.

## Copy-Ready Prompt For Another AI

```text
Take over Socos and finish the work end to end. Work directly in `/Users/mac/Desktop/projects/personal/socos` on the existing `main` checkout. The user has authorized direct implementation, testing, cloud deployment, and sub-agent-driven work and does not want routine questions. Ask only when a real external consent/device action is unavoidable.

Start by reading, in order:
1. `docs/ai-handoff-2026-07-17.md` (authoritative current state and roadmap)
2. `git status --short --branch`, `git diff`, and `git log --oneline -20`
3. `docs/plans/2026-07-17-daily-cockpit-design.md`
4. `docs/superpowers/plans/2026-07-17-daily-cockpit.md`
5. `.superpowers/sdd/progress.md`
6. `docs/ai-handoff-2026-07-16.md` (last deployed Contacts evidence)
7. `docs/plans/2026-07-15-personal-first-socos-design.md`
8. `docs/runbooks/database-backup-restore.md`
9. `docs/runbooks/calendar-location-operations.md`
10. `docs/integrations/socos-mcp.md`

Recover product context from Mem0 when useful. Search with `user_id="yev"` across all agent scopes; do not default to `agent_id="codex"`. Prefer the native Mem0 MCP tools. Use the local bridge only if those are absent. Never print credentials or raw memory dumps, and never place private notes, contact rows, interactions, exact locations, OAuth data, or secrets into code, fixtures, logs, screenshots, prompts, or docs.

Current source-control boundary:
- Local reviewed product HEAD is `87e8c8bed9edff83da181d7b249c6341ee706cf9`; the final handoff-doc commit may be newer.
- `origin/main` and production are still at `fd5f40b6b2a1621c8c6d5f8d74dcc70c87acf9bd`.
- Local main is ahead by fifteen product/history commits before the final handoff-doc commit and should be ahead by sixteen afterward.
- There are no uncommitted product-code changes. Run `git status` rather than assuming the worktree is still clean, and preserve anything found. Do not reset, checkout, stash, clean, or rewrite the worktree.

Production boundary:
- URL: `https://socos.rachkovan.com`
- Coolify app UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Last deployment UUID: `stat2ao60x8di527vtw5rhhk`
- Last verified aggregate contacts: 106 non-demo, 7 demo, 113 total.
- Real personal data must stay only in Coolify PostgreSQL. Production inspection is aggregate-only.
- Calendar, location, event discovery, and event brief flags are false.

Immediate task: make the already reviewed authenticated Daily Cockpit pass its product gate, then release it before starting another product slice.
1. Inspect `git status`, this handoff, and the valid formal artifact `.betabots/runs/20260717-020626-daily-cockpit-real-postgres`. Its environment integrity is valid/verified with score cap 100; 5/5 sessions completed with zero product/request/LLM failures. It still failed the product gate: scores 43/51/39/69/100, median 51, 1/5 journeys achieved, and 11/23 applicable signals observed. The generic evidence checker required zero completed activities and does not override this failure.
2. Preserve the independently approved approval binding, response-loss-safe reminder/interaction writes, stable intent keys, truthful states, focus behavior, PostgreSQL attestation, migration verifier, and dedicated CI integration runner.
3. The exact review series is `a904d90`, `3744153`, `c571016`, and `87e8c8b`; final independent verdict is `APPROVE` with no Critical/Important findings.
4. Verification already includes API default 1,036/1,036, focused 162/162, web 29/29, agent-core 25/25, Playwright 11/11 including Pixel, real PostgreSQL concurrency/cleanup 2/2, and migration harness 10/10. Re-run release-critical checks after any change.
5. Fix the repeated product friction test-first: enrich Today cards with concrete role/last-contact/reason context; rename retrospective `Message` to `Log message`; prefill reminders from structured date/reminder context; and add truthful rejection, execution, and quest-evidence receipts. Preserve exact approval preview/payload/hash binding and stable idempotency.
6. Treat the two-minute run's unfinished forms as a harness/action-budget limitation, not proof of a broken save. Rerun affected journeys with four to five minutes or six to eight actions, require at least one completed activity, and keep real PostgreSQL, UI-created per-bot auth, real browsers, GPT-5.5, human pace, and synthetic data. Gate on happiness >=70, no Critical defects, >=90% applicable journey completion, and no high-confidence trust blocker.
7. After code changes, obtain a fresh independent review and rerun release-critical tests. Preserve unhappy stories and never transfer a score from the invalid directional run.
8. Commit and push `main`, verify exact origin SHA, take and verify a fresh Coolify backup, deploy that exact SHA through `scripts/coolify.sh`, require `running:healthy`, and run aggregate-only production smoke.
9. Update `.superpowers/sdd/progress.md` and `docs/ai-handoff-2026-07-17.md` with the passing Betabots result, deployment UUID/SHA, and smoke evidence.

After the Daily Cockpit is deployed, continue the roadmap in this order:
1. Google Calendar consent, Pixel OwnTracks enrollment, one certified ICS event source, and one-at-a-time feature activation. Ask Yev only for actual OAuth/Pixel steps.
2. Enumeration-resistant invite-request queue and reviewer UI while keeping signup invite-code-only.
3. Expand the deployed PostgreSQL integrity attestation into an eight-persona formal Betabots release gate; the generic `/api/health-check` process response alone remains insufficient.
4. First-class Codex plugin and Claude packaging around the existing 11-tool authenticated MCP, plus Hermes reply-to-action verification.
5. Proactive introduction ranking and provider-specific approved outbound executors.
6. Rich memory provenance/correction/export/deletion, import-integrity UI, deduplication through approvals, weekly planning, celebrations, gifts, adventures, meaningful rewards, and privacy-safe analytics.
7. Later security hardening: httpOnly-cookie/BFF auth and planned ContactField constraints.

Non-negotiable engineering rules:
- Preserve risk-based autonomy: automatic reads/summaries/logging/suggestions; approval for outbound messages, introductions, invitations, merges, and deletions.
- Approval is not execution; never use sent/performed copy for a grant.
- Use synthetic fixtures and screenshots only.
- Use additive forward-only migrations and verify a backup before schema/config changes.
- Deploy only an exact pushed, reviewed SHA and verify that exact SHA in Coolify.
- Do not enable personal-integration flags before consent/device/source setup and staged verification.
- Preserve unrelated changes and never use destructive git commands.
- Keep `.betabots/` ignored and do not commit browser profiles or evidence containing personal data.
- For substantial slices, use a written plan, test-first implementation, fresh implementer/reviewer agents that do not edit the same files concurrently, and Betabots after the user-facing workflow is usable.

Do not stop at analysis. Continue through implementation, review, verification, deployment, production smoke, and updated handoff unless a genuine external consent/device step is required.
```
