# Socos AI Handoff - 2026-07-17

This is the authoritative Socos continuation document. It records what is
deployed, what is active, what remains, the safety contract, production facts,
verification evidence, and a ready-to-use prompt for another AI.

## Executive Summary

Socos is now a usable personal-first CRM for Yev. It stores all 106 requested
Monica contacts in Coolify PostgreSQL, isolates 7 demo contacts, provides
contacts, reminders, important dates, relationship health, interaction history,
Daily Cockpit, approvals, quests, XP, and authenticated REST/MCP access.

The new Integrations workspace is deployed at
`https://socos.rachkovan.com/dashboard/integrations`. Google Calendar code is
enabled and healthy, but the real Google account is not connected. The protected
Socos Keychain login credential is stale, and the final Google OAuth grant is an
unavoidable user-confirmed action. Pixel location, event discovery, and event
briefs remain disabled so activation still follows dependency order.

The tracked Hermes `socos-social-loop` skill is installed and attached to the
active 09:00 Asia/Dubai Discord cron. The gateway is supervised. Today's
successful cron run happened before the skill was attached, so a post-attachment
skill-generated brief and real Discord reply mutation remain unproven.

## Current State

Snapshot taken in `/Users/mac/Desktop/projects/personal/socos`.

| Area | State |
| --- | --- |
| Reviewed application SHA | `1b25328de683e5b7923d4219d0401a1f93f168b2` |
| GitHub `origin/main` before this docs-only update | same reviewed SHA |
| Production application SHA | same reviewed SHA |
| Production status | `running:healthy` |
| Production URL | `https://socos.rachkovan.com` |
| Real contacts | 106 non-demo, cloud-only |
| Demo contacts | 7, isolated where required |
| Calendar code | enabled; real OAuth connection pending |
| Pixel location | disabled |
| Event discovery | disabled |
| Event briefs | disabled |
| Hermes | installed, gateway supervised, cron active |
| Live Discord reply proof | pending |

This handoff itself may be a later documentation-only commit than the reviewed
production SHA. Re-run `git status`, `git log -1`, and `git ls-remote`
before changing or deploying anything.

## Product And Safety Contract

- Socos may automatically read, summarize, log interactions, update activity,
  and create suggestions.
- Outbound messages, introductions, invitations, merges, and deletions require
  explicit approval.
- Approval is not execution. No proposal or grant may be described as sent.
- XP is awarded only from server-verified evidence.
- All real contacts, Calendar records, precise location history, event data,
  and private notes remain only in Coolify PostgreSQL.
- Local development, screenshots, prompts, and cohorts use synthetic data.
- Never print or commit credentials, OAuth material, database URLs, private
  contact rows, private feed URLs, exact coordinates, Discord targets, or raw
  Second Brain notes.
- Disconnect and revoke stop future access. They do not erase retained data.
- Production checks use fixed status codes and aggregate evidence only.

## Personal Context Reviewed

Mem0 was queried with `user_id="yev"` across all agent scopes, and relevant
Second Brain notes were reviewed without copying raw private content.

The resulting product direction is:

- minimize CRM administration and notification noise;
- offer one specific low-friction action when social energy is uneven;
- preserve dates, promises, context, provenance, uncertainty, and corrections;
- balance professional networking, hobbies, learning, and social adventures;
- optimize for Dubai now while retaining multi-location support;
- use meaningful accountability and variable rewards instead of grind;
- make Discord/Hermes a primary daily operating surface;
- keep communication and irreversible actions approval-gated.

## Done And Deployed

### Platform, Security, And Data

- Repaired the pnpm monorepo, CI, Docker packaging, migrations, startup, and
  health checks.
- Replaced forgeable identity paths with signed JWT validation.
- Removed destructive runtime database administration routes and committed
  secrets; rotated affected credentials and restricted the runtime DB role.
- Added migration, backup, host-policy, idempotency, package, and security
  regression coverage.
- Added a sanitized PostgreSQL health attestation for real-backend cohorts.
- Imported all 106 Monica contacts directly into cloud PostgreSQL with
  provenance. No real contact export is stored locally.
