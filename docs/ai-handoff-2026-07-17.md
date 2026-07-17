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
`https://socos.rachkovan.com/dashboard/integrations`. Google Calendar code and
production configuration are enabled and healthy, but the real Google account
is not connected. Yev supplied the OAuth client ID and downloaded client JSON;
the ID and secret were verified in memory, stored in macOS Keychain, and the
plaintext download was deleted. No agent accepted Google's User Data Policy.
The final Google account permission grant remains a separate unavoidable
user-confirmed action. Pixel location, event discovery, and event briefs remain
disabled so activation still follows dependency order.

P1 source changes and the agent-safety hardening slice are implemented,
independently reviewed, restore-gated, and deployed. The release includes a
durable interaction receipt, truthful compact integration status/mobile cues,
the cloud-only disposable restore release gate, removal of direct human-JWT CRM
hard-delete routes, scope-aware MCP discovery/metadata, and first-class
read-only Codex and Claude plugin packages. The receipt adds migration 12, so
the dedicated forced-command runner was provisioned with isolated rotating
read/admin/restore roles and audited before deployment. The latest exact
wrapper-level restore gate passed for
`2b696aadb1c91a518eb4a9eda1256f3a1c26d04c`, and Coolify deployment
`n11xjt6f1hpmjnpki9w4uxrj` finished at that same SHA.
Production is healthy with 12 applied migrations, 48 public tables, 106
non-demo contacts, 7 isolated demos, and the migration-12 receipt table.

The tracked Hermes `socos-social-loop` skill is installed and attached to the
active 09:00 Asia/Dubai Discord cron. The gateway is supervised. Today's
successful cron run happened before the skill was attached, so a post-attachment
skill-generated brief and real Discord reply mutation remain unproven.

## Current State

Snapshot taken in `/Users/mac/Desktop/projects/personal/socos`.

| Area | State |
| --- | --- |
| Reviewed application SHA | `2b696aadb1c91a518eb4a9eda1256f3a1c26d04c` |
| Latest reviewed source commit before this handoff | `2b696aadb1c91a518eb4a9eda1256f3a1c26d04c` |
| Reviewed application-code ancestor | `084b7addb0ccc765aa343c5412ed8f5fe5f6da0b` |
| Pre-activation-tooling baseline SHA | `69e6ac0444a50ae92d811155493fcff559774a86` |
| Production application SHA | `2b696aadb1c91a518eb4a9eda1256f3a1c26d04c` |
| Current source branch | `main`; this handoff may be a later documentation-only commit; resolve any future candidate action-time |
| Production status | `running:healthy` |
| Production URL | `https://socos.rachkovan.com` |
| Real contacts | 106 non-demo, cloud-only |
| Demo contacts | 7, isolated where required |
| Calendar code/config | enabled and independently verified; real OAuth connection pending |
| Google OAuth material | verified in Keychain; plaintext client JSON deleted |
| Owner access | recovered; HTTPS login and guarded route verified |
| Pixel location | disabled |
| Event discovery | disabled |
| Event briefs | disabled |
| Hermes | installed, gateway supervised, cron active |
| Live Discord reply proof | pending |
| P1 source hardening | implemented, independently reviewed, restore-gated, deployed |
| Agent/plugin safety | implemented, independently reviewed, deployed |
| Cloud restore gate | dedicated runner provisioned and audited; exact live wrapper receipt passed |

This handoff itself may be a later documentation-only commit than the reviewed
production SHA. Re-run `git status`, `git log -1`, and `git ls-remote`
before changing or deploying anything.

Recommended restart order:

1. Verify the worktree and exact local, remote, and production SHAs.
2. Treat the live restore gate as required for every later schema deployment;
   do not reuse the prior receipt for a different SHA.
3. Resume Google, Pixel, events, briefs, and the controlled Discord proof only
   at their documented user-action gates.
4. Build relationship memory and weekly social planning as separate bounded
   slices after the safety and release gates are sound.

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
  triggers the current Coolify backup configuration with exact PATCH JSON,
  requires one fresh successful canonical positive-size execution, verifies
  equal production/preview records, enforces dependency order, performs one
  paired bulk update, deploys, and checks fixed health/auth/status smokes.
