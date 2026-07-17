import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addressBookForBrief,
  assertKnownAddresses,
  assertRecentDiscordMessage,
  canonicalizeReply,
  contactAddress,
  discordIdempotencyKey,
  discordMessageTimestamp,
  itemAddress,
  parseReply,
  questAddress,
  renderAddress,
  toolSequenceForReply,
} from "./reply-contract.mjs";

const itemId = "cmitem1234567890abcdef";
const questId = "cmquest1234567890abcde";
const contactId = "cmcontact1234567890abc";
const otherContactId = "cmcontact9876543210xyz";
const interactionId = "cminteraction123456789";
const reminderId = "cmreminder1234567890ab";
const DISCORD_EPOCH_MS = 1_420_070_400_000;

function snowflakeAt(timestampMs) {
  return ((BigInt(timestampMs - DISCORD_EPOCH_MS) << 22n) + 1n).toString();
}

test("parses the exact feedback grammar", () => {
  assert.deepEqual(parseReply(`socos accept item:${itemId}`), {
    kind: "feedback",
    action: "accept",
    itemId,
  });
  assert.deepEqual(
    parseReply(
      `socos snooze item:${itemId} until 2026-07-18T09:30:00+04:00`,
    ),
    {
      kind: "feedback",
      action: "snooze",
      itemId,
      snoozedUntil: "2026-07-18T09:30:00+04:00",
    },
  );
  assert.deepEqual(
    parseReply(`socos dismiss item:${itemId} because not relevant this week`),
    {
      kind: "feedback",
      action: "dismiss",
      itemId,
      reason: "not relevant this week",
    },
  );
  assert.deepEqual(parseReply(`socos dismiss item:${itemId}`), {
    kind: "feedback",
    action: "dismiss",
    itemId,
  });
});

test("parses explicit and two-step quest completion grammar", () => {
  assert.deepEqual(
    parseReply(
      `socos complete quest:${questId} with interaction:${interactionId}`,
    ),
    {
      kind: "quest-completion",
      questId,
      interactionId,
    },
  );
  assert.deepEqual(
    parseReply(`socos complete quest:${questId} with reminder:${reminderId}`),
    {
      kind: "quest-completion",
      questId,
      reminderId,
    },
  );
  assert.deepEqual(
    parseReply(`socos did quest:${questId} via meeting | Coffee catch-up`),
    {
      kind: "quest-log-completion",
      questId,
      interactionType: "meeting",
      summary: "Coffee catch-up",
    },
  );
});

test("parses proposal-only commands for every risky action type", () => {
  assert.deepEqual(
    parseReply(
      `socos propose message item:${itemId} via social | Want to catch up?`,
    ),
    {
      kind: "proposal",
      actionType: "message",
      itemId,
      channel: "social",
      body: "Want to catch up?",
    },
  );
  assert.deepEqual(
    parseReply(
      `socos propose introduction item:${itemId} with contact:${otherContactId} | Shared interest`,
    ),
    {
      kind: "proposal",
      actionType: "introduction",
      itemId,
      otherContactId,
      context: "Shared interest",
    },
  );
  assert.deepEqual(
    parseReply(
      `socos propose invitation item:${itemId} at 2026-07-20T18:00:00+04:00 | AI meetup`,
    ),
    {
      kind: "proposal",
      actionType: "invitation",
      itemId,
      scheduledAt: "2026-07-20T18:00:00+04:00",
      title: "AI meetup",
    },
  );
  assert.deepEqual(
    parseReply(
      `socos propose invitation item:${itemId} | Coffee next week`,
    ),
    {
      kind: "proposal",
      actionType: "invitation",
      itemId,
      title: "Coffee next week",
    },
  );
  assert.deepEqual(
    parseReply(
      `socos propose merge contact:${contactId} into contact:${otherContactId}`,
    ),
    {
      kind: "proposal",
      actionType: "merge",
      sourceContactId: contactId,
      targetContactId: otherContactId,
    },
  );
  assert.deepEqual(
    parseReply(`socos propose delete reminder:${reminderId}`),
    {
      kind: "proposal",
      actionType: "delete",
      entityType: "reminder",
      entityId: reminderId,
    },
  );
});