- Kept 7 demo contacts out of personal lists, briefs, scoring, and agent search
  where required.

### Personal CRM

- `/dashboard/contacts`: search, filters, pagination, add/edit, dates,
  retrospective call/message logging, reminders, desktop side sheet, and Pixel
  full-screen behavior.
- `/dashboard/today`: relationship focus, dates, reminders, momentum, quests,
  approvals, feedback, snooze/dismiss/keep, and durable receipts.
- `/dashboard/approvals`: truthful proposal, grant, rejection, outbox, and
  unavailable-execution states.
- Relationship health, important-date reminders, recommendations, feedback,
  quests, XP, streaks, achievements, and notifications.
- Durable owner-scoped idempotency for interaction, reminder, and XP writes.
- Verified-evidence boundaries for quest completion and XP.
- Graph introductions fail closed with `INSUFFICIENT_GRAPH_DATA` when evidence
  is too sparse.

### Agent And MCP Surface

- Exactly 11 authenticated owner-scoped MCP tools cover briefs, contacts,
  relationship health, important dates, reminders, interactions, feedback,
  quests, proposals, and approved execution boundaries.
- Hermes, Codex, and Claude clients were validated for scoped reads and denial
  behavior.
- Provider executors are intentionally absent. Approved outbound actions return
  `ACTION_EXECUTION_UNAVAILABLE` instead of pretending to execute.

### Integrations Workspace

- Deployed `/dashboard/integrations` with independent Google Calendar, Pixel
  location, and certified event-source panels.
- Correct disabled/error/ready states; a failed panel does not erase healthy
  panels.
- Safe Next proxy behavior for empty 204/205/304 responses, bodyless requests,
  DELETE query/body handling, manual redirects, and safe headers.
- Authoritative request/race handling prevents stale reads from overwriting
  accepted mutations.
- Calendar connect, source selection, reconnect, and truthful disconnect copy.
- Pixel enroll, one-time credentials, rotation, revoke, non-secret receipts,
  coarse context only, and stable focus restoration.
- Event source create/enable/disable/remove and balanced preference controls.
  Submitted feed URLs are never redisplayed.
- Accessible dialogs, focus trap/restoration, panel-local retry, and verified
  `412x915` mobile layout.
- Both Coolify copies of the Calendar result URL now return to
  `/dashboard/integrations`.

### Integration Backends

- Encrypted read-only Google Calendar OAuth with PKCE, single-use state,
  calendar selection, sync/reconciliation, renewable watches, webhook
  validation, disconnect, and encrypted provider state.
- OwnTracks-compatible Pixel enrollment, one-time Basic credentials,
  rotation/revocation, precise-history ingest, retention, visit derivation,
  aliases, and coarse current context.
- HTTPS allowlisted ICS source management, DNS-pinned fetches, private-address
  rejection, normalization, ranking, conflict checks, preferences, feedback,
  retention, and brief inclusion.
- Personal-context deletion, aggregate audit, and encryption rekey support.

### Hermes Social Loop

- Tracked skill:
  `integrations/hermes/skills/socos-social-loop/SKILL.md`.
- Installed copy matches the tracked skill byte-for-byte.
- Planner accepts only exact stable brief IDs, rejects edited Discord messages,
  uses a strict `{ok:true,data}` MCP envelope, and emits at most one allowlisted
  mutation.
- Input is stdin-only; no secret, command, or MCP response is persisted.
- Feedback, exact-evidence quest completion, and proposal creation are
  supported. The MCP registry exposes `socos_execute_approved_action`, but the
  Hermes planner never emits it and provider execution currently returns
  unavailable.
- Cron `59db0ea1d9d8` is active at 09:00 Asia/Dubai, has
  `socos-social-loop` attached, and uses the Socos checkout. Its latest run is
  `ok`, but that run predates skill attachment.
- The Hermes gateway is supervised by launchd.

Installed and attached does not prove a live Discord reply mutation.

## Verification Evidence

Application and integration verification:

