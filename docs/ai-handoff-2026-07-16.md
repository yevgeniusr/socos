# Socos AI Handoff - 2026-07-16

This is the source-of-truth handoff for the current personal-first Socos work. It separates implemented backend capability from what is actually usable in the web product, records production evidence without exposing personal rows or credentials, and ends with a continuation prompt for another AI.

## Executive Status

| Area | Status | What that means |
| --- | --- | --- |
| Security, CI, migrations, deployment | Done and deployed | Authentication bypasses and unsafe runtime paths were removed; builds, migrations, backups, and production health were repaired and verified. |
| Monica import | Done and production-verified | 106 non-demo contacts are in Coolify PostgreSQL; 7 demo contacts remain isolated. |
| Daily relationship loop | Backend done; product surface incomplete | Durable briefs, relationship health, important dates, reminders, feedback, quests, and XP exist, but the authenticated web UI does not expose the complete loop. |
| MCP/API agent interface | Read/automatic tools done; outbound execution incomplete | Hermes, Codex, and Claude have authenticated clients; 11 tools, scopes, idempotency, proposals, approvals, and audits exist. Real outbound executors are not implemented. |
| Hermes Discord delivery | Done for brief delivery | A 09:00 Asia/Dubai job was manually production-validated. Continue verifying reply-to-action workflows as the product surface expands. |
| Calendar, Pixel location, events | Code deployed disabled-first | Secure modules, schema, ranking, encryption, deletion, rekeying, tests, and runbooks exist. Google consent, Pixel enrollment, source configuration, and feature enablement are not complete. |
| Public product proof | Partially done and deployed | The public demo and `/sample-workspace` explain the intended workflow. They do not provide real access or prove the authenticated personal workflow. |
| Personal Contacts workspace | Not implemented; highest product priority | The dashboard fetches only 50 contacts and filters locally. More than half of the 106 imported contacts are unreachable in the UI; no useful profile workspace exists. |
| Invite request flow | Not implemented | `Request invite access` ends at an invite-code-only signup screen. |
| Betabots release gate | Partial; not passed | A research-weighted eight-persona directional run produced useful evidence but was stopped for this handoff. It is not real-backend-attested and cannot satisfy the release gate. |

## Repository And Production

- GitHub: `https://github.com/yevgeniusr/socos`
- Local checkout: `/Users/mac/Desktop/projects/personal/socos`
- Branch: `main`
- Current repository commit before this handoff update: `d1c11b6` (`docs: add Socos AI handoff`)
- Current deployed application code: `32db6518336cb427f94938c2ecb8b2493696b2a0`
- Production: `https://socos.rachkovan.com`
- Coolify application UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Deployment recorded for `32db651...`: `ajliakg70dfajcx71hs3jpk6`
- Working tree was clean and `main` matched `origin/main` before this document was edited.

Real personal data belongs only in the Coolify PostgreSQL database. Do not copy contacts, Calendar rows, precise location samples, interaction contents, tokens, or production dumps into the repository or local fixtures.

## Product Direction Recovered From Mem0 And Second Brain

Mem0 was searched across `user_id="yev"` and all agent scopes. The relevant direction is:

- Socos is a personal-first, agent-driven CRM intended to make Yev meaningfully more social with minimal administration.
- The primary loop should help maintain customers, potential cofounders, friends, mentors, and communities while accounting for uneven social energy.
- Suggestions should balance professional networking, hobbies, learning, and social adventures, with Dubai as the current home/location fallback.
- Interests useful for ranking include AI, open source, education, founders, mentoring, events, and digital-nomad/travel context.
- Gamification should use behavior-engineering loops, meaningful accountability, tangible or partly random rewards, and pseudo-random reward cycles. Cosmetic points alone are not sufficient.
- Risk-based autonomy is intentional: read, summarize, log, update activity, and create suggestions automatically; require approval for messages, introductions, invitations, merges, and deletions.
- A later idea is customizable favorite-things/profile widgets. It is not an immediate priority.

The exact personal notes and contact contents are deliberately not reproduced here.

## What Is Done