test("fails closed on fuzzy, multiline, truncated, ambiguous, and invalid commands", () => {
  const invalid = [
    `accept item:${itemId}`,
    `SOCOS accept item:${itemId}`,
    `socos accept P1`,
    `socos accept item:${itemId}\nsocos dismiss item:${itemId}`,
    `socos snooze item:${itemId} until 2026-07-18T09:30:00`,
    `socos snooze item:${itemId} until 2026-02-30T09:30:00+04:00`,
    `socos did quest:${questId} via chat | A chat`,
    `socos did quest:${questId} via meeting | `,
    `socos propose message item:${itemId} via discord | Hello`,
    `socos propose merge contact:${contactId} into contact:${contactId}`,
    `socos propose delete user:${contactId}`,
    `socos propose message item:${itemId} via social | one | two`,
  ];

  for (const command of invalid) {
    assert.throws(() => parseReply(command), /Invalid Socos reply/);
  }
});

test("enforces free-text limits from the agent tool contracts", () => {
  assert.throws(
    () =>
      parseReply(`socos dismiss item:${itemId} because ${"x".repeat(501)}`),
    /Invalid Socos reply/,
  );
  assert.throws(
    () =>
      parseReply(
        `socos propose invitation item:${itemId} | ${"x".repeat(501)}`,
      ),
    /Invalid Socos reply/,
  );
  assert.throws(
    () =>
      parseReply(
        `socos propose introduction item:${itemId} with contact:${otherContactId} | ${"x".repeat(2001)}`,
      ),
    /Invalid Socos reply/,
  );
  assert.throws(
    () =>
      parseReply(
        `socos propose message item:${itemId} via social | ${"x".repeat(10_001)}`,
      ),
    /Invalid Socos reply/,
  );
});

test("renders full server-owned addresses without aliases", () => {
  assert.equal(itemAddress(itemId), `item:${itemId}`);
  assert.equal(questAddress(questId), `quest:${questId}`);
  assert.equal(contactAddress(contactId), `contact:${contactId}`);
  assert.equal(renderAddress("item", itemId), `\`item:${itemId}\``);
  assert.equal(itemAddress("short-but-complete"), "item:short-but-complete");
});

test("builds a brief address book and rejects truncated or contactless addresses", () => {
  const eventItemId = "cmevent1234567890abcdef";
  const reminderItemId = "cmdate1234567890abcdefg";
  const reminderQuestId = "cmquest9876543210abcde";
  const book = addressBookForBrief({
    people: [{ itemId, contact: { id: contactId } }],
    dates: [{ itemId: reminderItemId, contact: { id: contactId } }],
    events: [{ itemId: eventItemId }],
    quests: [
      {
        questId,
        itemId,
        completionType: "interaction",
      },
      {
        questId: reminderQuestId,
        itemId: reminderItemId,
        completionType: "reminder",
      },
    ],
  });

  assert.deepEqual(
    assertKnownAddresses(parseReply(`socos accept item:${itemId}`), book),
    { itemId, contactId, itemKind: "person" },
  );
  assert.throws(
    () =>
      assertKnownAddresses(
        parseReply(`socos accept item:${itemId.slice(0, 8)}`),
        book,
      ),
    /Unknown full item address/,
  );
  assert.throws(
    () =>
      assertKnownAddresses(
        parseReply(
          `socos propose message item:${eventItemId} via social | Hello`,
        ),
        book,
      ),
    /does not resolve to a contact/,
  );
  assert.deepEqual(
    assertKnownAddresses(
      parseReply(`socos did quest:${questId} via meeting | Catch-up`),
      book,
    ),
    {
      questId,
      itemId,
      contactId,
      itemKind: "person",
      completionType: "interaction",
    },
  );
  assert.throws(
    () =>
      assertKnownAddresses(
        parseReply(`socos complete quest:${questId} with reminder:${reminderId}`),
        book,
      ),
    /expects interaction evidence/,
  );
  assert.throws(
    () =>
      assertKnownAddresses(
        parseReply(
          `socos complete quest:${reminderQuestId} with interaction:${interactionId}`,
        ),
        book,
      ),
    /expects reminder evidence/,
  );
});

