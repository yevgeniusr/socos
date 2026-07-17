# Socos Complete AI Handoff - 2026-07-17

This is the authoritative continuation document for Socos. It replaces the
2026-07-16 handoff and records deployed work, local undeployed work, active
work, remaining work, production facts, safety boundaries, and a ready-to-use
prompt for the next AI.

## Executive Summary

Socos is a personal-first, proactive, agent-friendly CRM. Its purpose is to
help Yev maintain relationships, remember dates and context, discover relevant
events based on plans and location, create useful introductions and social
adventures, and make social follow-through easier through evidence-based
gamification.

The deployed product is healthy and already useful for contacts, reminders,
relationship health, important dates, interaction history, daily briefs,
quests, XP, approval workflows, and agent access through REST/MCP. All 106
requested Monica contacts are in the Coolify database; no real contact data is
stored locally.

The immediate unfinished objective is to finish and deploy the Integrations
workspace, then activate Google Calendar, Pixel OwnTracks location, Dubai event
discovery, and a real Hermes Discord reply-to-CRM-action loop one dependency at
a time. The backend foundations exist, but the external connections are not
active. Do not describe them as active until real aggregate proof exists.

## State Snapshot

Snapshot taken on 2026-07-17 in `/Users/mac/Desktop/projects/personal/socos`.

| Item | State |
| --- | --- |
| Branch | `main` |
| Local HEAD at snapshot | `d01757e6a4ba3b8663044dc26329fcec749b5457` |
| `origin/main` at snapshot | `d57ada4fd0d380b82ca5cc6f84a3b7a93d00dc66` |
| Local divergence | Ahead by 4 commits |
| Tracked worktree at snapshot | Clean |
| Production app SHA | `b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1` |
| Production status | `running:healthy` |
| Production URL | `https://socos.rachkovan.com` |
| Active implementation | Integrations workspace Task 2; agent may commit after this snapshot |
| Post-snapshot transfer artifact | Untracked `apps/web/e2e/integrations-workspace.spec.ts` |

Always re-run `git status`, `git log`, and `git rev-parse` before continuing.
Do not assume that the active Task 2 state is unchanged.

## Product And Autonomy Contract

- Socos may automatically read, summarize, log interactions, update activity,
  and create suggestions.
- Outbound messages, introductions, invitations, merges, and deletions require
  explicit human approval.
- Approval is not execution. A proposal or grant must never be described as
  sent or performed.
- XP is shown only for server-verified evidence.
- Real contact, calendar, location, event, and private-note data belongs only in
  Coolify PostgreSQL.
- Local tests, screenshots, prompts, and beta cohorts use synthetic identities
  and records only.
- Never print or commit tokens, credentials, OAuth envelopes, private feed URLs,
  exact coordinates, private contact rows, or raw Second Brain notes.
- Disconnect and revoke stop future access; they must not be described as data
  deletion.

## Personal Context Reviewed

Mem0 was queried with `user_id="yev"` across all agent scopes, and relevant
Second Brain material was reviewed. The product direction derived from that
research is:

- Minimize CRM administration and notification noise.
- Support uneven social energy with one specific, low-friction next action.
- Preserve relationship context, promises, dates, provenance, uncertainty, and
  corrections without turning people into a sales pipeline.
- Prefer meaningful accountability and partially unpredictable rewards over
  cosmetic points or grinding.
- Balance professional networking, hobbies, learning, and social adventures.
- Optimize for Dubai now while retaining general multi-location support.
- Make Discord/Hermes a primary daily operating surface.
- Keep sensitive communication and irreversible operations behind approval.

Relevant interests include AI, open source, education, founders, mentoring,
events, travel, and digital-nomad life. Raw private notes and contact content
were deliberately not copied into this document.

## Done And Deployed

### Platform, Security, And Operations

- Repaired pnpm monorepo builds, CI, Docker packaging, migrations, startup, and
  health checks.
- Replaced bypassable authentication with signed JWT validation and protected
  unsafe routes.
- Removed destructive runtime database administration paths and committed
  secrets.
- Rotated affected credentials and restricted the runtime database role.
- Added backup/restore, migration, package, host-policy, idempotency, and
  security regression coverage.