### 1. Stabilization, Security, And Operations

- Restored reproducible pnpm monorepo CI, lockfile behavior, builds, Docker packaging, and health checks.
- Replaced forgeable/bypass authentication with signed JWT handling and guarded previously unsafe routes.
- Removed destructive runtime schema/database administration paths and reduced notification/debug exposure.
- Removed committed secrets, rotated affected credentials, restricted the production database role, and added security regression scanning.
- Reconciled production migrations with additive, forward-only migration policy.
- Configured Coolify backups, tested recovery, and documented encrypted off-host retention and restore procedures.
- Source of truth: `.superpowers/sdd/progress.md`, `docs/superpowers/plans/2026-07-15-socos-stabilization.md`, and `docs/runbooks/database-backup-restore.md`.

### 2. Monica Import And Data Isolation

- Added contact provenance fields and an idempotent validated Monica import CLI.
- Imported all 106 requested Monica contacts into the production cloud database.
- Preserved non-demo contacts separately from the 7 existing demo contacts.
- Briefs, scoring, agent search, and validation exclude demo data where required.
- Production validation inspected aggregate counts only, not personal rows.
- Source of truth: `docs/superpowers/plans/2026-07-16-monica-cloud-import.md` and `docs/validation/agent-interface-v1.md`.

### 3. Daily Social Brief Backend

- Added durable brief batches and items, relationship-health scoring, timezone-safe important dates, reminders, recommendations, feedback, quests, and evidence-based quest completion.
- Brief generation is idempotent and scheduled; prior V1 briefs remain stable when event suggestions are disabled.
- Event-aware V1.1 brief items are implemented behind a feature flag.
- REST endpoints exist for fetching/generating the daily brief, recording feedback, and completing quests.
- The backend has gamification stats, streaks, XP, and achievements.
- Source of truth: `docs/superpowers/plans/2026-07-16-daily-social-brief.md` and the briefs/gamification modules under `services/api/src/modules/`.

### 4. MCP/API And Risk-Based Autonomy

- Added durable agent clients, hashed credentials, granular scopes, mutation audits, idempotency records, action proposals, approvals, and exact approval validation.
- MCP uses the same service boundary as REST and exposes exactly 11 explicit tools:
  - `socos_brief_today`
  - `socos_contacts_search`
  - `socos_relationship_health`
  - `socos_important_dates`
  - `socos_reminders_list`
  - `socos_log_interaction`
  - `socos_create_reminder`
  - `socos_brief_feedback`
  - `socos_complete_quest`
  - `socos_propose_action`
  - `socos_execute_approved_action`
- Hermes, Codex, and Claude each have a distinct production client/credential and have completed authenticated MCP initialization, tool listing, and brief reads.
- Read-only mutation denial was verified. Risky actions remain approval-gated.
- Important limitation: the approved-action service currently has no registered outbound executors. Approved message, introduction, invitation, merge, and delete attempts return `ACTION_EXECUTION_UNAVAILABLE`. The proposal/approval boundary is real, but the external side effect adapters still need implementation and provider-specific verification.
- Integration guides exist under `docs/integrations/`.
- Source of truth: `docs/superpowers/plans/2026-07-16-agent-interface.md` and `docs/validation/agent-interface-v1.md`.

### 5. Hermes Discord Brief

- Hermes is configured as an HTTP MCP client with its token held outside YAML.
- Hermes job `59db0ea1d9d8` runs at `09:00 Asia/Dubai` and targets the existing Discord channel.
- A manual production run previously completed with `last_status=ok` and no delivery error.
- The agent tools support feedback, interaction logging, reminders, quest completion, proposals, and validation of approved-action requests. Each concrete Discord reply/action path should still be exercised as it is exposed to the user.
- Automatic tools currently implement interaction logging, reminder creation, brief feedback, and quest completion. Proposal creation works; real outbound execution remains unavailable until explicit executors are added.
- Source of truth: `docs/integrations/hermes-mcp.md`, `docs/integrations/hermes-social-brief.md`, and `docs/validation/agent-interface-v1.md`.

