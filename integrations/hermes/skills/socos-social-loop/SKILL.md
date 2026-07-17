---
name: socos-social-loop
description: Use when rendering a Socos daily brief in Hermes or handling a Discord message that begins with the exact `socos` command prefix.
version: 1.1.0
author: Socos
license: MIT
metadata:
  hermes:
    tags: [socos, discord, crm, mcp]
    related_skills: [native-mcp]
---

# Socos Social Loop

## Daily Brief

Call `socos_brief_today` with `{}`. Return exactly `[SILENT]` for
`BRIEF_NOT_READY`. Render concise people, dates, events, and pending quests.
Preserve every full ID as ``item:<itemId>`` or ``quest:<questId>``; never use a
rank or truncated alias. Never expose credentials, full exports, or precise
location history.

## Reply Grammar

Accept one lowercase, single-line command:

```text
socos accept item:<id>
socos snooze item:<id> until <RFC3339>
socos dismiss item:<id>
socos dismiss item:<id> because <reason>
socos complete quest:<id> with interaction:<id>
socos complete quest:<id> with reminder:<id>
socos propose message item:<id> via <email|sms|social|other> | <body>
socos propose introduction item:<id> with contact:<id> | <context>
socos propose invitation item:<id> at <RFC3339> | <title>
socos propose invitation item:<id> | <title>
socos propose merge contact:<source> into contact:<target>
socos propose delete <contact|interaction|reminder>:<id>
```

There is no log-and-complete command. Completing a quest requires a full
already-recorded interaction ID or already-completed reminder ID. A future
server-side composite transaction is required before logging and completing can
be one safe action.

## Mandatory Planner

Before every mutation:

1. Fetch `socos_brief_today` and retain the complete response in memory.
2. Require Discord metadata with `editedTimestamp` explicitly present and
   `null`. Reject edits, missing metadata, old/future messages, fuzzy commands,
   missing offsets, unknown IDs, completed quests, and evidence-type mismatch.
3. Run only:

   ```text
   node ~/.hermes/skills/socos/socos-social-loop/scripts/reply-contract.mjs plan
   ```

   Send one JSON object through process stdin with exactly `text`, `messageId`,
   `editedTimestamp`, `nowMs`, and `brief`. Never place these values in argv, a
   shell command, environment variable, or temporary file.
4. If the planner exits nonzero, mutate nothing. If it succeeds, call the exact
   single MCP tool and input in its JSON output. Do not add or reinterpret fields.

The planner validates the real DailyBrief `people`, `dates`, optional `events`,
and `quests`, preserves quest `status`, requires pending completion, maps item
proposals to exact contacts, and rejects contact actions on events.

## Idempotency And Approval

Keys are `dc.<DiscordMessageId>.<feedback|complete|proposal>`. They depend only
on immutable message ID and step. Transport retries reuse the exact plan. An
altered payload with the same key must produce a backend conflict, not a second
mutation.

Planner output is restricted to `socos_brief_feedback`,
`socos_complete_quest`, or `socos_propose_action`. Proposals are pending previews.
Never call `socos_execute_approved_action`, even after conversational approval;
approval belongs in Socos and provider executors are unavailable.

Claim completion only after `ok: true`. Never claim a proposal was sent. Do not
persist commands, briefs, contact data, plans, or tool responses locally.
