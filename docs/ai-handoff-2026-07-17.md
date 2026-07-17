# Socos AI Handoff - 2026-07-17

This is the authoritative continuation document for Socos. It replaces the
earlier state recorded in `docs/ai-handoff-2026-07-16.md`.

## Executive State

Socos is a personal-first, agent-friendly CRM for relationship maintenance,
important dates, reminders, proactive social planning, durable personal
memory, and behavior-changing gamification. The immediate strategy remains:
make it genuinely useful for Yev first, then generalize.

Production is `running:healthy` on the deployed Daily Cockpit release
`b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1`. The reviewed implementation,
Docker packaging correction, and this release state are on `origin/main`.
The next work is staged Google Calendar, Pixel location, event discovery, and
Hermes action-loop activation; all four integration flags remain disabled.

Do not reset, clean, stash, rewrite, or check out over this worktree. Continue
on the existing `main` branch and preserve unrelated user changes.

## Non-Negotiable Contract

- Socos may automatically read, summarize, log interactions, update activity,
  and create suggestions.
- Outbound messages, introductions, invitations, merges, and deletions require
  explicit human approval.
- Approval is not execution. A proposal or grant must never be described as
  sent or performed.
- XP is displayed only for server-verified evidence.
- Real contact, calendar, and location data belongs only in Coolify PostgreSQL,
  never in the repository, local fixtures, logs, screenshots, or prompts.
- Tests and beta cohorts use synthetic identities and records only.

Mem0 was queried with `user_id="yev"` across all agent scopes and the Second
Brain was reviewed. The durable product direction is to minimize CRM admin,
support uneven social energy, preserve rich relationship context with
provenance and correction, and use meaningful accountability and partly
unpredictable rewards instead of cosmetic points. Relevant interests include
AI, open source, education, founders, mentoring, events, travel, and
digital-nomad life. Raw private notes and contact content were not copied here.

## Done And Deployed

### Platform And Security

- Repaired pnpm monorepo builds, CI, Docker packaging, migrations, startup,
  health checks, and Coolify operations.
- Replaced bypassable authentication with signed JWT validation and guarded
  unsafe routes.
- Removed destructive runtime database administration paths and committed
  secrets; rotated affected credentials and restricted the runtime DB role.
- Added backup/restore, migration, host-policy, package, idempotency, and
  security regression coverage.

### Contacts And Personal Data

- Imported all 106 requested Monica contacts into Coolify PostgreSQL with
  provenance; no real contact rows are stored locally.
- Isolated 7 demo contacts from personal lists, scoring, briefs, and agent
  search where required.
- Deployed `/dashboard/contacts` with search, filters, pagination across all
  records, profile editing, important dates, retrospective call/message
  logging, reminders, Add Contact, desktop side sheet, Pixel full-screen view,
  focus containment, and exact API contracts.
- Production aggregate proof at the last release: 106 non-demo contacts, 7
  demo contacts, 113 total.

### Intelligence, Gamification, MCP, And Hermes

- Durable DailyBrief V1/V1.1, relationship health, important dates,
  recommendations, feedback, reminders, quests, XP, streaks, achievements,
  notifications, and evidence verification exist.
- Authenticated REST/MCP exposes exactly 11 owner-scoped tools for briefs,
  contacts, health, dates, reminders, interactions, feedback, quests,
  proposals, and approved execution boundaries.
- Hermes, Codex, and Claude clients were validated for scoped reads and denial
  behavior. Hermes delivered a Discord daily brief on a 09:00 Asia/Dubai
  schedule.
- Provider executors are intentionally absent: approved outbound actions return
  `ACTION_EXECUTION_UNAVAILABLE` rather than pretending execution occurred.

### Calendar, Pixel Location, And Events Foundation

- Implemented encrypted Google Calendar OAuth/sync/watch/reconciliation,
  OwnTracks-compatible Pixel precise-history ingest and visit derivation,
  allowlisted ICS discovery, event ranking, calendar conflict checks,
  preferences, feedback, deletion, rekeying, and aggregate audit.
- Google OAuth returns to the authenticated activation workspace at the fixed
  `https://socos.rachkovan.com/dashboard/integrations` result URL; the provider
  callback remains fixed and input-independent.
- Deployed disabled-first. These flags must stay false until external setup and
  staged activation are complete:

```text
CALENDAR_SYNC_ENABLED=false
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

Google Maps Timeline is not the live ingress. The selected Pixel path is an
OwnTracks-compatible reporter.

## Daily Cockpit Release

The authenticated cockpit and approvals workspace are implemented at
`/dashboard/today` and `/dashboard/approvals`, with `/dashboard` redirecting to
Today.

Completed behavior:

- Independently truthful brief, reminder, momentum, quest, and approval panels.
- Keep, snooze, dismiss, reminder creation/completion, verified quest
  completion, and approval/rejection workflows.
- Stable response-loss-safe intent keys and owner-scoped PostgreSQL human
  idempotency for reminder and interaction writes plus XP.
- Explainable focus cards with relationship context, last interaction, cadence,
  tasks, dates, and health labels.
- Contacts actions explicitly say `Log call` and `Log message`; they record
  history and do not imply outbound messaging.
- Structured person-card reminder drafts match only numeric
  `important_date_days`, exact contact ID, and exact `daysAway`. No reminder
  type is inferred from prose.
- Successful reminder creation shows a persistent, focused receipt derived
  from the exact accepted request body. Reminder refresh failure cannot remove
  it.
- Verified quest receipts show evidence type, verification time, and
  server-awarded XP.
- Approval receipts distinguish rejection, approval grant, outbox state, and
  execution; rejection explicitly says nothing was sent and no XP changed.
- A compact pending-quest header link targets the focusable existing quest
  heading and is Pixel-safe.

The proof-layer implementation commits are:

```text
cb38ac4 fix(cockpit): prefill structured person dates
6043753 fix(cockpit): retain reminder creation proof
60848ee test(cockpit): prove reminder response loss retry
```

Independent task reviews and the final whole-slice review found no Critical or
Important issues. One non-blocking Minor remains: add a direct unit assertion
that numeric-looking string evidence such as `"2"` falls back to a follow-up.
Production already enforces `typeof value === "number"` and fails closed.

## Fresh Verification At `60848ee`

```text
Web Vitest: 8 files, 53/53 passed
Agent-core Vitest: 2 files, 25/25 passed
API Jest: 94 suites passed, 1 skipped; 1,036 passed, 5 skipped
Workspace typechecks: 5/5 tasks passed
Workspace builds: 4/4 tasks passed; Next generated 15 pages
Workspace lint: 0 errors; existing warnings only
Daily Cockpit Playwright: 15/15 passed
Contacts Playwright: 3/3 passed
Infrastructure/security/package/host-policy: 120 passed, 1 skipped
Security scanner: passed across 546 tracked files
Real PostgreSQL migration safety: 10/10 passed
Calendar/location PostgreSQL integration: passed
Human-idempotency PostgreSQL integration: passed
Final whole-slice independent review: APPROVE
```

The first clean Coolify build exposed a deployment-only packaging omission:
the web image did not copy the Agent Core workspace manifest before dependency
installation, so `zod` was absent. Commit `b0e88cc` added the missing manifest
copy and a packaging regression assertion. The focused Node packaging suite,
local web production build, and a clean no-cache build of
`docker/Dockerfile.web` all passed before redeployment. No product behavior
changed after the approved cohort.

## Formal Beta Gate

The authoritative passing run is:

```text
.betabots/runs/20260717-052117-daily-cockpit-proof-gate-rerun-real-postgres
```

It used fresh visible-signup accounts, isolated persistent PostgreSQL, real
Nest/Next services, real Chrome, GPT-5.5 minds, strict scoring, four-minute
human pacing, and synthetic records only.

```text
environment: valid=true, verified=true, scoreCap=100
LLM: 31 calls, 0 failures, 0 fallbacks
sessions: 5/5 complete
screenshots: 49
UI actions: 23
errors: 0
scores: 81, 65, 81, 96, 97
median: 81
happy >=70: 4/5
unhappy <50: 0/5
journeys achieved: 5/5
required activity evidence: 5/5
release gate: PASS
```

The one 65 score completed its retrospective message-log journey and showed a
durable changed last-contact date plus XP from 200 to 260. Its friction was
discovering that Notes is required and wanting a richer post-save interaction
receipt. This is useful next-iteration feedback, not a trust or release
blocker: the UI consistently framed the action as logging history, and no bot
believed an outbound message was sent.

The prior valid run at `20260717-051050...` used an ambiguous fixture that put
a Nova follow-up reminder closer than Nova's birthday and expected only +10 XP
despite a first-interaction achievement. It is valid research evidence but not
the final product gate. The rerun corrected only those synthetic fixtures and
scoring signals; product code and strict scoring were unchanged.

## Release Completed

Production URL: `https://socos.rachkovan.com`.

