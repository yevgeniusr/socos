# Hermes Socos Social Loop

This tracked Hermes skill turns the durable Socos daily brief into an exact,
idempotent Discord reply contract. It does not contain credentials, Discord
targets, contact data, or location data.

## Install

Review without modifying Hermes:

```bash
scripts/install-hermes-socos-skill.sh --dry-run
node --test integrations/hermes/skills/socos-social-loop/scripts/reply-contract.test.mjs
```

Install the two public runtime files:

```bash
scripts/install-hermes-socos-skill.sh
```

The destination is
`$HERMES_HOME/skills/socos/socos-social-loop`, defaulting to
`~/.hermes/skills/socos/socos-social-loop`. Installation does not edit MCP
credentials, Discord configuration, cron jobs, or gateway state.

In a fresh Hermes session, confirm that the skill is visible and the existing
MCP connection remains healthy. Then edit the existing daily job interactively:

- preload `socos-social-loop`;
- keep the job workdir on the Socos checkout;
- instruct it to call `socos_brief_today` and render through the skill;
- preserve `[SILENT]` for `BRIEF_NOT_READY`;
- retain the existing Discord delivery target without placing it in the repo.

## Addressing And Grammar

Every actionable brief entry must display its complete server address:

```text
item:<full itemId>
quest:<full questId>
contact:<full contactId>
```

The skill accepts only the single-line commands documented in its Strict Reply
Contract. Names, ranks such as `P1`, shortened IDs, natural-language guesses,
and messages containing more than one command are rejected.

Before an item or quest mutation, the workflow rebuilds an address book from the
actual `socos_brief_today` `people`, `dates`, optional `events`, and `quests`
arrays. It requires exact equality with a returned full ID. Prefix matches are
never accepted, and event items fail contact-targeted proposal resolution.

RFC3339 timestamps require an explicit `Z` or numeric offset, for example
`2026-07-18T09:30:00+04:00`.

## Idempotency

`reply-contract.mjs` canonicalizes the parsed command and derives keys shaped as:

```text
dc.<DiscordMessageId>.<24 hex characters>.<step>
```

Valid steps are `feedback`, `log`, `complete`, and `proposal`. The same Discord
message, parsed command, and step always produce the same key. Edited commands,
different messages, and different steps produce different keys. All keys satisfy
the Socos `^[A-Za-z0-9._:-]{8,128}$` contract.

Socos agent idempotency records currently expire after 24 hours. The workflow
must call `assertRecentDiscordMessage` before deriving a key. It accepts the
exact 24-hour boundary, rejects older or future Snowflakes, and reuses a key only
for transport retries of the same recent intent. A timeout is an unknown outcome:
retry the exact input and key.

## Tool Mapping

| Reply class | MCP calls |
| --- | --- |
| Accept, snooze, dismiss | `socos_brief_today`, `socos_brief_feedback` |
| Explicit evidence completion | `socos_brief_today`, `socos_complete_quest` |
| Log and complete interaction quest | `socos_brief_today`, `socos_log_interaction`, `socos_complete_quest` |
| Message, introduction, invitation proposal | `socos_brief_today`, `socos_propose_action` |
| Merge or delete proposal | `socos_propose_action` |

The interaction path uses separate `log` and `complete` keys. If completion fails
after logging succeeds, a retry replays the same interaction response and resumes
completion instead of creating a second interaction.

The workflow never calls `socos_execute_approved_action`. A proposal is only a
pending preview; approval happens in Socos. Current provider-specific executors
remain unavailable.

## Reminder Quest Limitation

The current daily brief does not expose a reminder quest's target reminder ID.
The 11-tool MCP surface also cannot mark a reminder complete or retrieve a
completed reminder target. Hermes must not guess from names, titles, or dates.

An explicit `complete ... with reminder:<id>` command is valid only when the user
already has the exact completed reminder ID. Full automatic support requires a
least-privilege quest-action read contract or a future brief schema that exposes
the evidence target.

## Live Verification

After an operator intentionally updates the local job, use one recent brief in a
controlled Discord conversation:

1. Confirm rendered entries include full item and quest addresses.
2. Reply with one feedback command and verify exactly one state change in Socos.
3. Retry the same tool input and key; verify no second mutation.
4. For a genuine interaction, use `socos did` and verify one interaction, one
   quest completion, and one XP award.
5. Create a proposal and verify it remains pending with no outbound delivery.

Do not place production tool responses, personal rows, credentials, or precise
location samples in command logs or verification artifacts.