- Added a public, sanitized PostgreSQL health attestation for real-backend beta
  verification without exposing database metadata.
- Deployed the exact verified application SHA and retained a fresh successful
  cloud backup as the release rollback point.

### Contacts And Personal Data

- Imported all 106 requested Monica contacts into Coolify PostgreSQL with
  provenance.
- Isolated 7 demo contacts from personal lists, scoring, briefs, and agent
  search where required.
- Production aggregate: 106 non-demo, 7 demo, 113 total.
- Built `/dashboard/contacts` with search, filters, pagination, Add Contact,
  profile editing, important dates, retrospective call/message logging,
  reminders, desktop side sheet, Pixel full-screen view, and focus containment.
- Added owner-scoped validation and demo-contact protections.

### Daily Cockpit And Approvals

- Built `/dashboard/today`; `/dashboard` redirects there.
- Built `/dashboard/approvals` with truthful proposal, grant, outbox, rejection,
  and execution states.
- Added independent brief, reminder, momentum, quest, and approval panels.
- Added keep, snooze, dismiss, reminder creation/completion, quest completion,
  and approval/rejection workflows.
- Added response-loss-safe intent keys and durable owner-scoped PostgreSQL
  idempotency for reminder and interaction writes plus XP.
- Added explainable focus cards containing relationship context, last contact,
  cadence, tasks, dates, and health labels.
- Interaction controls explicitly record historical calls/messages and never
  imply that a message was sent.
- Reminder receipts are based on the exact accepted request body and survive a
  subsequent refresh failure.
- Quest receipts show evidence type, verification time, and server-awarded XP.
- Approval receipts explicitly distinguish approval from execution.
- Pixel `412x915` navigation, focus behavior, and overflow were verified.

### CRM Intelligence And Gamification

- Implemented DailyBrief V1/V1.1.
- Implemented relationship health, important-date reminders, recommendations,
  feedback, reminders, quests, XP, streaks, achievements, and notifications.
- Added verified-evidence boundaries for quests and XP.
- Current graph-aware introduction logic fails closed with
  `INSUFFICIENT_GRAPH_DATA` when relationship evidence is too sparse.

### Agent, MCP, And Hermes Foundation

- Authenticated REST/MCP exposes exactly 11 owner-scoped tools for briefs,
  contacts, relationship health, important dates, reminders, interactions,
  feedback, quests, proposals, and approved execution boundaries.
- Hermes, Codex, and Claude clients were validated for scoped reads and denial
  behavior.
- `hermes mcp test socos` connected successfully and found all 11 tools.
- Hermes has an active 09:00 Asia/Dubai daily brief cron delivered to Discord;
  its last checked run succeeded.
- Provider executors are intentionally absent. Approved outbound actions return
  `ACTION_EXECUTION_UNAVAILABLE` instead of pretending execution occurred.

### Calendar, Pixel Location, And Event Backend Foundation

- Implemented encrypted Google Calendar OAuth with PKCE, single-use state,
  minimum read-only scopes, sync, reconciliation, renewable watches, webhook
  validation, calendar selection, disconnect, and encrypted provider state.
- Implemented OwnTracks-compatible Pixel device enrollment, one-time Basic
  credentials, rotation/revocation, precise-history ingest, retention, visit
  derivation, location aliases, and coarse current-location context.
- Implemented HTTPS allowlisted ICS source management, DNS-pinned fetching,
  private-address rejection, event normalization, ranking, calendar conflict
  checks, preferences, feedback, retention, and brief inclusion.
- Implemented personal-context deletion, aggregate audit, and encryption rekey
  support.
- Production provider credentials and encryption configuration were checked for
  structural presence without printing their values.
- Google OAuth now returns to the fixed authenticated result page
  `https://socos.rachkovan.com/dashboard/integrations` once that page is
  deployed. The callback remains fixed and input-independent.

These foundations are deployed disabled-first. They are not yet connected to
real Google Calendar, Pixel history, or event feeds.

## Completed Locally But Not Deployed

The following four commits are local and were not on `origin/main` at the
snapshot:

```text
5bb42ca docs: plan integrations activation workspace
1a7bf68 chore(integrations): return OAuth to activation workspace
3617f45 feat(integrations): add activation view contracts
d01757e fix(integrations): tighten shared activation contracts
```