- Post-deploy readiness retries are bounded and limited to transport failures
  and HTTP 502/503/504; semantic contract failures stop immediately. Rollback
  verification uses the same bounded readiness behavior.
- Literal environment parsing conservatively unwraps only an exact
  single-quoted wrapper around the same literal `value`; secret `real_value`
  strings remain authoritative when the public value is masked.
- Any failure after a mutation attempt restores every managed value from the
  in-memory snapshot, verifies the restore, redeploys the same commit, and
  smoke-checks the prior feature state. Receipts are fixed and redacted.
- Disabled legacy secret-bearing `scripts/coolify.sh add-env`; its bearer header
  and deploy payload also no longer place secrets or JSON bodies in argv.
- Migrated the live `qed` Coolify token to Keychain account `socos`, service
  `coolify-cli-qed-token`, verified it, and removed its field from the local
  Coolify config. The `qed` instance entry now retains only non-secret metadata;
  the config is mode `0600`.
- Independent review approved the boundary after test-first correction and the
  current-Coolify compatibility pass. Focused activation/ops/wrapper tests pass
  42/42; syntax, diff checks, and the security scan pass.
- Calendar activation created fresh backup `ug28hprq8vx6lflzykdw8dx3`, deployed
  exact commit `2b696aadb1c91a518eb4a9eda1256f3a1c26d04c` as deployment
  `n11xjt6f1hpmjnpki9w4uxrj`, and returned health 200, Calendar guard 401,
  disabled OwnTracks 503, and enabled Calendar webhook 404. An independent
  read-only verification confirmed healthy status, exact SHA, equal
  production/preview pairs, Keychain credential matches, Calendar true, and
  location/discovery/brief false.

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

### Interaction Receipt And Release Gate

- Added one owner-scoped `InteractionReceipt` per interaction in migration 12.
  The receipt is written atomically with the interaction, chronology update,
  XP, and achievements; it preserves exact recorded fields, before/after last
  contact, distinct XP deltas, total/level snapshots, and the fixed outcome
  `Recorded only; nothing sent`.
- Both human interaction POST routes now require a valid `Idempotency-Key`.
  REST and agent/MCP creation return the same receipt envelope, durable GET is
  owner-scoped, replay suppresses duplicate rewards, and deletion cascades.
- Contacts shows the exact focused receipt and safely retries a committed but
  lost response with the identical body/key. Today keeps the interaction and
  quest XP separate, exposes exact notes only inside the contact-scoped retry
  dialog, and uses a redacted non-live compact receipt after success.
- Integrations now has a sticky truthful Calendar access/source summary. It
  accepts only the exact two read-only scopes, independent of order, and rejects
  duplicates, missing, extra, or broad/write scopes. Destructive/action cues
  remain visibly labeled on mobile with 44-pixel targets.
- Added `scripts/cloud-restore-release-gate.mjs` and its fixed local SSH wrapper.
  The gate binds to the exact trusted `origin/main`, requires a fresh Coolify
  backup plus an independent consistent cloud dump, validates cluster identity
  and three isolated roles, restores to a disposable restricted database, runs
  candidate migrations/Prisma/drift/count invariants, and verifies cleanup.
- Database URLs no longer appear in argv in backup, schema comparison, or count
  verification. Child/SSH/HTTP/cleanup work is deadline-bounded with process
  group termination, repeated-signal handling, and continued cleanup after a
  hung phase. Receipts and failures are fixed and redacted.
- Independent CRM and restore-gate reviews returned `APPROVE` after all
  Important findings were corrected. The exact live gate and deployment are
  recorded below; validation used only fixed receipts and aggregate evidence.

### Release Baseline: Completed

- The restricted `socos-release-gate` account, forced launcher, trusted mirror,
  rotating isolated PostgreSQL roles, private work/lock paths, and exact cleanup
  proofs are live. Preserve this boundary and rerun provisioning after any
  interrupted credential rotation.
- Migration 12 and the reviewed P1 source are deployed. The current exact gated
  production SHA is `2b696aadb1c91a518eb4a9eda1256f3a1c26d04c`.
