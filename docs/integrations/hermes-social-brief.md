# Hermes Daily Social Brief v1

Hermes reads a durable, owner-scoped social brief from SOCOS. Use environment
variables for the API origin and bearer token; never store a token in a command
or configuration file.

```bash
curl --fail --silent \
  -H "Authorization: Bearer $SOCOS_TOKEN" \
  "$SOCOS_URL/api/briefs/today"
```

`GET /api/briefs/today` is read-only. HTTP 404 with code `BRIEF_NOT_READY`
means Hermes should post nothing and retry after the next scheduler interval.
An authorized operator may explicitly request idempotent generation with
`POST /api/briefs/generate`.

## Reply Mapping

Map Discord replies to these authenticated API actions:

| Reply                                | Request                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `accept <itemId>`                    | `POST /api/briefs/items/<itemId>/feedback` with `{"action":"accept"}`                   |
| `snooze <itemId> <ISO time>`         | Same endpoint with `{"action":"snooze","snoozedUntil":"<ISO time>"}`                    |
| `dismiss <itemId> [reason]`          | Same endpoint with `{"action":"dismiss","reason":"[reason]"}`                           |
| `complete <questId> <interactionId>` | `POST /api/briefs/quests/<questId>/complete` with `{"interactionId":"<interactionId>"}` |
| `complete <questId> <reminderId>`    | Same endpoint with `{"reminderId":"<reminderId>"}`                                      |

Every mutation requires an `Idempotency-Key` header matching
`^[A-Za-z0-9._:-]{8,128}$`. Hermes creates one stable key for each user intent
and reuses that key only when retrying transport for the same request. A new or
changed intent must use a new key.

Quest XP is server-owned and is awarded only after SOCOS verifies the referenced
interaction or completed reminder. Accepting, snoozing, and dismissing do not
award XP.

## Safety Boundary

Daily Brief v1 can read recommendations, record item feedback, and submit CRM
evidence for quest completion. It cannot send a message, address a recipient,
create an invitation or introduction, merge records, or delete records.
