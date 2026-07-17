---
name: socos-social-loop
description: Use when rendering a Socos daily brief in Hermes or handling a Discord message that begins with the exact `socos` command prefix.
version: 1.0.0
author: Socos
license: MIT
metadata:
  hermes:
    tags: [socos, discord, crm, mcp]
    related_skills: [native-mcp]
---

# Socos Social Loop

## Overview

Operate the relationship loop through authenticated Socos MCP.

## Daily Brief

1. Call `socos_brief_today` with `{}`. Return exactly `[SILENT]` for
   `BRIEF_NOT_READY`.
2. Render concise people, dates, events, and quests. Preserve every full ID as
   ``item:<itemId>`` or ``quest:<questId>``; never substitute a rank or alias.
3. Show only relevant commands. Never expose credentials, full exports, or
   precise location history.

## Strict Reply Contract

Accept one single-line, lowercase command per Discord message:

```text
socos accept item:<id>
socos snooze item:<id> until <RFC3339>
socos dismiss item:<id>
socos dismiss item:<id> because <reason>
socos complete quest:<id> with interaction:<id>
socos complete quest:<id> with reminder:<id>
socos did quest:<id> via <call|message|meeting|note|email|social> | <summary>
socos propose message item:<id> via <email|sms|social|other> | <body>
socos propose introduction item:<id> with contact:<id> | <context>
socos propose invitation item:<id> at <RFC3339> | <title>
socos propose invitation item:<id> | <title>
socos propose merge contact:<source> into contact:<target>
socos propose delete <contact|interaction|reminder>:<id>
```

Reject fuzzy or multiple commands, missing offsets, truncated IDs, ambiguous
contacts, messages older than 24 hours, and missing Discord message IDs. The
executable grammar is `scripts/reply-contract.mjs`.

## MCP Mapping

Before mutation, call `socos_brief_today`, build an address book from its actual
arrays, and require exact full-ID equality with `assertKnownAddresses`.

- `accept`, `snooze`, `dismiss`: call `socos_brief_feedback` with
  `{ itemId, idempotencyKey, action }`, adding only `snoozedUntil` or `reason`
  when that grammar supplies it.
- Explicit `complete`: call `socos_complete_quest` with
  `{ questId, idempotencyKey, interactionId }` or
  `{ questId, idempotencyKey, reminderId }`, never both evidence fields.
- `socos did`: re-read the brief; resolve `questId -> itemId -> contact.id` and
  require an interaction quest. Call `socos_log_interaction` using the parsed
  `{ contactId, type, content: summary, idempotencyKey }` with no `occurredAt`;
  then call `socos_complete_quest` with its returned `interactionId`. Use
  separate `log` and `complete` keys.
- Contact-targeted proposals: re-read the brief and require exactly one contact.
  Event items fail closed. Call `socos_propose_action` with
  `{ actionType, idempotencyKey, payload }`; payload fields are exactly
  `contactId/channel/body`, `contactId/otherContactId/context`, or
  `contactId/title/scheduledAt` for the three item-targeted proposal types.
- Merge payload is `{ sourceContactId, targetContactId }`. Delete payload is
  `{ entityType, entityId }`. Use only the explicit full IDs in the command.

Before key derivation, require
`assertRecentDiscordMessage({ messageId, nowMs: Date.now() })`. Then derive keys
with `discordIdempotencyKey({ messageId, command, step })`. Retries reuse the
exact input and key; retry only retryable results with bounded backoff.

## Approval Boundary

`socos_propose_action` creates a preview only. Never call
`socos_execute_approved_action`, even after conversational approval. Approval
belongs in Socos; provider executors are unavailable.

Reminder quests are not automatically resolvable: the brief omits the target ID
and MCP cannot complete reminders. Accept only a supplied full, already-completed
reminder ID; never infer it.

## Completion Check

A mutation is complete only after `ok: true`. Never claim a proposal was sent.
Do not persist commands, contact data, or tool responses locally.