- Every later schema candidate still requires its own exact-SHA live receipt,
  exact deployment, and aggregate smoke; the current receipt is not reusable.

### Agent And MCP Surface

- Exactly 11 authenticated owner-scoped MCP tools cover briefs, contacts,
  relationship health, important dates, reminders, interactions, feedback,
  quests, proposals, and approved execution boundaries.
- Hermes, Codex, and Claude clients were validated for scoped reads and denial
  behavior.
- Provider executors are intentionally absent. Approved outbound actions return
  `ACTION_EXECUTION_UNAVAILABLE` instead of pretending to execute.
- Direct human-JWT DELETE routes for contacts, interactions, and reminders are
  removed. The underlying service methods remain available for future approved
  executor work, but no direct REST hard-delete route bypasses approval.
- MCP `tools/list` is scope-aware for the authenticated principal. Hidden tool
  calls are rejected as tool-not-found before registry dispatch. Only
  `socos_execute_approved_action` advertises destructive metadata.
- The default Hermes scope profile omits `approvals:execute`.
- Read-only Codex and Claude plugin packages are tracked at
  `integrations/codex/plugins/socos` and `integrations/claude/socos`, with
  repo-local marketplace manifests and environment-backed token references.

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
Web Vitest: 78/78
Focused interaction API Jest: 4 suites, 40/40
Hermes planner: 14/14
Integrations production Chromium: 15/15
Focus stress: 45/45 + 30/30 + 15/15
Contacts + Daily Cockpit + Integrations Chromium: 38/38
API Jest focused change coverage: 4 suites, 40/40
Workspace typechecks: 5/5
Workspace builds: 4/4; Next generated 16 pages
Lint: 0 errors; pre-existing warnings only
Infrastructure/security: 166 passed, 1 expected skip
Security scanner: 579 tracked files
PostgreSQL migration safety: 10/10
Database operations: 36/36
Restore/provision/database focused suite: 91/91
Calendar/location PostgreSQL integration: passed
Human-idempotency PostgreSQL integration: passed
Agent-interface PostgreSQL integration: 6/6
Independent Integrations review: APPROVE
Independent Hermes review: APPROVE
Activation/ops/wrapper tests: 42/42
Independent activation-tooling review: APPROVE
Independent interaction/integration review: APPROVE
Independent cloud restore-gate review: APPROVE
CRM delete/MCP/plugin safety Jest: 6 suites, 36/36
Agent plugin packaging: 8/8
Codex plugin validator: passed
Claude plugin validator: passed
Plugin skill quick validation: 2/2
API typecheck: passed
API lint: 0 errors; pre-existing warnings only
Agent/plugin security scanner: 594 tracked files
Independent safety/plugin review: APPROVE
```

Current-source verification also passed API and web typechecks, API and web
production builds, Prisma validation with a synthetic URL, focused Contacts /
Today / Integrations Playwright flows, and diff checks. Web lint has 0 errors
and 37 existing warnings; API lint has 0 errors and existing warnings. The
focused API run emitted the existing Jest worker-teardown warning after all 40
tests passed.

The latest broad `pnpm test` rerun reached 94 passing API suites, 1 skipped
suite, and 1,040 passing tests before two cases in `auth.service.spec.ts` failed
from their five-second timeout under the six-minute parallel load. The exact
auth spec then passed 3/3 with `--runInBand`. Because Turbo stopped on that API
failure, the registered root operations/security segment was verified
separately with 166 passing tests, 1 intentional skip, and the 579-file security
scan passing. Do not describe the latest broad command itself as green.

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
Reviewed/deployed SHA: 2b696aadb1c91a518eb4a9eda1256f3a1c26d04c
Current deployment: n11xjt6f1hpmjnpki9w4uxrj
Live restore-gate backup: f6i8nb4aua7510m8iihgbta5
Live restore-gate backup size: 178612 bytes
Live restore-gate dump SHA-256: 55fc5fa4913e22d92f15ff5c772ca2f87a89ad67c533bf55d93252887ae2951e
Live restore-gate aggregate tables: 48
Live restore-gate result: passed; schema statements 0; counts preserved; cleanup verified
Post-deploy migrations: 12
Post-deploy public tables: 48
Disabled-first deployment: jstocddvahtq2ptk159krd6e
Calendar activation deployment: n11xjt6f1hpmjnpki9w4uxrj
Calendar activation backup: ug28hprq8vx6lflzykdw8dx3
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

Current production smoke passed:

```text
GET  /                                      200
GET  /dashboard/integrations                200
GET  /api/health-check                      200
GET  authenticated CRM/integration routes  401
POST /api/mcp                               401
POST /api/location/owntracks                503
POST destructive admin routes              404
Contact aggregates                         106 non-demo / 7 demo
Application containers                     2 running / 2 healthy
```

The dedicated runner restored an independent dump into a disposable database,
applied the exact candidate migrations, validated Prisma, proved zero drift and
preserved aggregates, dropped the disposable database, removed all worktrees,
and returned a wrapper-accepted exit-0 receipt. This is live restore proof only
for the exact SHA above; later schema candidates require a new receipt.

## In Progress

### Google Calendar

- Calendar code and configuration are enabled and production is healthy.
- A dedicated personal Google Cloud project named `Socos Personal CRM` with ID
  `socos-personal-crm` was created under Yev's personal Google account.
- Google Calendar API is enabled in that project.
- Yev supplied the OAuth client. Its ID and secret are stored in Keychain and
  match both Coolify profiles; the downloaded plaintext JSON was deleted. No
  agent accepted Google's API Services User Data Policy.
- The exact production callback is
  `https://socos.rachkovan.com/api/integrations/google-calendar/callback`.