### 6. Calendar, Pixel Location, And Event Foundation

- Added application-level AES-256-GCM envelopes and HMAC indexes for sensitive personal context.
- Added secure Google Calendar read-only OAuth, sync, watch renewal, reconciliation, reconnect, and disconnect behavior using minimal Calendar scopes.
- Added OwnTracks-compatible Pixel enrollment, authenticated ingest, encrypted precise coordinates, deduplication, visit derivation, context resolution, retention, and device rotation/revocation.
- Added allowlisted DNS-pinned HTTPS ICS discovery, normalized public events, preferences, ranking, Calendar conflict handling, feedback, and up to three brief suggestions.
- Added personal-context deletion, aggregate-only audit, resumable rekeying, packaging checks, synthetic PostgreSQL integration tests, and operational runbooks.
- Deployed disabled-first with production gates verified as false:
  - `CALENDAR_SYNC_ENABLED=false`
  - `LOCATION_INGEST_ENABLED=false`
  - `EVENT_DISCOVERY_ENABLED=false`
  - `EVENT_BRIEF_ENABLED=false`
- Protected endpoints return `401` without authentication. OwnTracks returns `503` while disabled.
- Source of truth: `.superpowers/sdd/progress.md`, `docs/superpowers/plans/2026-07-16-calendar-location.md`, and `docs/runbooks/calendar-location-operations.md`.

### 7. Public Product Proof

- Fixed `Watch Demo` so it navigates to `/#demo`.
- Added a public proof section showing a daily brief, safety boundary, Monica/Hermes context, and disabled-first Calendar/Pixel context.
- Added `/sample-workspace`, a read-only synthetic workflow showing captured interaction, memory extraction, suggestion ranking, and approval before outbound action.
- Added launch/access and data-control explanations and linked the public/home/signup paths.
- Added web tests/E2E coverage for the public paths and production-smoked the deployed pages.
- Relevant commits: `8d45a4f` and `32db651`.

### 8. Verification Already Recorded

- Production agent-interface release: CI passed lint, typecheck, unit/integration tests, builds, image startup, migration checks, security scans, backup checks, and MCP protocol smoke.
- Calendar/location/event implementation completed all 16 planned tasks with task-level tests and independent reviews; exact details are in `.superpowers/sdd/progress.md`.
- Public workspace changes passed web build, typecheck, tests, `git diff --check`, and production HTTP smoke. Web lint had warnings but no errors.
- The earlier local Playwright invocation hung; public behavior was also checked through production-rendered HTML. Do not treat that as full browser confidence.
- A fresh aggregate-only smoke while preparing this handoff returned: home `200`, sample workspace `200`, signup `200`, health `200`, unauthenticated MCP `401`, and disabled OwnTracks ingest `503`.

## Betabots Status

### Research-Weighted Betabots Wave

- Cohort definition: `.betabots/cohorts/socos-personal-first-wave-1.json`
- Partial run: `.betabots/runs/20260716-213200-post-workspace-research-weighted/`
- The runner was intentionally stopped with exit code `130` while preparing this handoff; no background Betabots process was left running.
- Model: Codex `gpt-5.5`. The desired exact snapshot `gpt-5.5-2026-04-23` was not accepted by the available Codex account, so do not claim exact-snapshot reproducibility.
- Cohort: 8 explicit Yev-weighted personas covering founder networking, low-energy/mobile use, Monica migration, agent safety, AI/education events, serious gamification, important dates, and precise-location trust.
- This wave is directional only: `requireRealBackend=false`, so environment integrity is unverified and the Betabots score is capped. It cannot pass the formal release gate.

Partial evidence already shows:

- `/sample-workspace` materially improves understanding of the core loop and approval boundary.
- The repeated blocking issue is `Request invite access` leading to an invite-code-only signup dead end.
- Personas want small executable actions on each brief item, a visible approval log, Monica migration-integrity proof, and stronger evidence that ranking works beyond synthetic data.
- The sample is promising for event/mentor follow-up and low-friction social action, but it is not proof of the authenticated personal experience.
- A translucent fixed navigation treatment allowed underlying text to show through in one screenshot and needs visual verification/fixing.