Completed local work:

- Added the reviewed design at
  `docs/plans/2026-07-17-integrations-workspace-design.md`.
- Added the executable plan at
  `docs/superpowers/plans/2026-07-17-integrations-workspace.md`.
- Changed the fixed Google OAuth result URL from `/dashboard` to
  `/dashboard/integrations` in Compose, examples, packaging tests, and the
  operator runbook.
- Fixed `apiJson<void>()` so a valid HTTP 204 returns `undefined` without trying
  to parse an empty response.
- Added safe Calendar, device-list, coarse-location, event-source, and
  event-preference client contracts.
- Added strict disabled-state mapping: only status 503 plus code
  `integration_not_configured` is treated as disabled.
- Added strict Calendar result parsing for only `connected` or `error`.
- Removed reusable credential-bearing Pixel response types so one-time secrets
  remain local to the UI component that consumes them.
- Focused Vitest, web typecheck, packaging tests, security scan, workspace
  typecheck, and workspace build passed for completed tasks.
- Independent reviews approved Tasks 1 and 3 with no findings after the Task 1
  hardening commit.

## In Progress

### Integrations Workspace Task 2

An implementation agent was active at the snapshot. It then created a 601-line
synthetic Playwright specification at
`apps/web/e2e/integrations-workspace.spec.ts` before being interrupted for this
handoff. The file is intentionally untracked, has not been run, and has no
corresponding UI implementation or commit. Preserve it, review it against the
task brief, run the required production-build RED phase, and continue from
there. Inspect the shared worktree before assigning or restarting the task.

Target behavior:

- Add `/dashboard/integrations`.
- Replace the disabled Calendar navigation item with Integrations.
- Expose Integrations in four-column Pixel mobile navigation.
- Build independent Google Calendar, Pixel location, and event-discovery
  sections.
- Treat disabled configuration separately from transient errors.
- Google: connect, announce callback result, select calendars, and confirm
  disconnect with non-erasure copy.
- Pixel: create a device, show endpoint/username/password exactly once, rotate
  credentials, revoke ingest, and show coarse context only.
- Events: create, enable/disable, and remove sources; save balanced preferences;
  never redisplay the submitted feed URL.
- Preserve ready panels if another panel fails and provide panel-local retries.
- Use accessible confirmation and one-time-credential dialogs with focus trap,
  Escape handling, and trigger restoration.
- Prove the workflow with synthetic Playwright routes at desktop and
  `412x915`, with no horizontal overflow.

Required Task 2 report path:
`.superpowers/sdd/integrations-task-2-report.md`.

## Not Done Yet

### P0: Finish And Release The Integrations Workspace

1. Finish Task 2 with strict Playwright RED/GREEN evidence.
2. Run focused Vitest, Playwright, typecheck, lint, build, formatting, and diff
   checks.
3. Independently review Task 2 for API fidelity, secret lifetime, deletion
   wording, accessibility, and Pixel layout.
4. Fix every Critical or Important finding and re-review.
5. Run a whole-slice review across Tasks 1-3.
6. Run broad web/API/workspace/security/PostgreSQL/Contacts/Daily Cockpit
   regression suites.
7. Run a focused five-session GPT-5.5 Betabot cohort against real Nest, Next,
   PostgreSQL, and Chrome with synthetic Calendar, Pixel, and ICS fixtures.
8. Require all activation journeys, median happiness at least 70, no Critical
   defect, no secret exposure, and no precise-coordinate exposure.
9. Update this handoff with final commits and evidence.
10. Push `main`, take a fresh verified Coolify backup, deploy the exact SHA with
    all four integration flags still false, and smoke production boundaries.

### P0: Staged Real Integration Activation

Activate one dependency at a time. Roll back the current flag if health or
integrity checks fail.

1. Calendar: enable `CALENDAR_SYNC_ENABLED`, complete Google read-only consent,
   select calendars, and verify only aggregate connection/source/watch/sync
   state plus the user-visible calendar status.