- Socos requests exactly `calendar.calendarlist.readonly` and
  `calendar.events.readonly`, with no identity, profile, or write scope.
- The first live callback failed because Google returned documented `scope`,
  `authuser`, and `prompt` metadata while Socos accepted exactly two query keys.
  Production evidence showed the attempt was never consumed. The fail-closed
  parser now accepts only documented scalar metadata, discards it before state
  validation, and still rejects unknown, duplicate, owner, and redirect input.
  Calendar tests pass 96/96 and independent review approved the fix.
- A fresh retry window was opened after deployment, but no callback arrived
  during the monitoring window. The real Google account is not yet connected;
  no partial connection row or consumed attempt is claimed.

### Documentation

- This document is the current transfer artifact.
- `docs/plans/2026-07-18-event-catalog-design.md` records the approved
  searchable catalog/follow architecture, seed-source assessment, safety rules,
  delivery slices, and acceptance criteria. Implementation has not started.
- It should be updated again after Calendar, Pixel, events, briefs, and the live
  Discord reply are proven.

## Known Gaps And Audit Findings

These are source-audit findings, not claims that the corresponding features are
already delivered.

- Approved deletion executors still do not exist. If one is introduced later,
  make interaction deletion transactional with any XP adjustment before enabling
  it.
- Socos has no durable relationship-fact ledger. Contact bio, first-met data,
  dates, methods, reminders, raw interactions, and import provenance exist, but
  confidence, per-fact provenance, review state, correction lineage,
  person-level deduplication, relationship export, and durable memory deletion
  do not.
- The Monica import brought in 106 directory contacts with source provenance;
  it did not import complete Monica notes, interactions, methods, dates,
  reminders, relationships, or history. Do not describe it as a full Monica
  history migration.
- Monica reruns can overwrite corrected imported scalar fields. Current contact
  edits replace methods and scalar values without durable prior-value history.
- Important dates, daily focus ranking, reminders, cadence inputs, quests, XP,
  and the Today workflow are active. Weekly planning/reflection, group plans,
  and social-adventure workflows do not exist.
- Celebration recurrence and attachment services exist in the API and feed the
  daily brief, but the modern dashboard has no usable celebration-management
  workspace. `Gift`, `Activity`, and `Task` are dormant schema surfaces rather
  than shipped workflows.
- The modern web reads streak state but does not call the existing streak
  check-in mutation. Achievements lack a first-class modern view.
- Hermes has not yet proven a post-skill-attachment brief followed by one real,
  idempotent Discord reply mutation.

## Remaining Work

