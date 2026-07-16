# Hermes Daily Social Brief v1/v1.1

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

Briefs with `schemaVersion: "1.0"` keep the original shape and do not include
an `events` key. Briefs with `schemaVersion: "1.1"` include `events: []` even
when no event suggestions are available. REST routes, MCP tool names, reply
syntax, and mutation request bodies are unchanged; use the event `itemId` for
accept, snooze, and dismiss just like person/date items.

Each V1.1 event contains a public snapshot:

```ts
{
  itemId: string;
  rank: number;
  source: { type: "discovered_event"; id: string };
  title: string;
  startsAt: string;
  endsAt: string;
  city: string | null;
  reason: string;
  evidence: {
    components: {
      time: number;
      distance: number;
      interests: number;
      social: number;
      contact: number;
      novelty: number;
      feedback: number;
    };
    distanceBand: "<2" | "2-10" | "10-25" | "25-50" | ">50" | "unknown";
    conflict: "clear";
    context: {
      source: "sample" | "visit" | "calendar" | "fallback";
      freshness: "fresh" | "recent" | "planned" | "fallback";
    };
    matchedTags: string[];
    category: string | null;
    plannedCity: string | null;
  };
  state: "pending" | "accepted" | "snoozed" | "dismissed";
}
```

Event items never create quests. Completing quests remains limited to person/date
brief quests backed by verified interaction or reminder evidence.

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

Daily Brief v1/v1.1 can read recommendations, record item feedback, and submit CRM
evidence for quest completion. It cannot send a message, address a recipient,
create an invitation or introduction, merge records, or delete records.