Bots 001-005 completed their journeys; 006-007 were interrupted late in their first session and 008 did not start. No final `summary.json` or `analysis.md` exists for this run. Treat it as partial qualitative evidence only. A future run should start fresh after real-backend attestation is available. Never commit `.betabots/` runtime artifacts.

Older runs under `20260716-162300-post-demo-fix` and `20260716-171509-post-workspace` used generic product/persona configuration with no research sources or backend attestation. The initial `20260716-155841` run carried useful researched UI observations but was also partial and unattested. Preserve their qualitative signals, but do not treat any score from those runs as release evidence.

## What Is Left

### P0: Make The Imported Contacts Useful To Yev

This is the highest-priority product work. Do it before optimizing public acquisition.

1. Replace the dashboard's fixed `GET /api/contacts?limit=50` local subset with server-driven pagination, search, labels/tags, and an accurate `showing X of 106` view.
2. Make every contact open a responsive profile workspace/drawer.
3. Extend the contact-detail API response to include safe owner-scoped contact fields and the data the UI needs.
4. Show and edit name, nickname, bio/memory, company/title, importance, cadence, first-met context, birthday, anniversary, labels, tags, groups, social links, and contact methods.
5. Show an interaction timeline and pending reminders; allow logging an interaction and creating/scheduling/completing reminders.
6. Add focused synthetic tests for pagination/query contracts, owner isolation, profile rendering, editing, interactions, and reminders.
7. Keep personal values out of fixtures, screenshots, logs, and commits.

Known code evidence:

- `apps/web/src/app/dashboard/dashboard-client.tsx` fetches `limit=50` and filters only the loaded array.
- `ContactCard` accepts an `onClick` prop but does not wire it to the outer card, and the dashboard passes no profile action.
- `ContactsController` already exposes list/detail/update/delete and per-contact interactions.
- `RemindersController` already exposes create/list/update/complete/delete.
- `ContactsService.findOne` currently includes recent interactions and reminders but not `contactFields`.
- `UpdateContactDto` does not currently expose all first-met/profile fields.
- The Add Contact form submits `email` and `phone`, but `CreateContactDto` accepts neither and global validation forbids unknown fields. Creating a contact with either populated currently returns `400`. Contact methods are stored as `ContactField` relations and need an owner-scoped API/UI contract.

### P0: Put The Daily Loop In The Authenticated Web App

1. Add today's durable Social Brief to the dashboard with people, dates, events, and quests.
2. Add per-item actions: done, snooze, dismiss/not relevant, open contact, create reminder, and propose outbound action.
3. Surface relationship-health reasoning without overwhelming the user.
4. Add a human approval inbox/log for proposed messages, introductions, invitations, merges, and deletions.
5. Expose quest completion, XP, streak, achievements, and weekly reflection in a behaviorally useful way.
6. Verify the UI on desktop and Pixel-sized mobile viewports with Playwright/screenshots and no overlapping content.

### P1: Complete The Personal Integrations

These require explicit account/device action from Yev; an AI cannot truthfully complete them alone.

1. Google Cloud/OAuth: configure the production consent/client, have Yev approve the two read-only Calendar scopes, verify aggregate sync/watch state, then enable Calendar sync.
2. Pixel: enroll OwnTracks Android with HTTPS/Basic auth and precise background location, verify only aggregate sample/device timestamps, then enable ingest.
3. Events: configure at least one operator-certified public ICS host/source and preferences, verify sanitized discovery/ranking, then enable discovery.
4. Briefs: only after the above work, enable event brief items and verify newly generated V1.1 batches while existing V1 batches remain unchanged.
5. Take and verify a fresh backup before production schema/config changes; enable one flag at a time and keep rollback by flag-disable/redeploy.

Google Maps Location Sharing/Timeline is not the implemented ingress. The chosen path is direct OwnTracks-compatible history from the Pixel.

### P1: Close The Invite Dead End

Implement a durable, abuse-resistant invite request rather than changing registration to public access.

