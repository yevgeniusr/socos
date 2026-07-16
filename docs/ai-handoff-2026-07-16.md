# Socos AI Handoff - 2026-07-16

This document hands off the current Socos state to another AI/developer. It records what is done, what remains, known caveats, and a ready-to-use prompt.

## Current Repository State

- Repository: `git@github.com:yevgeniusr/socos.git`
- Working checkout: `/Users/mac/Desktop/projects/personal/socos`
- Branch: `main`
- Latest commit: `32db6518336cb427f94938c2ecb8b2493696b2a0`
- Latest commit message: `feat(web): add public sample workspace`
- Production URL: `https://socos.rachkovan.com`
- Coolify app UUID: `swwcg80gkw4k0k4oco8w8wgw`
- Latest Coolify deployment: `ajliakg70dfajcx71hs3jpk6`, finished at commit `32db6518336cb427f94938c2ecb8b2493696b2a0`

## Done And Verified

### Personal CRM Core

- Production database contains `106` non-demo Monica contacts and `7` isolated demo contacts, per `docs/validation/agent-interface-v1.md`.
- Personal-first architecture is documented in `docs/plans/2026-07-15-personal-first-socos-design.md`.
- Agent interface validation exists in `docs/validation/agent-interface-v1.md`.
- Daily relationship loop backend exists: briefs, reminders, important dates, quests, XP, feedback, and relationship health.
- MCP/API client path exists for Hermes, Codex, and Claude.
- Hermes daily Discord job is documented as configured and previously validated.
- Risk-based autonomy is implemented at the agent boundary: read/summarize/log/suggest is allowed by scope; risky outbound actions require approval.

### Calendar, Pixel Location, And Events Foundation

- Calendar/location/event modules are implemented and deployed disabled-first.
- Production env gates were verified disabled:
  - `CALENDAR_SYNC_ENABLED=false`
  - `LOCATION_INGEST_ENABLED=false`
  - `EVENT_DISCOVERY_ENABLED=false`
  - `EVENT_BRIEF_ENABLED=false`
- Google Calendar, OwnTracks-compatible Pixel location ingest, event discovery, event ranking, encrypted personal data storage, deletion, rekey, audit, and backup runbooks exist.
- Production smoke confirmed unauthenticated protected endpoints return `401`.
- Production smoke confirmed disabled OwnTracks ingest returns `503`.

### Public Product Proof

Commit `8d45a4f5fad3e346add0ff097ceda73ce9348d8a` added:

- Working `Watch Demo` CTA to `/#demo`.
- Public demo/proof section before signup.
- Signup/login context panels explaining invite-only alpha, Monica import, Hermes/MCP, Calendar/Pixel disabled-first modules, and safety boundaries.
- E2E coverage for the public demo path.

Commit `32db6518336cb427f94938c2ecb8b2493696b2a0` added:

- Public read-only route: `/sample-workspace`.
- One complete synthetic Socos workflow:
  - captured interaction
  - AI memory extraction
  - suggested next action
  - approval before outbound action
- Launch/access status and data controls.
- Links from the home demo section and signup page into the sample workspace.
- E2E coverage for the public sample workspace path.

Production smoke after deploy confirmed:

- `/` returns `200`
- `/sample-workspace` returns `200`
- `/auth/signup` returns `200`
- `/api/health-check` returns `200`
- `/api/mcp` returns `401`
- `POST /api/location/owntracks` returns `503`
- Rendered HTML contains the new sample workspace, workflow, launch/access, data controls, and signup links.

### Verification Run Locally

Passed:

- `pnpm --filter @socos/web build`
- `pnpm --filter @socos/web type:check`
- `pnpm --filter @socos/web lint` with warnings only, no errors
- `pnpm --filter @socos/web test`
- `git diff --check`
- Local production `next start` HTTP smoke after build

Caveat:

- Playwright CLI hung locally in this session before completing the focused new e2e case. The test was added and the same behavior was verified through production build plus HTTP-rendered output. The earlier targeted Playwright e2e for the first public-demo fix did pass.

## Betabots Findings

Artifacts are local and ignored by git under `.betabots/`.

### Initial Production Run

Folder: `.betabots/runs/20260716-155841/`

Findings:

- All bots were blocked by the invite wall before seeing enough proof.
- `Watch Demo` appeared non-functional.
- Landing copy looked polished but too generic.
- Bots wanted Monica import proof, daily brief proof, agent approval/audit, privacy/deletion details, and sample quests before signup.

### Post-Demo-Fix Run

Folder: `.betabots/runs/20260716-162300-post-demo-fix/`

Findings:

- The demo CTA fix worked. Bots reached `/#demo`.
- Bots saw the sample daily brief, safety boundaries, Monica/Hermes/Calendar/Pixel context, and invite-only framing.
- Remaining blocker: no read-only product surface, no invite request path, no pricing/access expectations, and not enough operational proof.

This led to commit `32db651...`, adding `/sample-workspace`.

### Post-Workspace Run

Folder: `.betabots/runs/20260716-171509-post-workspace/`

Status:

- Started after production deploy of `/sample-workspace`.
- First sandboxed attempt failed on Chrome process permissions.
- Elevated rerun was started but stopped because the user asked for this handoff.
- No complete post-workspace Betabots conclusion exists yet.

## Left To Do

### Highest Priority

1. Run a complete post-workspace Betabots cohort against `https://socos.rachkovan.com`.
2. If bots still fail at access, implement a real invite request path.
3. Decide whether invite requests should be:
   - database-backed with a new migration, admin review UI, and email/Discord notification; or
   - webhook-only to Hermes/Discord without storing public request data.
4. Keep no-secret rule: never print Coolify tokens, MCP tokens, Google secrets, private keys, invite codes, OAuth tokens, location samples, or personal row contents.

