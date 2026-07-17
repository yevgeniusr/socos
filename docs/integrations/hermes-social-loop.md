# Hermes Socos Social Loop

This tracked skill gives Hermes a fail-closed Discord-to-MCP planning boundary.
It contains no credentials, Discord targets, contact data, or location data.

## Install

Review and test without changing Hermes:

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
For a custom home, expose the same non-secret `HERMES_HOME` to the Hermes job so
the runtime command resolves the installed planner.

After installation, preload `socos-social-loop` in the existing daily job. Keep
its workdir on the Socos checkout, preserve `[SILENT]` for `BRIEF_NOT_READY`, and
retain the local Discord target outside the repository.

## Planner Protocol

Every mutation must first run this exact command:

```bash
node "${HERMES_HOME:-$HOME/.hermes}/skills/socos/socos-social-loop/scripts/reply-contract.mjs" plan
```

Pass one UTF-8 JSON object through process stdin. Never put personal input in
argv, shell source, environment variables, or temporary files. Input is limited
to 64 KiB and must contain exactly:

```json
{
  "text": "<one exact socos command>",
  "messageId": "<Discord Snowflake>",
  "editedTimestamp": null,
  "nowMs": 0,
  "brief": "<complete {ok:true,data:<DailyBrief>} socos_brief_today result>"
}
```

`brief` must be the complete strict MCP success envelope with exactly `ok` and
`data`; the planner unwraps it itself. Bare DailyBrief values, `ok:false`, and
extra result-envelope fields are rejected. `editedTimestamp` must be explicitly
present and `null`. Missing or non-null values are rejected. Old, future,
malformed, oversized, multi-object, and extra-field inputs are rejected with a
sanitized error that does not echo data.

Success emits one JSON object containing exactly one validated MCP mutation call:

```json
{
  "calls": [
    {
      "tool": "socos_brief_feedback",
      "input": "<strict tool input>"
    }
  ]
}
```

Hermes must execute the returned call without adding or changing fields. Nonzero
exit means no mutation.

## Grammar And Addressing

The accepted grammar is in the installed `SKILL.md`. Full item and quest IDs are
matched by exact equality against the supplied DailyBrief `people`, `dates`,
optional `events`, and `quests` arrays. Prefixes and display ranks are invalid.
Contact-targeted proposals on events fail closed.

Quest completion requires `status: "pending"` and an evidence kind matching the
quest's `completionType`. Only exact, already-recorded interaction IDs or exact,
already-completed reminder IDs are accepted. The backend still verifies evidence
ownership, target, and time.

Interaction logging and quest completion are not combined. Two MCP mutations
cannot provide atomic log-plus-quest semantics. That workflow requires a future
server-side composite transaction.

## Idempotency

Keys have this form:

```text
dc.<DiscordMessageId>.<feedback|complete|proposal>
```

The key uses immutable message ID and operation step only. It has no command
digest. The planner rejects Discord edits. If false null edit metadata lets
altered content plan the same tool and step, the same key reaches Socos with a
changed request hash and fails as an idempotency conflict instead of creating
another mutation. That fallback does not cover an alteration that changes the
tool or step; edit rejection is the primary boundary.

The exact 24-hour Snowflake boundary is accepted; older and future messages are
rejected. A transport timeout is an unknown outcome, so retry the exact call and
key.

## Tool Boundary

| Reply class | Planner output tool |
| --- | --- |
| Accept, snooze, dismiss | `socos_brief_feedback` |
| Explicit evidence completion | `socos_complete_quest` |
| Message, introduction, invitation, merge, delete proposal | `socos_propose_action` |

The planner emits only the three allowlisted tools above and never executes an
approved action. Proposals remain pending previews; approval is performed in
Socos, and provider-specific executors remain unavailable.

## Live Verification

After an operator intentionally updates the local job, use a controlled Discord
conversation:

1. Confirm the brief displays full item and quest addresses.
2. Reply with one feedback command and verify one Socos state change.
3. Retry the exact plan and verify no second mutation.
4. Confirm an edited Discord command is rejected before MCP.
5. Complete a pending quest only with an existing exact evidence ID.
6. Create a proposal and verify it remains pending with no outbound delivery.

Do not put production plans, personal rows, credentials, or precise location
samples in logs or verification artifacts.