```text
backup execution: culn3f82333kj6zvzdklpo7s
backup status: success
backup size: 169842 bytes
deployment UUID: z3bpqa8m3wx1gc89t8c3adu6
deployment commit: b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1
application status: running:healthy
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

The four Calendar/location/event flags were checked through the Coolify API
before deployment and every configured copy was exactly `false`. Production
smoke inspected only fixed status codes. The most recent aggregate contact
proof remains 106 non-demo, 7 isolated demo, and 113 total; no private rows,
notes, calendar data, or coordinates were read during this release.

## Remaining Roadmap

### Immediate Activation

- Complete Google OAuth consent/configuration, connect selected read-only
  calendars, then enable Calendar sync in a staged rollout.
- Enroll the Pixel OwnTracks-compatible device, verify encrypted history and
  retention, then enable location ingest.
- Certify at least one allowlisted Dubai-relevant ICS source, enable event
  discovery, validate ranking/conflicts, then enable event briefs.
- Prove a real Hermes Discord reply-to-approved-CRM-action loop. Keep all
  outbound actions approval-required.

### Product Work

- Add a durable interaction receipt showing the exact record, updated last
  contact, XP delta, and explicit `Recorded only; nothing sent` copy.
- Mark required interaction fields before submission and consider safe
  context-aware prefills.
- Build weekly planning/reflection, celebrations, gifts, group plans, social
  adventures, and better proactive cadence management.
- Add relationship-memory extraction with confidence, provenance, correction,
  deduplication, export, deletion, and merge approval UX.
- Improve introduction ranking once graph density is sufficient; current
  strategy may correctly return `INSUFFICIENT_GRAPH_DATA`.
- Package first-class Codex and Claude plugins around the existing MCP client
  docs and authenticated tools.
- Add provider executors only behind exact reviewed payloads, durable outbox
  state, audit, and explicit approval.
- Tune gamification with accountability, anti-grind rules, meaningful rewards,
  campaigns, and partly unpredictable reinforcement.
- Future Second Brain backlog: favorite-things categories and purpose-built
  public widgets such as a bookshelf view.

## Continuation Prompt

Give the following prompt to another AI:

```text
Continue Socos in /Users/mac/Desktop/projects/personal/socos on the existing
main branch. Read docs/ai-handoff-2026-07-17.md first; it is the authoritative
state. Then read AGENTS.md, .superpowers/sdd/progress.md, and the plans under
docs/superpowers/plans/ for the task you are resuming.

Do not reset, clean, stash, rewrite history, or discard any user changes.
Check git status and exact SHAs before acting. Real personal data must remain
only in Coolify PostgreSQL; use synthetic local data and never print secrets,
contact rows, private notes, calendar contents, or coordinates.

Preserve the autonomy contract: automatic read/summarize/log/suggest is
allowed, but messages, introductions, invitations, merges, and deletions need
human approval. Approval is not execution. XP must come only from verified
server evidence.

Current deployed application head is
b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1. The passing formal cohort is
.betabots/runs/20260717-052117-daily-cockpit-proof-gate-rerun-real-postgres:
verified real backend, GPT-5.5, median 81, 5/5 journeys, 5/5 activity evidence,
0 errors. Independent final review approved with no Critical or Important
findings. Commit b0e88cc contains only the verified deployment packaging fix.
Fresh verification commands, release UUIDs, and smoke results are in the
handoff.

First verify git status, origin/main, the current production SHA, and that all
four integration flags are still false. Then prioritize Google Calendar
consent and read-only connection, Pixel OwnTracks enrollment, one certified
Dubai-relevant event source, and the Hermes Discord reply-to-approved-action
loop. Enable one feature flag at a time only after backup, health, and
aggregate verification. Ask Yev only for unavoidable Google consent or Pixel
device actions.

Continue the product roadmap test-first using subagent-driven development,
independent task/final review, broad verification, and fresh real-backend
Betabots. Fix every Critical/Important finding before deployment. Do not ask
routine questions; make conservative choices from the codebase and document
external blockers precisely.
```