### P0: Finish Personal Activation

For every remaining flag stage: take fresh backup evidence, update both
production and preview copies, deploy the exact reviewed SHA, require health and
stage-local smoke, and restore the prior flag plus redeploy on failure.

1. Sign in to `/dashboard/integrations`, click Google Calendar Connect, stop
   immediately before the Google account permission grant, obtain separate
   action-time confirmation, then grant read-only access and select calendars.
2. Verify only aggregate Calendar connection/source/watch/sync state and the
   user-visible connected status. On integrity failure, disable Calendar in
   both profiles, deploy the same SHA, stop active Google channels, and verify
   scheduler quietness.
3. Take a fresh backup, enable `LOCATION_INGEST_ENABLED` in both profiles,
   deploy the same exact SHA, and require health. Create the Pixel device only
   while Yev can consume the one-time credentials.
4. On the Pixel, install/configure OwnTracks HTTP mode, enter the one-time
   credentials, grant precise and background location, remove battery
   restrictions, and verify aggregate device/sample/last-seen state.
5. Re-certify one current public Dubai ICS source. Candidate feeds:
   - `https://www.meetup.com/dubai-ai/events/ical/`
   - `https://www.meetup.com/dubai-ai-meetup/events/ical/`
   - `https://www.meetup.com/startups-and-tech-events-in-dubai/events/ical/`
6. Set both profiles of `EVENT_SOURCE_ALLOWED_HOSTS=www.meetup.com`, enable both
   profiles of `EVENT_DISCOVERY_ENABLED`, deploy and smoke the same exact SHA,
   add one source through the UI, and verify aggregate source/poll/event state
   plus visible ranking/conflict behavior.
7. After a fresh stage backup, enable both profiles of `EVENT_BRIEF_ENABLED`
   last, deploy and smoke the same exact SHA, and verify the next new brief is
   V1.1 with no more than three event items. Never rewrite existing V1 batches.
8. Trigger or wait for a skill-generated Hermes brief, then have Yev send one
   controlled unedited `socos ...` Discord reply. Verify one feedback or exact
   evidence CRM mutation occurred exactly once. Replay the exact immutable plan
   or tool input and verify no second mutation. Do not test outbound execution.

### P1: Relationship Memory And Social Planning

- First add an append-only owner-scoped relationship-memory ledger with
  confidence, provenance, canonical deduplication, review state, idempotent
  capture, correction/rejection lineage, REST/MCP access, and contact-profile
  UX. Keep raw values out of mutation audit metadata. Defer LLM extraction,
  export, and merge execution until this substrate is verified.
- Then add extraction, relationship-data export/deletion, duplicate-candidate
  review, and merge-approval UX. Prevent Monica reruns from overwriting newer
  user corrections.
- Build a bounded weekly social-commitments workflow with 1-3 plans, multiple
  participants, celebration/group/adventure kinds, rescheduling, completion or
  skip, short reflection, no outbound side effects, and exactly-once XP only
  for verified completion.
- Follow with modern celebration and gift management, bulk/learned cadence,
  achievements, and a values-first accountability loop. Do not count dormant
  legacy schema models as delivered product.
- Improve proactive introduction ranking after enough graph evidence exists.
- Add provider executors only behind exact payload review, durable outbox,
  replay protection, audit, and explicit approval.

### P2: Gamification And Generalization

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
- `scripts/run-cloud-restore-release-gate.mjs`: fixed local SSH client.
- `scripts/cloud-restore-release-gate.mjs`: forced cloud restore command.
- `docs/integrations/hermes-social-loop.md`: Hermes reply loop.
- `docs/integrations/hermes-mcp.md`: authenticated Hermes MCP client.
- `docs/integrations/codex-mcp.md`: read-only Codex plugin and MCP setup.
- `docs/integrations/claude-mcp.md`: read-only Claude plugin and MCP setup.
- `scripts/validate-agent-plugin-packaging.mjs`: plugin/package validator.
- `integrations/hermes/skills/socos-social-loop/SKILL.md`: tracked live skill.
- `integrations/codex/plugins/socos/`: tracked read-only Codex plugin.
- `integrations/claude/socos/`: tracked read-only Claude Code plugin.
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
7. scripts/run-cloud-restore-release-gate.mjs
8. scripts/cloud-restore-release-gate.mjs
9. docs/integrations/hermes-social-loop.md
10. integrations/hermes/skills/socos-social-loop/SKILL.md