2. Location: enable `LOCATION_INGEST_ENABLED`, create a device only when the
   one-time credentials can be consumed, configure OwnTracks on the Pixel, and
   verify aggregate device/sample/last-seen state. Precise/background access
   and battery optimization require actions on the phone.
3. Events: set `EVENT_SOURCE_ALLOWED_HOSTS=www.meetup.com`, enable
   `EVENT_DISCOVERY_ENABLED`, create one certified Dubai-relevant HTTPS ICS
   source, and verify aggregate source/event counts plus visible ranking and
   conflict behavior.
4. Briefs: enable `EVENT_BRIEF_ENABLED` only after discovery works, then verify
   aggregate brief/event counts and user-visible ranked suggestions.

Candidate sources already checked as public HTTPS `text/calendar` endpoints:

```text
https://www.meetup.com/dubai-ai/events/ical/
https://www.meetup.com/dubai-ai-meetup/events/ical/
https://www.meetup.com/startups-and-tech-events-in-dubai/events/ical/
```

Re-certify the chosen feed immediately before production use; public endpoints
can change.

### P0: Hermes Discord Action Loop

- Update the Hermes daily workflow so replies map unambiguously to stable brief
  items and the existing `socos_brief_feedback`, `socos_complete_quest`, and
  `socos_propose_action` MCP tools.
- Preserve idempotency and the risk-based autonomy policy.
- Prove a real Discord reply can record feedback or complete a verified CRM
  action through authenticated Socos MCP.
- Require approval for any outbound proposal and keep execution unavailable
  until a reviewed provider-specific executor exists.
- Package the behavior as a tracked Hermes/Socos skill or plugin rather than an
  undocumented prompt mutation.

### P1: Safer Activation Operations

- Extend Coolify tooling with a fail-closed activation command.
- Read environment values through stdin or a secure payload, never command-line
  arguments or logs.
- Permit only known flags and enforce dependency order.
- Require a fresh successful backup before each rollout stage.
- Update duplicate Coolify environment records consistently.
- Deploy/restart the exact SHA, health-check it, and restore the prior flag on
  failure.
- Do not claim restore proof unless an actual restore was executed. The current
  session can trigger and inspect backups but has no working production host
  shell; Coolify CLI does not expose restore, and SSH was denied.

### P1: Daily Product Quality

- Add a durable interaction receipt showing the exact recorded interaction,
  updated last-contact value, XP delta, and `Recorded only; nothing sent` copy.
- Mark required interaction fields before submit and consider safe contextual
  prefills.
- Add the non-blocking unit regression proving numeric-looking string quest
  evidence such as `"2"` fails closed to a follow-up.
- Improve the brief and reminder loop based on actual daily use after Calendar,
  location, and events are active.

### P2: Relationship Memory And Social Planning

- Add memory extraction with confidence, source provenance, correction,
  deduplication, export, deletion, and merge-approval UX.
- Build weekly planning/reflection, celebrations, gifts, group plans, social
  adventures, and better cadence management.
- Improve proactive introduction ranking after enough graph evidence exists.
- Add favorite-things categories and purpose-built public widgets such as a
  bookshelf view from the Second Brain backlog.

### P2: Agent Ecosystem And Execution

- Package first-class Codex and Claude plugins around the existing authenticated
  MCP tools and client documentation.
- Add provider executors only behind exact reviewed payloads, a durable outbox,
  replay protection, audit, and explicit approval.
- Replace old rule-based AI note-generation placeholders only with a tested,
  privacy-aware inference boundary; do not make this a prerequisite for the
  integration activation.

### P3: Gamification And Generalization

- Tune accountability, anti-grind rules, meaningful rewards, campaigns, and
  partially unpredictable reinforcement using real personal usage evidence.
- Generalize onboarding, tenancy, configuration, and public documentation only
  after the personal-first workflow is dependable.
- Refresh the root README; several stack/version and feature claims no longer
  precisely match the current implementation.

## Production And Operations Facts

```text
Coolify application UUID: swwcg80gkw4k0k4oco8w8wgw
Coolify database UUID: zwkk0scogckskkwss8oo48k4
Production deployment UUID: z3bpqa8m3wx1gc89t8c3adu6
Production deployment SHA: b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1
Production backup execution: culn3f82333kj6zvzdklpo7s
Backup status: success
Backup size: 169842 bytes
```