Recommended design already audited:

- Public `POST /api/invite-requests` accepting normalized email plus a honeypot field.
- Return the same generic `202` for new, duplicate, honeypot, and notification-failure cases to prevent account enumeration.
- Store a minimal request record with status, request count, first/last request timestamps, notification/review timestamps, optional reviewer, and expiry.
- Add rate limiting and a small body limit at the edge.
- Send a generic no-PII Discord/Hermes notification with an internal review link; notification failure must not roll back the request.
- Add reviewer-only paginated list/status APIs guarded by a fail-closed reviewer allowlist and an internal review UI.
- Keep registration invite-code-only. Add 90-day cleanup and tests for normalization, deduplication, enumeration resistance, rate limit, reviewer authorization, and notifier failure.

### P1: Produce Real-Backend Betabots Evidence

1. Add a production integrity endpoint that actually checks PostgreSQL before returning a fixed safe attestation such as:

   ```json
   {
     "mode": "real",
     "auth": { "mode": "real" },
     "database": { "connected": true, "driver": "postgres", "persistent": true },
     "mocksDetected": false
   }
   ```

2. Return a fixed sanitized `503` on database failure with no exception details.
3. Re-run Betabots with `BETABOT_REQUIRE_REAL_BACKEND=true` and `BETABOT_ENVIRONMENT_ATTESTATION_URL=https://socos.rachkovan.com/api/health/integrity`.
4. Use synthetic test accounts/data and dedicated test surfaces. Do not expose Yev's contacts or location to bots.
5. Run waves of eight, fix repeated/high-severity issues, and preserve unhappy stories.
6. Formal release gate remains: happiness at least 70, no critical defects, at least 90% applicable core-journey completion, and no unresolved high-confidence trust/usability blockers.

### P2: Broader Product Completion

- Proactive introduction ranking and an approval-first introduction workflow visible in web/Discord. The current suggestion agent intentionally returns `INSUFFICIENT_GRAPH_DATA` for warm introductions.
- Provider-specific approved-action executors for messages, introductions, invitations, merges, and deletions, with exact preview binding, idempotency, audit, rollback behavior, and synthetic end-to-end tests.
- More event providers after the certified ICS path proves useful.
- Celebration/adventure planning integrated into the daily loop rather than isolated CRUD.
- Richer contact memory extraction/review with provenance, confidence, correction, export, and deletion controls.
- Weekly campaigns/reflections and the tangible/pseudo-random reward system described in personal notes.
- Import integrity UI showing counts, preserved labels/groups, duplicate decisions, and export/deletion proof.
- Product analytics for brief delivery, response rate, accepted actions, stale-contact reduction, false positives, and weekly retention.
- Public pricing/access strategy only after the personal workflow is demonstrably useful.

## Known Risks And Do-Not-Claim List

- Do not claim all 106 contacts are usable in the web UI yet; only 50 are loaded by the current dashboard.
- Do not claim Google Calendar is connected or syncing; the production flag is false and user consent remains.
- Do not claim Pixel live location is active; phone enrollment and the production flag remain.
- Do not claim event discovery or event brief suggestions are active; both flags remain false.
- Do not claim the Betabots society is satisfied; the formal gate has not run against an attested real backend.
- Do not claim invite requests work; the current CTA ends at an invite-code requirement.
- Do not claim approved outbound actions execute; proposal/approval records exist, but the executor registry is empty.
- Do not treat backend modules as complete user experience. Briefs, approvals, integrations, and much of gamification are not adequately surfaced in the authenticated web app.
- Do not expose or inspect production contact contents, interaction bodies, exact coordinates, OAuth data, tokens, database URLs, invite codes, private keys, or Coolify credentials.

## Operational Rules For The Next AI