test("canonicalizes equivalent parsed commands deterministically", () => {
  const first = {
    kind: "feedback",
    itemId,
    action: "accept",
  };
  const reordered = {
    action: "accept",
    kind: "feedback",
    itemId,
  };

  assert.equal(canonicalizeReply(first), canonicalizeReply(reordered));
});

test("derives stable valid idempotency keys from Discord message intent", () => {
  const command = parseReply(`socos accept item:${itemId}`);
  const first = discordIdempotencyKey({
    messageId: "142857142857142857",
    command,
    step: "feedback",
  });
  const retry = discordIdempotencyKey({
    messageId: "142857142857142857",
    command,
    step: "feedback",
  });
  const edited = discordIdempotencyKey({
    messageId: "142857142857142857",
    command: parseReply(`socos dismiss item:${itemId}`),
    step: "feedback",
  });
  const secondStep = discordIdempotencyKey({
    messageId: "142857142857142857",
    command,
    step: "complete",
  });
  const differentMessage = discordIdempotencyKey({
    messageId: "142857142857142858",
    command,
    step: "feedback",
  });

  assert.equal(first, retry);
  assert.notEqual(first, edited);
  assert.notEqual(first, secondStep);
  assert.notEqual(first, differentMessage);
  assert.match(first, /^[A-Za-z0-9._:-]{8,128}$/);
  assert.throws(
    () =>
      discordIdempotencyKey({
        messageId: "not-a-discord-id",
        command,
        step: "feedback",
      }),
    /Invalid Discord message ID/,
  );
});

test("decodes Discord Snowflakes and enforces the 24-hour boundary", () => {
  const nowMs = Date.parse("2026-07-17T12:00:00.000Z");
  const recent = snowflakeAt(nowMs - 1);
  const boundary = snowflakeAt(nowMs - 24 * 60 * 60 * 1_000);
  const old = snowflakeAt(nowMs - 24 * 60 * 60 * 1_000 - 1);
  const future = snowflakeAt(nowMs + 1);

  assert.equal(discordMessageTimestamp(recent), nowMs - 1);
  assert.equal(assertRecentDiscordMessage({ messageId: recent, nowMs }), nowMs - 1);
  assert.equal(
    assertRecentDiscordMessage({ messageId: boundary, nowMs }),
    nowMs - 24 * 60 * 60 * 1_000,
  );
  assert.throws(
    () => assertRecentDiscordMessage({ messageId: old, nowMs }),
    /older than 24 hours/,
  );
  assert.throws(
    () => assertRecentDiscordMessage({ messageId: future, nowMs }),
    /future timestamp/,
  );
  assert.throws(
    () => discordMessageTimestamp("not-a-snowflake"),
    /Invalid Discord message ID/,
  );
  assert.throws(
    () =>
      assertRecentDiscordMessage({
        messageId: recent,
        nowMs: Number.NaN,
      }),
    /Invalid current timestamp/,
  );
});

test("returns exact tool sequences and never approved execution", () => {
  const cases = [
    [
      parseReply(`socos accept item:${itemId}`),
      ["socos_brief_today", "socos_brief_feedback"],
    ],
    [
      parseReply(
        `socos complete quest:${questId} with interaction:${interactionId}`,
      ),
      ["socos_brief_today", "socos_complete_quest"],
    ],
    [
      parseReply(`socos did quest:${questId} via call | Catch-up`),
      [
        "socos_brief_today",
        "socos_log_interaction",
        "socos_complete_quest",
      ],
    ],
    [
      parseReply(
        `socos propose message item:${itemId} via social | Hello there`,
      ),
      ["socos_brief_today", "socos_propose_action"],
    ],
    [
      parseReply(
        `socos propose merge contact:${contactId} into contact:${otherContactId}`,
      ),
      ["socos_propose_action"],
    ],
  ];

  for (const [command, expected] of cases) {
    const sequence = toolSequenceForReply(command);
    assert.deepEqual(sequence, expected);
    assert.ok(!sequence.includes("socos_execute_approved_action"));
  }
});