Feature flags at the snapshot:

```text
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

The Google client ID/secret, OAuth URLs, encryption keys, and personal-data
index keys were checked for structural presence in both Coolify environment
copies without revealing values. `EVENT_SOURCE_ALLOWED_HOSTS` was empty.
`OWNTRACKS_WEBHOOK_SECRET` is not required because ingress uses per-device
one-time credentials.

Last production smoke:

```text
/=200
/sample-workspace=200
/auth/signup=200
/api/health-check=200
/api/reminders=401
/api/agents/reminders/upcoming=401
POST /api/mcp=401
POST /api/location/owntracks=503
POST /api/admin/database/migrate=404
```

The 401 and 503 statuses above are expected security/disabled-feature
boundaries, not failures.

## Verification Evidence

Daily Cockpit proof-layer verification at the released code line:

```text
Web Vitest: 8 files, 53/53 passed
Agent Core Vitest: 2 files, 25/25 passed
API Jest: 94 suites passed, 1 skipped; 1,036 passed, 5 skipped
Workspace typechecks: 5/5 passed
Workspace builds: 4/4 passed; Next generated 15 pages
Workspace lint: 0 errors; existing warnings only
Daily Cockpit Playwright: 15/15 passed
Contacts Playwright: 3/3 passed
Infrastructure/security/package/host-policy: 120 passed, 1 skipped
Security scanner: passed across 546 tracked files
Real PostgreSQL migration safety: 10/10 passed
Calendar/location PostgreSQL integration: passed
Human-idempotency PostgreSQL integration: passed
Final independent review: APPROVE
```

Authoritative formal cohort:

```text
.betabots/runs/20260717-052117-daily-cockpit-proof-gate-rerun-real-postgres
environment valid=true, verified=true, scoreCap=100
GPT-5.5 calls: 31; failures: 0; fallbacks: 0
sessions: 5/5 complete
screenshots: 49
UI actions: 23
errors: 0
scores: 81, 65, 81, 96, 97
median: 81
happy >=70: 4/5
unhappy <50: 0/5
journeys: 5/5
required activity evidence: 5/5
release gate: PASS
```

The 65-score session completed its workflow but found required Notes hard to
discover and wanted a richer post-save interaction receipt. That is captured in
the P1 roadmap.

## Important Files

- `AGENTS.md`: repository and Mem0 rules.
- `docs/ai-handoff-2026-07-17.md`: this authoritative state.
- `.superpowers/sdd/progress.md`: detailed task/commit ledger; ignored locally.
- `docs/superpowers/plans/2026-07-17-integrations-workspace.md`: current
  executable plan.
- `docs/plans/2026-07-17-integrations-workspace-design.md`: approved design.
- `docs/runbooks/calendar-location-operations.md`: integration operations.
- `docs/runbooks/database-backup-restore.md`: backup/restore evidence and limits.
- `docs/integrations/hermes-social-brief.md`: Hermes daily brief operation.
- `docs/integrations/hermes-mcp.md`: Hermes MCP client setup.
- `scripts/coolify.sh`: current Coolify helper; treat secret-bearing argv as a
  known limitation until P1 hardening is complete.

## Resume Checklist

1. Read `AGENTS.md` and this document.
2. Run `git status --short --branch`, `git log --oneline -12`, and compare local,
   origin, and production SHAs.
3. Inspect active/subagent state and the untracked Task 2 Playwright spec before
   modifying Integrations files.
4. Read the Integrations design, plan, current task report, and diff; validate
   the untracked spec and run its required RED phase before UI implementation.
5. Preserve all existing work and real-data boundaries.
6. Finish Task 2, review it, and complete the full P0 release gate.
7. Deploy disabled-first, then activate Calendar, Pixel, events, and event briefs
   one at a time.
8. Finish and prove the Hermes Discord reply loop.
9. Update this handoff with exact commits, test results, deployment UUID, backup
   execution, aggregate verification, and remaining external blockers.

## Continuation Prompt

Give the following prompt to another AI:

```text
Continue Socos end to end in /Users/mac/Desktop/projects/personal/socos on the
existing main branch. You are taking over an active personal-first CRM project,
not starting a new implementation.

