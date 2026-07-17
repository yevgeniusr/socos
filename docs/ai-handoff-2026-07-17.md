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
enabled and healthy, but the real Google account is not connected. Owner access
was recovered with a reviewed cloud-only password rotation and verified through
both login and an authenticated route; the current credential is in the macOS
Keychain. A dedicated personal Google Cloud project now exists and its Calendar
API is enabled. OAuth consent setup is paused at Google's required User Data
Policy agreement, which Yev must explicitly accept before an agent can continue.
The final Google account grant is a second unavoidable user-confirmed action.
Pixel location, event discovery, and event briefs remain disabled so activation
still follows dependency order.

The tracked Hermes `socos-social-loop` skill is installed and attached to the
active 09:00 Asia/Dubai Discord cron. The gateway is supervised. Today's
successful cron run happened before the skill was attached, so a post-attachment
skill-generated brief and real Discord reply mutation remain unproven.

## Current State

Snapshot taken in `/Users/mac/Desktop/projects/personal/socos`.

| Area | State |
| --- | --- |
| Reviewed application SHA | `1b25328de683e5b7923d4219d0401a1f93f168b2` |
| Pre-activation-tooling baseline SHA | `69e6ac0444a50ae92d811155493fcff559774a86` |
| Production application SHA | same reviewed SHA |
| Production status | `running:healthy` |
| Production URL | `https://socos.rachkovan.com` |
| Real contacts | 106 non-demo, cloud-only |
| Demo contacts | 7, isolated where required |
| Calendar code | enabled; real OAuth connection pending |
| Google Cloud | dedicated project created; Calendar API enabled; consent setup awaiting policy acceptance |
| Owner access | recovered; HTTPS login and guarded route verified |
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

### Production Activation Operations

- Added `scripts/coolify-activate.mjs`, a fail-closed staged activation client
  for Calendar, Pixel location, event discovery, and event briefs.
- Added `scripts/run-coolify-activation.mjs`, which accepts only a stage, exact
  40-character commit, and optional certified public event hostname. It reads
  the Coolify token and Calendar credentials from exact macOS Keychain
  account/service pairs and sends secrets only through child stdin/environment.
- The client pins `main` to the exact commit, disables automatic deploys,
  requires one fresh successful positive-size backup, verifies equal
  production/preview records, enforces dependency order, performs one paired
  bulk update, deploys, and checks fixed health/auth/status smokes.
- Any failure after a mutation attempt restores every managed value from the
  in-memory snapshot, verifies the restore, redeploys the same commit, and
  smoke-checks the prior feature state. Receipts are fixed and redacted.
- Disabled legacy secret-bearing `scripts/coolify.sh add-env`; its bearer header
  and deploy payload also no longer place secrets or JSON bodies in argv.
- Migrated the live `qed` Coolify token to Keychain account `socos`, service
  `coolify-cli-qed-token`, verified it, and removed its field from the local
  Coolify config. The `qed` instance entry now retains only non-secret metadata;
  the config is mode `0600`.
- Independent review approved the boundary after two test-first correction
  rounds. Focused activation/ops/wrapper tests pass 31/31; syntax, executable
  mode, and diff checks pass. No production feature value was changed by this
  tooling work.

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
Activation/ops/wrapper tests: 31/31
Independent activation-tooling review: APPROVE
```

The latest broad `pnpm test` rerun reached 93 passing API suites, 1 skipped
suite, and 1,034 passing tests before two cases in
`agent-auth.controller.spec.ts` failed from a five-second load timeout and the
subsequent connection reset. That controller and these operations scripts do
not overlap. The exact controller spec then passed 8/8 with `--runInBand`.
Because Turbo stopped on that API failure, the root script/security segment was
verified separately with 145 passing tests, 1 intentional skip, and the
567-file security scan passing. Do not describe the latest broad command itself
as green.

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
Calendar activation backup: mnqo384k8e83wtmxl0a7x7lq
Calendar activation backup status: success
Calendar activation backup size: 173186 bytes
Owner-recovery backup: z7fzdte9nlv0b5v06bepzon8
Owner-recovery backup status: success
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
- A dedicated personal Google Cloud project named `Socos Personal CRM` with ID
  `socos-personal-crm` was created under Yev's personal Google account.
- Google Calendar API is enabled in that project.
- The OAuth application name, external audience, support email, and developer
  contact were entered. Configuration is paused before accepting Google's API
  Services User Data Policy; no agent accepted that legal agreement.
- The exact production callback is
  `https://socos.rachkovan.com/api/integrations/google-calendar/callback`.
- Socos requests exactly `calendar.calendarlist.readonly` and
  `calendar.events.readonly`, with no identity, profile, or write scope.
- Production client ID and secret are still placeholders. No OAuth credential
  has been created or copied into Coolify yet.
- The real Google account is not connected and no Calendar rows are claimed.

### Owner Access Recovery

- A fresh backup execution `z7fzdte9nlv0b5v06bepzon8` succeeded before the
  credential change.
- An independent reviewer approved a guarded rotation procedure.
- A random temporary password stayed only in macOS Keychain. A cost-10 bcrypt
  hash was applied in an explicit transaction that required the exact owner and
  exactly 106 non-demo contacts, locked and updated exactly one user row, and
  returned only `rotation_result=1`.
- HTTPS verification returned `200` for login and an authenticated route before
  and after promotion to the primary `socos-production-login` Keychain item.
- The temporary Keychain item was deleted and the clipboard cleared.
- Existing stateless JWTs were not revoked by password rotation; they expire on
  their normal schedule.

### Documentation

- This document is the current transfer artifact.
- It should be updated again after Calendar, Pixel, events, briefs, and the live
  Discord reply are proven.