### Product Gaps

- Real invite request flow for people without an invite code.
- Public or authenticated read-only sample workspace with richer examples if Betabots still need more proof.
- Better pricing/access messaging.
- Stronger public explanation of deletion, export, rekey, and data control.
- Eventually a real internal dashboard surface for Yev that makes the 106-contact import directly useful every day.

### Personal Setup Requiring User Action

- Google Calendar OAuth consent cannot be fully completed by an AI alone. User must finish Google Cloud/OAuth/account consent steps.
- Pixel live location needs phone-side setup. OwnTracks-compatible ingest exists, but the Pixel must be configured to send authenticated HTTPS location payloads.
- Enable production flags only after credentials and manual consent are complete, and only after a fresh backup and smoke test.

### Engineering Follow-Ups

- Re-run full production smoke after every deploy.
- Fix or isolate local Playwright CLI hanging before relying on it for final e2e confidence.
- Keep `.betabots/` ignored. Do not commit runtime artifacts.
- Consider moving the public sample workspace data into a shared fixture if it later powers docs, tests, and UI.
- Before schema changes, take and verify a fresh Coolify backup/restore path.

## Known Useful Commands

Deploy exact commit through Coolify:

```bash
TOKEN=$(jq -r '.instances[] | select(.name=="qed") | .token' /Users/mac/.config/coolify/config.json)
COOLIFY_TOKEN="$TOKEN" \
COOLIFY_EXPECTED_COMMIT_SHA=<exact-sha> \
COOLIFY_DEPLOY_POLL_ATTEMPTS=180 \
COOLIFY_DEPLOY_POLL_SECONDS=5 \
scripts/coolify.sh deploy swwcg80gkw4k0k4oco8w8wgw
```

Verify mirror before deploy:

```bash
git ls-remote git@github.com:nanachichan3/socos.git refs/heads/main
```

Core web verification:

```bash
pnpm --filter @socos/web build
pnpm --filter @socos/web type:check
pnpm --filter @socos/web lint
pnpm --filter @socos/web test
git diff --check
```

Production smoke:

```bash
curl -s -o /tmp/socos-home.html -w '%{http_code}' https://socos.rachkovan.com/
curl -s -o /tmp/socos-sample.html -w '%{http_code}' https://socos.rachkovan.com/sample-workspace
curl -s -o /tmp/socos-signup.html -w '%{http_code}' https://socos.rachkovan.com/auth/signup
curl -s -o /tmp/socos-health.json -w '%{http_code}' https://socos.rachkovan.com/api/health-check
curl -s -o /tmp/socos-mcp.txt -w '%{http_code}' https://socos.rachkovan.com/api/mcp
curl -s -o /tmp/socos-owntracks.txt -w '%{http_code}' -X POST https://socos.rachkovan.com/api/location/owntracks -H 'Content-Type: application/json' -d '{}'
```

Expected production smoke status codes:

- `/`: `200`
- `/sample-workspace`: `200`
- `/auth/signup`: `200`
- `/api/health-check`: `200`
- `/api/mcp`: `401`
- `POST /api/location/owntracks`: `503` while location ingest is disabled

## Prompt For Another AI

Copy this prompt into another AI session:

```text
You are taking over Socos development from Codex. Work in `/Users/mac/Desktop/projects/personal/socos` on branch `main`.

Read first:
- `docs/ai-handoff-2026-07-16.md`
- `docs/validation/agent-interface-v1.md`
- `docs/plans/2026-07-15-personal-first-socos-design.md`
- `docs/runbooks/calendar-location-operations.md`
- `docs/runbooks/database-backup-restore.md`
- latest commits: `git log --oneline -8`

Current verified production commit is `32db6518336cb427f94938c2ecb8b2493696b2a0`, deployed to `https://socos.rachkovan.com`.

Do not print secrets. Do not inspect or dump production personal rows. Do not print Coolify tokens, MCP tokens, Google secrets, private keys, invite codes, OAuth tokens, location samples, or contact contents. Production personal data stays in Coolify PostgreSQL.

What is already done:
- 106 Monica contacts imported and isolated from 7 demo contacts, per validation docs.
- Hermes/Codex/Claude MCP/API agent clients validated.
- Hermes daily Discord job documented as configured.
- Daily brief, reminders, important dates, quests, relationship health, MCP tools, approval gates, audit, backups, deletion, rekey, Calendar/Pixel/events foundation exist.
- Calendar/location/event modules are deployed disabled-first.
- Public demo section and `/sample-workspace` are live and deployed.

Your immediate task:
1. Run a complete post-workspace Betabots cohort against `https://socos.rachkovan.com`, using the existing ignored `.betabots` artifacts if present.
2. Analyze whether `/sample-workspace` fixed the previous blocker.
3. If bots still fail because access is a dead end, implement a real invite request path. Prefer the smallest safe production design:
   - either database-backed invite requests with a migration, admin/review path, and notification; or
   - webhook-only Hermes/Discord notification without storing public request data.
4. Use TDD for behavior changes. Add tests before implementation.
5. Verify with build/typecheck/lint/tests, production smoke, and deploy exact SHA through Coolify if you change production code.

Known caveats:
- Playwright CLI hung locally in the previous session, though build and HTTP-rendered production smoke passed. If Playwright hangs, debug the runner/environment before treating it as product failure.
- Google Calendar account consent and Pixel phone-side location setup require user action. Do not claim those are complete unless actually completed.
- Production flags should stay disabled until credentials/manual consent are complete and a fresh backup/smoke is done.

When done, update `docs/ai-handoff-2026-07-16.md` or create a newer dated handoff with exact commit, deploy UUID, verification commands, and remaining work.
```