- Work directly in `/Users/mac/Desktop/projects/personal/socos`; the user explicitly approved the direct checkout.
- Inspect `git status` before changes and preserve any unrelated user changes.
- Use TDD for behavior changes and sub-agent implementer/reviewer cycles for substantial tasks.
- Use synthetic test data only. Query production aggregates only when validation requires it.
- Keep Coolify PostgreSQL as the sole source of truth for real personal data.
- Use additive, forward-only migrations. Back up before migrations and verify exact deployed SHA afterward.
- Preserve risk-based approval boundaries server-side; UI wording is not an authorization control.
- Do not enable Calendar/location/event flags until credentials, user/device consent, backup, and staged smoke checks are complete.
- Keep `.betabots/` ignored and never commit browser profiles, evidence, or screenshots from runtime runs.
- Update this handoff with exact commits, deployment UUIDs, tests, aggregate evidence, and unresolved work after each production slice.

Documentation caveat: `docs/validation/agent-interface-v1.md` is a valid historical production snapshot at `72ddf7d`, not the current release identity. Older `README.md`, `docs/PRD.md`, `docs/MVP-SPEC.md`, `docs/AI_AGENTS.md`, and `docs/api-contract-phase1.md` contain stale repository, stack, auth, API, or completion claims. Plan checkboxes also remain unchecked after implementation. Use current code, `.superpowers/sdd/progress.md`, the July personal-first design, validation evidence, and this handoff as the authoritative set.

## Useful Commands

```bash
cd /Users/mac/Desktop/projects/personal/socos
git status --short --branch
git log --oneline -12
sed -n '1,260p' .superpowers/sdd/progress.md
```

Core verification:

```bash
pnpm --filter @socos/api type:check
pnpm --filter @socos/api test
pnpm --filter @socos/api build
pnpm --filter @socos/web type:check
pnpm --filter @socos/web test
pnpm --filter @socos/web lint
pnpm --filter @socos/web build
git diff --check
```

Production smoke (do not print response bodies containing private data):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://socos.rachkovan.com/
curl -s -o /dev/null -w '%{http_code}\n' https://socos.rachkovan.com/sample-workspace
curl -s -o /dev/null -w '%{http_code}\n' https://socos.rachkovan.com/auth/signup
curl -s -o /dev/null -w '%{http_code}\n' https://socos.rachkovan.com/api/health-check
curl -s -o /dev/null -w '%{http_code}\n' https://socos.rachkovan.com/api/mcp
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://socos.rachkovan.com/api/location/owntracks -H 'Content-Type: application/json' -d '{}'
```

Expected current statuses are `200`, `200`, `200`, `200`, `401`, and `503` respectively.

Deploy only an exact pushed commit through the existing Coolify script. Read `scripts/coolify.sh` and the runbooks first; retrieve credentials from the existing local Coolify configuration without echoing them.

## Continuation Prompt For Another AI

```text
You are taking over Socos, a personal-first agent-driven CRM, from another Codex session. Work directly in `/Users/mac/Desktop/projects/personal/socos` on `main`. The user has authorized direct work, cloud deployment, and sub-agent-driven implementation, but has asked not to be interrupted for routine decisions.

Read these before changing code:
1. `docs/ai-handoff-2026-07-16.md` (authoritative current handoff)
2. `.superpowers/sdd/progress.md` (completed implementation/review ledger)
3. `docs/validation/agent-interface-v1.md` (production aggregate evidence)
4. `docs/plans/2026-07-15-personal-first-socos-design.md` (product and safety contract)
5. `docs/runbooks/database-backup-restore.md`
6. `docs/runbooks/calendar-location-operations.md`
7. `git status --short --branch` and `git log --oneline -12`

Recover personal product context from Mem0 when needed. Search `user_id="yev"` across `agent_id="all"`; do not restrict to Codex-only memories. If no native Mem0 tool is available, from `/Users/mac/Desktop/projects/claw` run `python3 second-brain/scripts/mem0_query.py profile --top-k 20`. Use relevant conclusions, but never dump raw memories or contact rows into code, logs, tests, or the handoff.