## Remaining Work

### P0: Finish Personal Activation

For every remaining flag stage: take fresh backup evidence, update both
production and preview copies, deploy the exact reviewed SHA, require health and
stage-local smoke, and restore the prior flag plus redeploy on failure.

1. Obtain Yev's explicit `I agree` for the Google API Services User Data Policy,
   then finish the external OAuth consent configuration. Do not infer legal
   acceptance from blanket system access.
2. Configure only the two exact read-only Calendar scopes and add Yev as a test
   user if Google keeps the app in Testing. The repository's intended target is
   External/Production; document any temporary Testing-mode deviation and its
   token-lifetime consequence.
3. Create one confidential Web application OAuth client with the exact callback
   above. Store its ID and secret through the non-echoing Keychain prompts in
   `docs/runbooks/calendar-location-operations.md`; never download JSON, use a
   local plaintext file, put a secret in argv, or print it. Run
   `scripts/run-coolify-activation.mjs calendar-enable <reviewed-40hex-sha>`.
   The tool must prove the fresh backup, equal production/preview credentials,
   exact deployment SHA, health `200`, unauthenticated Calendar `401`, disabled
   OwnTracks `503`, and automatic rollback on failure. Do not start Socos
   Connect before this gate passes.
4. Sign in to `/dashboard/integrations`, click Google Calendar Connect, stop
   immediately before the Google account permission grant, obtain separate
   action-time confirmation, then grant read-only access and select calendars.
5. Verify only aggregate Calendar connection/source/watch/sync state and the
   user-visible connected status. On integrity failure, disable Calendar in
   both profiles, deploy the same SHA, stop active Google channels, and verify
   scheduler quietness.
6. Take a fresh backup, enable `LOCATION_INGEST_ENABLED` in both profiles,
   deploy the same exact SHA, and require health. Create the Pixel device only
   while Yev can consume the one-time credentials.
7. On the Pixel, install/configure OwnTracks HTTP mode, enter the one-time
   credentials, grant precise and background location, remove battery
   restrictions, and verify aggregate device/sample/last-seen state.
8. Re-certify one current public Dubai ICS source. Candidate feeds:
   - `https://www.meetup.com/dubai-ai/events/ical/`
   - `https://www.meetup.com/dubai-ai-meetup/events/ical/`
   - `https://www.meetup.com/startups-and-tech-events-in-dubai/events/ical/`
9. Set both profiles of `EVENT_SOURCE_ALLOWED_HOSTS=www.meetup.com`, enable both
   profiles of `EVENT_DISCOVERY_ENABLED`, deploy and smoke the same exact SHA,
   add one source through the UI, and verify aggregate source/poll/event state
   plus visible ranking/conflict behavior.
10. After a fresh stage backup, enable both profiles of `EVENT_BRIEF_ENABLED`
   last, deploy and smoke the same exact SHA, and verify the next new brief is
   V1.1 with no more than three event items. Never rewrite existing V1 batches.
11. Trigger or wait for a skill-generated Hermes brief, then have Yev send one
   controlled unedited `socos ...` Discord reply. Verify one feedback or exact
   evidence CRM mutation occurred exactly once. Replay the exact immutable plan
   or tool input and verify no second mutation. Do not test outbound execution.

### P1: Operational Hardening

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
4. scripts/run-coolify-activation.mjs
5. scripts/coolify-activate.mjs
6. docs/runbooks/database-backup-restore.md
7. docs/integrations/hermes-social-loop.md
8. integrations/hermes/skills/socos-social-loop/SKILL.md

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
both profiles. Owner access was recovered through an independently reviewed,
guarded cloud-only rotation after successful backup
z7fzdte9nlv0b5v06bepzon8. HTTPS login and a guarded route were verified from the
primary socos-production-login Keychain item. Never print it. Password rotation
did not revoke existing stateless JWTs.

Calendar is the current activation checkpoint. A dedicated personal Google
Cloud project `socos-personal-crm` exists and Google Calendar API is enabled.
OAuth branding/external-audience setup is paused at Google's required API
Services User Data Policy agreement. Obtain Yev's explicit `I agree` before
checking that box; blanket access is not legal consent. Then configure exactly
calendar.calendarlist.readonly and calendar.events.readonly, create a Web
application client with callback
https://socos.rachkovan.com/api/integrations/google-calendar/callback, and move
the client ID/secret directly into both Coolify profiles without printing or
local files. Without outputting the values, require both copies to be equal,
non-empty, and non-placeholder. Take a fresh backup, redeploy the exact reviewed
SHA, and require health 200, unauthenticated Calendar 401, and disabled
OwnTracks 503. On failure, restore both prior copies or disable Calendar in both
profiles, redeploy the same SHA, and verify health. Do not start Socos Connect
until this gate passes. Then stop immediately before the Google account
permission grant for separate action-time confirmation. After that consent,
select calendars and verify only aggregate connection/source/watch/sync state
plus the visible UI.

Use the checked-in staged activation wrapper for every feature transition. The
Coolify token is in macOS Keychain account `socos`, service
`coolify-cli-qed-token`; the `qed` config is tokenless and supplies only its
HTTPS endpoint. Calendar credentials must use account `socos` and services
`socos-google-calendar-client-id` and `socos-google-calendar-client-secret`.
Populate them only with the runbook's non-echoing prompts. Never pass a value
after `-w`. The wrapper accepts no secret arguments. It pins the exact commit,
disables auto deploy, proves a fresh positive-size backup, updates the exact
production/preview pair, enforces dependencies, deploys, smoke-checks, and
automatically restores the prior in-memory snapshot on failure. Its focused
tests pass 31/31 and independent review approved it. No real activation was run
while the Google legal-consent gate remained closed.

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
