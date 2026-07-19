---
name: socos-social-loop
description: Use when rendering a Socos daily brief, handling an exact `socos` Discord command, or reviewing provenance-backed contact enrichment in Hermes.
version: 1.1.1
author: Socos
license: MIT
metadata:
  hermes:
    tags: [socos, discord, crm, mcp]
    related_skills: [native-mcp]
---

# Socos Social Loop

## Contact Enrichment

For an explicit enrichment request, page through
`socos_contacts_missing_enrichment` and read evidence with
`socos_enrichment_candidates_list`. Submit one source-backed field at a time with
`socos_enrichment_candidate_submit`; never include raw page bodies or browser
history dumps. `socos_enrichment_candidate_accept` is allowed only for
non-`public_web` evidence with confidence at least `0.90`, and only when the tool
confirms the field was missing. Treat every conflict as a stop condition. Public
web candidates remain pending for human review. Enrichment does not use
`socos_propose_action` and never requires `approvals:execute`.

For an explicit owner correction of an existing LinkedIn or social URL, call
`socos_correct_contact_social_link` only with the full contact ID, one social key,
the corrected URL, source kind/locator/reference/retrieved timestamp, confidence,
rationale, and `expectedCurrentValue`. The source kind must be owner-controlled or
private evidence: `second_brain`, `arc_history`, `arc_sidebar`, or `vcard`. Treat
stale-value conflicts as a stop condition. Do not use this from daily-brief replies
or public-web evidence.

This workflow is separate from the exact Discord reply grammar below. Never infer
an enrichment mutation from a daily-brief reply.

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

1. Fetch `socos_brief_today` and retain its complete result envelope in memory.
2. Require Discord metadata with `editedTimestamp` explicitly present and
   `null`. Reject edits, missing metadata, old/future messages, fuzzy commands,
   missing offsets, unknown IDs, completed quests, and evidence-type mismatch.
3. Run only:

   ```text
   node "${HERMES_HOME:-$HOME/.hermes}/skills/socos/socos-social-loop/scripts/reply-contract.mjs" plan
   ```

   Send one JSON object through process stdin with exactly `text`, `messageId`,
   `editedTimestamp`, `nowMs`, and `brief`. Set `brief` to the complete
   `socos_brief_today` result, exactly `{ok:true,data:<DailyBrief>}`. Never place
   these values in argv, a shell command, environment variable, or temporary file.
4. If the planner exits nonzero, mutate nothing. If it succeeds, call the exact
   single MCP tool and input in its JSON output. Do not add or reinterpret fields.

The planner rejects failures and noncanonical result envelopes, then validates
the real DailyBrief `people`, `dates`, optional `events`, and `quests`. It
preserves quest `status`, requires pending completion, maps item proposals to
exact contacts, and rejects contact actions on events.

## Idempotency And Approval

Keys are `dc.<DiscordMessageId>.<feedback|complete|proposal>`. They depend only
on immutable message ID and step. Transport retries reuse the exact plan. If
false edit metadata lets altered content reach the same tool and step, the same
key must produce a backend conflict, not a second mutation. Edit rejection is
the primary boundary when an alteration changes the tool or step.

Planner output is restricted to `socos_brief_feedback`,
`socos_complete_quest`, or `socos_propose_action`. Proposals are pending previews.
Never call `socos_execute_approved_action`, even after conversational approval;
approval belongs in Socos and provider executors are unavailable.

Claim completion only after `ok: true`. Never claim a proposal was sent. Do not
persist commands, briefs, contact data, plans, or tool responses locally.