```text
Web Vitest: 66/66
Hermes planner: 14/14
Integrations production Chromium: 15/15
Focus stress: 45/45 + 30/30 + 15/15
Contacts + Daily Cockpit + Integrations Chromium: 33/33
API Jest: 94 suites passed, 1 skipped; 1,036 passed, 5 skipped
Workspace typechecks: 5/5
Workspace builds: 4/4; Next generated 16 pages
Lint: 0 errors; pre-existing warnings only
Infrastructure/security: 120 passed, 1 expected skip
Security scanner: 567 tracked files
PostgreSQL migration safety: 10/10
Calendar/location PostgreSQL integration: passed
Human-idempotency PostgreSQL integration: passed
Independent Integrations review: APPROVE
Independent Hermes review: APPROVE
```

Final activation cohort:

```text
.betabots/runs/20260717-073101-integrations-activation-prep
real Nest + Next + PostgreSQL + browser auth: verified
GPT-5.5 calls: 31; failures: 0; fallbacks: 0
sessions: 5/5
scores: 69, 94, 73, 96, 85
median: 85
happy >=70: 4/5
unhappy <50: 0/5
goal achieved: 5/5
product evidence: 5/5
browser issues: 0
mind action failures: 0
screenshots: 47
strict activation verifier: passed
synthetic UI tokens and Pixel credentials: inert
unresolved Critical/Important defects: 0
```

Earlier activation iterations are retained as failed evidence under the same
ignored run directory. They exposed harness-string mismatches and one model
timeout; they were not relabeled as passes.

The prior Daily Cockpit formal cohort remains at:

```text
.betabots/runs/20260717-052117-daily-cockpit-proof-gate-rerun-real-postgres
median: 81
journeys: 5/5
errors: 0
release gate: PASS
```

## Production Facts

```text
Application UUID: swwcg80gkw4k0k4oco8w8wgw
Database UUID: zwkk0scogckskkwss8oo48k4
Backup configuration UUID: b85nxfljaz0xpo9xqa57lfr4
Reviewed/deployed SHA: 1b25328de683e5b7923d4219d0401a1f93f168b2
Disabled-first deployment: jstocddvahtq2ptk159krd6e
Calendar activation deployment: y113fr76fqqod7wq8uatmgzx
Fresh backup execution: mnqo384k8e83wtmxl0a7x7lq
Fresh backup status: success
Fresh backup size: 173186 bytes
Rollback SHA: b0e88ccc535ba79d71a5586f341e0d3ac6be8ac1
```

Current feature flags in both production and preview profiles:

```text
CALENDAR_SYNC_ENABLED=true
LOCATION_INGEST_ENABLED=false
EVENT_DISCOVERY_ENABLED=false
EVENT_BRIEF_ENABLED=false
```

Disabled-first production smoke passed:

```text
GET  /                                      200
GET  /dashboard/integrations                200
GET  /api/health-check                      200
GET  authenticated CRM/integration routes  401
POST /api/mcp                               401
POST /api/location/owntracks                503
POST destructive admin routes              404
```

After Calendar activation, health remained `200`, the authenticated Calendar
route remained `401`, and disabled OwnTracks remained `503`.

A successful backup is not restore proof. No restore was performed for this
schema-neutral release.

## In Progress

### Google Calendar

- Calendar code and configuration are enabled and production is healthy.
- Google credentials, callback, result URL, webhook URL, and encryption
  configuration are structurally present.
- The real Google account is not connected and no Calendar rows are claimed.
- Arc's saved Socos session expired.
- The `socos-production-login` Keychain credential is stale and returns
  `Invalid credentials`.
- The repository has no password reset or recovery route. The next step requires
  either a user-supplied valid login or a separately reviewed cloud-only password
  rotation procedure, followed by user-confirmed Google read-only OAuth consent.

### Documentation

- This document is the current transfer artifact.
- It should be updated again after Calendar, Pixel, events, briefs, and the live
  Discord reply are proven.

## Remaining Work

### P0: Finish Personal Activation

For every remaining flag stage: take fresh backup evidence, update both
production and preview copies, deploy the exact reviewed SHA, require health and
stage-local smoke, and restore the prior flag plus redeploy on failure.

1. Obtain a valid Socos owner login from Yev, or design and independently review
   a cloud-only password rotation procedure before using it. The repository has
   no reset/recovery endpoint. Update the protected credential store without
   printing the password; never improvise a raw production DB edit.
