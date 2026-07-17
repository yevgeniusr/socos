# Hermes Socos Social Loop Report

## Scope

Implemented the smallest tracked Hermes skill for rendering Socos daily briefs
and mapping exact Discord commands to the existing authenticated MCP tools. No
production MCP call was made, and no file under `~/.hermes`, Discord message,
cron job, or gateway process was changed.

## TDD Evidence

### RED 1

```text
node --test integrations/hermes/skills/socos-social-loop/scripts/reply-contract.test.mjs
exit=1 ERR_MODULE_NOT_FOUND: reply-contract.mjs
```

The initial test contract existed before the implementation module.

### GREEN 1

```text
9 tests passed, 0 failed
```

### RED 2

The first self-review found that minimum ID length could not prove an address was
complete. New tests required an address book built from the actual DailyBrief
`people`, `dates`, optional `events`, and `quests` arrays.

```text
exit=1: reply-contract.mjs did not provide addressBookForBrief
```

### GREEN 2

```text
10 tests passed, 0 failed
```

Exact full-ID equality now replaces the length heuristic. Truncated IDs and
contact-targeted proposals for event items fail closed.

### RED/GREEN 3

Pre-commit review required executable enforcement for the documented 24-hour
window and quest evidence type. New tests first failed because the Snowflake
helpers were absent. The next run passed 11 tests, including exact boundary,
older, future, malformed, interaction-for-reminder, and reminder-for-interaction
cases.

### RED/GREEN 4: Review Hardening

Review found that the installed module was not an executable gate, edited
messages created new command-digest keys, and multi-tool interaction completion
was not atomic. A rewritten test suite first failed because `planReply` was
absent. The next run passed 11 tests after adding the bounded stdin planner,
immutable-message idempotency, edit rejection, pending quest checks, exact tool
plans, and removing every multi-tool completion path.

## Delivered Files

- `integrations/hermes/skills/socos-social-loop/SKILL.md`
- `integrations/hermes/skills/socos-social-loop/scripts/reply-contract.mjs`
- `integrations/hermes/skills/socos-social-loop/scripts/reply-contract.test.mjs`
- `scripts/install-hermes-socos-skill.sh`
- `docs/integrations/hermes-social-loop.md`
- `.superpowers/sdd/hermes-social-loop-report.md`

## Safety Properties

- One lowercase, single-line `socos` command per Discord message.
- RFC3339 timestamps require an explicit offset and a real calendar date.
- Free-text limits match the agent-core tool schemas.
- Idempotency keys use immutable Discord message ID and step only and satisfy
  `^[A-Za-z0-9._:-]{8,128}$`.
- Discord Snowflake timestamps must be current, not future, and no older than
  the exact 24-hour server idempotency window.
- Item and quest addresses must exactly match a full ID returned by the current
  daily brief.
- Edited messages are rejected before planning; false edit metadata still uses
  the same key and reaches the backend request-hash conflict boundary.
- Planner input is one strict JSON object, limited to 64 KiB and accepted only
  through stdin. Personal input is rejected in argv and is never written to a
  temporary file.
- Every successful plan contains exactly one allowlisted MCP mutation call.
- Explicit evidence must match the quest's stored completion type before a
  mutation is attempted.
- Risky commands only call `socos_propose_action`.
- `socos_execute_approved_action` is excluded from every tool sequence and
  forbidden by the skill.
- No contact data, command content, credentials, or MCP responses are persisted
  locally by the contract.

## Known Limitation

Quest completion requires an exact already-recorded interaction ID or exact
already-completed reminder ID. The current MCP surface cannot safely combine
interaction logging with quest completion; that workflow requires a future
server-side composite transaction. The brief also omits a reminder quest's
target reminder ID, so Hermes must never infer it.

## Verification

The final verification gate covers the focused Node tests, Node syntax checks,
shell syntax, dry-run and isolated installation, skill frontmatter, repository
security regression scan, staged diff whitespace, and a scoped self-review.
Prettier is not installed in this checkout, so it is not part of this gate.