First read, in order:
1. AGENTS.md
2. docs/ai-handoff-2026-07-17.md
3. docs/plans/2026-07-17-integrations-workspace-design.md
4. docs/superpowers/plans/2026-07-17-integrations-workspace.md
5. .superpowers/sdd/progress.md
6. any current .superpowers/sdd/integrations-task-*-report.md files

Then inspect git status, the last 12 commits, local HEAD, origin/main, active
subagents, and current production SHA. The handoff snapshot may be behind an
active Integrations Task 2 agent, so trust the current worktree and commit
evidence over the snapshot. Do not reset, clean, stash, rewrite history, switch
branches, or discard any existing/user changes. Work directly on the current
main branch as authorized.

At transfer time, apps/web/e2e/integrations-workspace.spec.ts is an untracked
601-line synthetic Playwright draft. It has not been run, and the UI files have
not been implemented. Preserve and review it, then run the required
production-build RED phase before implementing the workspace.

Use Mem0 only with user_id="yev" across all agent scopes, never Codex-only scope,
when personal context is needed. Preferred command from
/Users/mac/Desktop/projects/claw is:
python3 second-brain/scripts/mem0_query.py profile --top-k 20
Review only relevant Second Brain Socos/networking/gamification/event material.
Do not copy raw private notes into code, tests, prompts, logs, screenshots, or
handoff documents.

Non-negotiable data boundary: all real contacts, calendar data, location
history, event data, and private notes remain only in Coolify PostgreSQL. Use
synthetic local fixtures. Never print secrets, OAuth tokens, one-time device
credentials, private feed URLs, exact coordinates, personal contact rows, or
raw notes. Never pass secret values in shell argv. Query production only for
fixed status codes and aggregate proof.

Preserve the autonomy contract: Socos may automatically read, summarize, log,
update activity, and suggest. Outbound messages, introductions, invitations,
merges, and deletions require explicit human approval. Approval is not
execution. XP must come only from server-verified evidence. Disconnect/revoke
must not be described as erasure.

Current production is healthy at https://socos.rachkovan.com on SHA
b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1. At the handoff snapshot local main
was d01757e, origin/main was d57ada4, and local was four commits ahead. The 106
real Monica contacts plus 7 isolated demo contacts are cloud-only. The passing
Daily Cockpit cohort is
.betabots/runs/20260717-052117-daily-cockpit-proof-gate-rerun-real-postgres
with verified real backend, GPT-5.5, median 81, 5/5 journeys, 5/5 activity
evidence, and 0 errors.

Immediate objective:
1. Finish Integrations Task 2 at /dashboard/integrations test-first.
2. Independently review it and fix every Critical/Important issue.
3. Run whole-slice review, broad tests, and a new five-session real-backend
   GPT-5.5 Betabot activation cohort with synthetic data.
4. Push main, take a fresh verified backup, deploy the exact SHA with
   CALENDAR_SYNC_ENABLED, LOCATION_INGEST_ENABLED, EVENT_DISCOVERY_ENABLED, and
   EVENT_BRIEF_ENABLED all false, then smoke production.
5. Activate Google Calendar read-only sync and verify aggregate state.
6. Enroll the Pixel through OwnTracks and verify aggregate ingest/last-seen
   state. Ask Yev only for unavoidable phone permission/install actions.
7. Allowlist www.meetup.com, certify one Dubai AI/tech ICS source, enable event
   discovery, verify aggregates and visible ranking/conflict behavior, then
   enable event briefs last.
8. Implement and prove a real Hermes Discord reply mapping to stable brief
   items using socos_brief_feedback, socos_complete_quest, and
   socos_propose_action. Keep outbound execution approval-gated and unavailable
   until a provider executor is explicitly reviewed.
9. Update the authoritative handoff with exact evidence.

Use strict TDD, subagent-driven development, independent task/final reviews,
verification-before-completion, and Betabots. Do not ask routine questions;
make conservative choices from the codebase. Do not claim a feature is active,
an action is executed, or a restore is proven without direct evidence. Continue
until the integrations and Hermes loop are genuinely usable or an unavoidable
Google/Pixel action is precisely identified.
```