2. Sign in to `/dashboard/integrations`, click Google Calendar Connect, stop
   immediately before the Google permission grant, obtain action-time
   confirmation, then grant read-only access and select calendars.
3. Verify only aggregate Calendar connection/source/watch/sync state and the
   user-visible connected status. On integrity failure, disable Calendar in
   both profiles, deploy the same SHA, stop active Google channels, and verify
   scheduler quietness.
4. Take a fresh backup, enable `LOCATION_INGEST_ENABLED` in both profiles,
   deploy the same exact SHA, and require health. Create the Pixel device only
   while Yev can consume the one-time credentials.
5. On the Pixel, install/configure OwnTracks HTTP mode, enter the one-time
   credentials, grant precise and background location, remove battery
   restrictions, and verify aggregate device/sample/last-seen state.
6. Re-certify one current public Dubai ICS source. Candidate feeds:
   - `https://www.meetup.com/dubai-ai/events/ical/`
   - `https://www.meetup.com/dubai-ai-meetup/events/ical/`
   - `https://www.meetup.com/startups-and-tech-events-in-dubai/events/ical/`
7. Set both profiles of `EVENT_SOURCE_ALLOWED_HOSTS=www.meetup.com`, enable both
   profiles of `EVENT_DISCOVERY_ENABLED`, deploy and smoke the same exact SHA,
   add one source through the UI, and verify aggregate source/poll/event state
   plus visible ranking/conflict behavior.
8. After a fresh stage backup, enable both profiles of `EVENT_BRIEF_ENABLED`
   last, deploy and smoke the same exact SHA, and verify the next new brief is
   V1.1 with no more than three event items. Never rewrite existing V1 batches.
9. Trigger or wait for a skill-generated Hermes brief, then have Yev send one
   controlled unedited `socos ...` Discord reply. Verify one feedback or exact
   evidence CRM mutation occurred exactly once. Replay the exact immutable plan
   or tool input and verify no second mutation. Do not test outbound execution.

### P1: Operational Hardening

- Replace `scripts/coolify.sh` secret-bearing argv behavior with a fail-closed
  activation command using stdin or protected files.
- Permit only known flags, update both profiles consistently, enforce dependency
  order, require backup evidence, deploy an exact SHA, and restore the prior
  flag automatically on failure.
- Add a real disposable cloud restore check before future schema/data releases.
- Add a durable interaction receipt with exact recorded interaction,
  last-contact update, XP delta, and `Recorded only; nothing sent`.
- Improve compact Calendar scope summaries and mobile destructive-control cues
  based on repeated Betabot feedback.

### P2: Relationship Memory And Social Planning

- Add memory extraction with confidence, provenance, corrections,
  deduplication, export, deletion, and merge-approval UX.
- Build weekly planning/reflection, celebrations, gifts, group plans, social
  adventures, and better cadence management.
- Improve proactive introduction ranking after enough graph evidence exists.
- Package first-class Codex and Claude plugins around the authenticated MCP
  surface.
- Add provider executors only behind exact payload review, durable outbox,
  replay protection, audit, and explicit approval.

### P3: Gamification And Generalization

- Tune anti-grind rules, accountability, meaningful rewards, campaigns, and
  variable reinforcement from actual personal usage.
- Generalize onboarding, tenancy, configuration, and public documentation only
  after the personal workflow is dependable.
- Refresh the root README where stack/version and feature claims are stale.

## Important Files

- `AGENTS.md`: repository and Mem0 rules.
- `docs/ai-handoff-2026-07-17.md`: this authoritative handoff.
- `docs/runbooks/calendar-location-operations.md`: activation and rollback.
- `docs/runbooks/database-backup-restore.md`: backup/restore evidence.
- `docs/integrations/hermes-social-loop.md`: Hermes reply loop.
- `docs/integrations/hermes-mcp.md`: authenticated Hermes MCP client.
- `integrations/hermes/skills/socos-social-loop/SKILL.md`: tracked live skill.
- `.superpowers/sdd/integrations-task-2-fix-report.md`: UI hardening evidence.
- `.superpowers/sdd/hermes-social-loop-report.md`: Hermes implementation.
- `.betabots/runs/20260717-073101-integrations-activation-prep/`: ignored
  activation cohort evidence.