Then inspect git status, local/origin HEAD, production application/deployment
SHA, feature flags, Hermes gateway/cron state, and the final Betabot verifier.
Trust current evidence over any stale snapshot. Do not reset, clean, stash,
rewrite history, switch branches, or discard existing/user changes.

Production is deployed and healthy at exact reviewed SHA
2b696aadb1c91a518eb4a9eda1256f3a1c26d04c through Coolify deployment
n11xjt6f1hpmjnpki9w4uxrj. The dedicated forced-command runner returned an exit-0
live restore receipt for that exact SHA: fresh backup
f6i8nb4aua7510m8iihgbta5, 48 aggregate tables, zero schema drift, preserved
migration counts, and verified cleanup. The activation then created backup
ug28hprq8vx6lflzykdw8dx3. Independent read-only verification confirmed the
healthy exact deployment, equal environment pairs, Calendar credentials matching
Keychain, Calendar enabled, and location/discovery/brief disabled. Public smokes
are health 200, Calendar guard 401, disabled OwnTracks 503, and enabled Calendar
webhook 404 with its exact fixed code.

Do not redeploy merely because this handoff adds a documentation-only commit.
For the next schema change, resolve the new action-time trusted origin/main,
reprovision if required, run scripts/run-cloud-restore-release-gate.mjs for that
exact SHA, require a wrapper-accepted success receipt, and deploy only the same
SHA. Never reuse the current receipt for a different candidate.

Do not add a merge/delete executor in the next slice. If an approved deletion
executor is introduced later, make interaction deletion transactional with any
XP adjustment before enabling it. Never commit a token.

The prior disabled-first and Calendar deployments remain historical rollback
context, not the current release. Trust the exact current gate/deployment facts
above and re-read Coolify before any later mutation.

All 106 real Monica contacts plus 7 isolated demos are cloud-only. Calendar code
is currently enabled; location, event discovery, and event briefs are false in
both profiles. Owner access was recovered through an independently reviewed,
guarded cloud-only rotation after successful backup
z7fzdte9nlv0b5v06bepzon8. HTTPS login and a guarded route were verified from the
primary socos-production-login Keychain item. Never print it. Password rotation
did not revoke existing stateless JWTs.

Calendar is the current activation checkpoint. Yev supplied the OAuth client;
its ID and secret were verified in memory, stored in Keychain, activated in both
Coolify profiles, and independently matched without printing values. The
plaintext downloaded client JSON was deleted. No agent accepted Google's User
Data Policy. Calendar production configuration is enabled, but the real Google
account is not connected. Sign in to the Integrations workspace and stop
immediately before the Google account permission grant for separate action-time
confirmation. After that grant, select calendars and verify only aggregate
connection/source/watch/sync state plus the visible UI.

Use the checked-in staged activation wrapper for every feature transition. The
Coolify token is in macOS Keychain account `socos`, service
`coolify-cli-qed-token`; the `qed` config is tokenless and supplies only its
HTTPS endpoint. Calendar credentials must use account `socos` and services
`socos-google-calendar-client-id` and `socos-google-calendar-client-secret`.
Populate them only with the runbook's non-echoing prompts. Never pass a value
after `-w`. The wrapper accepts no secret arguments. It pins the exact commit,
disables auto deploy, proves a fresh positive-size backup, updates the exact
production/preview pair, enforces dependencies, deploys, smoke-checks, and
automatically restores the prior in-memory snapshot on failure. It uses the
current Coolify PATCH backup trigger, handles the observed mixed literal value
shape conservatively, and its focused tests pass 42/42 with independent review
approval. The Calendar activation and independent
read-only verification succeeded at the exact production SHA above.

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
unavoidable user action without inventing evidence. After the operational gates,
implement relationship memory and weekly social commitments as separate slices;
their detailed done/gap definitions are in this handoff.
```
