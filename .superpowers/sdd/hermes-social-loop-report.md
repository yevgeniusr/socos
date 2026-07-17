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
- Idempotency keys are stable by Discord message, canonical command, and step,
  and satisfy `^[A-Za-z0-9._:-]{8,128}$`.
- Discord Snowflake timestamps must be current, not future, and no older than
  the exact 24-hour server idempotency window.
- Item and quest addresses must exactly match a full ID returned by the current
  daily brief.
- Two-step interaction completion uses separate stable `log` and `complete`
  keys so a retry does not duplicate the interaction.
- Explicit evidence must match the quest's stored completion type before a
  mutation is attempted.
- Risky commands only call `socos_propose_action`.
- `socos_execute_approved_action` is excluded from every tool sequence and
  forbidden by the skill.
- No contact data, command content, credentials, or MCP responses are persisted
  locally by the contract.

## Known Limitation

Reminder quests cannot be automatically completed through the current 11-tool
MCP surface. The brief omits the target reminder ID, and MCP cannot mark or read
the completed target. Hermes must accept only a user-supplied full ID for an
already-completed reminder and must never infer it.

## Verification

The final verification gate covers the focused Node tests, Node syntax checks,
shell syntax, dry-run and isolated installation, skill frontmatter, repository
security regression scan, staged diff whitespace, and a scoped self-review.
Prettier is not installed in this checkout, so it is not part of this gate.