## Continuation Prompt

Give the following prompt to another AI:

```text
Continue Socos end to end in /Users/mac/Desktop/projects/personal/socos on the
existing main branch. This is an active personal-first CRM, not a new project.

Read first:
1. AGENTS.md
2. docs/ai-handoff-2026-07-17.md
3. docs/runbooks/calendar-location-operations.md
4. docs/runbooks/database-backup-restore.md
5. docs/integrations/hermes-social-loop.md
6. integrations/hermes/skills/socos-social-loop/SKILL.md

Then inspect git status, local/origin HEAD, production application/deployment
SHA, feature flags, Hermes gateway/cron state, and the final Betabot verifier.
Trust current evidence over any stale snapshot. Do not reset, clean, stash,
rewrite history, switch branches, or discard existing/user changes.

The reviewed application SHA is
1b25328de683e5b7923d4219d0401a1f93f168b2. It is deployed and healthy at
https://socos.rachkovan.com. The exact disabled-first deployment is
jstocddvahtq2ptk159krd6e; the Calendar activation deployment is
y113fr76fqqod7wq8uatmgzx. Fresh backup mnqo384k8e83wtmxl0a7x7lq succeeded with
positive size. Do not claim restore proof.

All 106 real Monica contacts plus 7 isolated demos are cloud-only. Calendar code
is currently enabled; location, event discovery, and event briefs are false in
both profiles. The real Google account is not connected. Arc's Socos session
expired and the protected socos-production-login Keychain value is stale. Do
not print it. The repository has no password reset/recovery route. Require a
user-supplied valid login or first design and independently review a cloud-only
password rotation procedure; never improvise a raw production DB edit.

Calendar is the current activation checkpoint. Sign in, prepare the Google
read-only OAuth flow, and stop immediately before granting persistent Google
access for action-time confirmation. After consent, select calendars and verify
only aggregate connection/source/watch/sync state plus the visible UI.

For every stage below, take fresh backup evidence, update both environment
profiles, deploy the exact reviewed SHA, require health/stage smoke, and restore
the prior flag plus redeploy on failure. Activate one dependency at a time:
1. Pixel OwnTracks location. Yev must enter the one-time credentials on his
   Pixel and grant precise/background/battery permissions.
2. One re-certified public Dubai Meetup ICS source with www.meetup.com
   allowlisted.
3. Event briefs last, verified only on a newly created V1.1 batch.

The tracked Hermes socos-social-loop skill is installed and attached to active
cron 59db0ea1d9d8 at 09:00 Asia/Dubai. The launchd gateway is supervised and the
latest cron run is ok, but it predates skill attachment. After a post-attachment
skill-generated brief, ask Yev for one controlled unedited socos feedback reply,
verify exactly one authenticated CRM mutation, replay the exact immutable plan
or tool input, and verify no second mutation. Do not send, introduce, invite,
merge, delete, or execute an outbound proposal.

Final GPT-5.5 activation evidence is in
.betabots/runs/20260717-073101-integrations-activation-prep: real backend
verified, median 85, 5/5 goals, 5/5 evidence, 31 model calls, zero failures,
fallbacks, browser issues, or Critical/Important defects. Synthetic tokens and
Pixel credentials are inert. Preserve failed iterations honestly.

Use Mem0 with user_id="yev" across all agent scopes when personal context is
needed. Keep all real contacts, Calendar data, location history, events, and
private notes only in Coolify PostgreSQL. Use synthetic local fixtures. Never
print or commit credentials, OAuth material, database URLs, exact coordinates,
personal rows, private feeds, Discord targets, or raw Second Brain notes.

Preserve the autonomy contract: automatic read/summarize/log/activity updates
and suggestions are allowed. Outbound messages, introductions, invitations,
merges, and deletions require approval. Approval is not execution. Continue
until activation and the Discord reply proof are genuine, or identify the exact
unavoidable user action without inventing evidence.
```