Current deployment:
- Production: `https://socos.rachkovan.com`
- Coolify app UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Current deployed code SHA: `32db6518336cb427f94938c2ecb8b2493696b2a0`
- 106 non-demo Monica contacts and 7 isolated demo contacts are in the Coolify PostgreSQL database.
- Hermes, Codex, and Claude production MCP clients were validated; Hermes daily Discord delivery runs at 09:00 Asia/Dubai.
- The 11-tool MCP boundary supports reads and safe CRM mutations. Proposal/approval infrastructure exists, but actual outbound message/introduction/invitation/merge/delete executors are still unimplemented.
- Calendar, location, event discovery, and event brief flags are all false.

Non-negotiable safety rules:
- Never print or expose tokens, database URLs, private keys, OAuth values, invite codes, Coolify credentials, contact contents, interaction contents, or exact location samples.
- Do not copy production personal rows or dumps locally. Use synthetic fixtures; production validation is aggregate-only.
- Coolify PostgreSQL is the sole source of truth for real data.
- Preserve server-side approval for outbound messages, introductions, invitations, merges, and deletions.
- Use additive forward-only migrations, take/verify a backup before schema changes, deploy an exact pushed SHA, and run production smoke.
- Do not enable Calendar/location/event flags until Yev completes account/device consent and staged verification is ready.
- Keep `.betabots/` ignored.

First inspect the partial research-weighted Betabots run at `.betabots/runs/20260716-213200-post-workspace-research-weighted/`. Its runner was intentionally stopped for this handoff after bots 001-005 completed, 006-007 were interrupted late, and 008 did not start. Analyze its raw journeys and screenshots as qualitative evidence only. It lacks real-backend attestation and final analysis artifacts; do not call the formal gate passed or resume from an assumed complete state.

Then execute the roadmap in this order:

1. Personal Contacts workspace (highest priority)
   - Replace the dashboard's fixed `limit=50` local subset with server-side pagination/search/filtering so all 106 contacts are reachable.
   - Add an accessible responsive contact profile with contact fields, bio/memory, work, relationship metadata, important dates, first-met context, provenance, interactions, and reminders.
   - Support editing, logging interactions, and scheduling/completing reminders.
   - Extend the owner-scoped API contract where needed.
   - Fix Add Contact: the web currently sends email/phone fields rejected by `CreateContactDto`; implement contact-method CRUD through `ContactField` instead of bypassing validation.
   - Use TDD with synthetic data and verify desktop plus Pixel-sized mobile behavior.

2. Authenticated daily cockpit
   - Surface today's durable brief, relationship reasoning, important dates, event items, and quests.
   - Add per-item done/snooze/dismiss/reminder/open/propose actions.
   - Add approval inbox/log and useful XP/streak/achievement feedback.

3. Invite request and Betabots integrity
   - Implement a minimal DB-backed, rate-limited, enumeration-resistant invite request queue with generic 202 responses, no-PII Discord/Hermes notification, reviewer-only APIs/UI, cleanup, and tests. Keep registration invite-code-only.
   - Add `/api/health/integrity` that executes a real PostgreSQL check and returns a fixed safe real-backend attestation; fixed sanitized 503 on failure.
   - Deploy and rerun the eight-persona cohort with real-backend attestation and synthetic test data. Iterate on repeated/high-severity findings.

4. Personal integrations with Yev's required actions
   - Prepare Google read-only OAuth and ask Yev only when the actual consent click is required.
   - Prepare Pixel OwnTracks enrollment and ask Yev only when phone-side configuration is required.
   - Add one certified public ICS source and enable flags one at a time after backup and aggregate smoke.

Use sub-agent-driven development for substantial slices: write a focused plan, have an implementer work test-first, have a separate reviewer inspect the diff, fix Critical/Important findings, and record commits/reviews in `.superpowers/sdd/progress.md`. Do not run multiple implementation agents against overlapping files.

Before each completion claim, run focused tests plus relevant API/web typecheck, test, lint/build, `git diff --check`, browser verification, and production smoke. Never substitute marketing/sample pages for proof that the authenticated personal workflow works.

At the end of each deployed slice, update `docs/ai-handoff-2026-07-16.md` (or create a newer dated replacement) with exact commit SHA, Coolify deployment UUID, verification commands/results, aggregate production evidence, and remaining work.
```
