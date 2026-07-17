import { createHash } from "node:crypto";

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DISCORD_MESSAGE_ID_PATTERN = /^[0-9]{17,20}$/;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const INTERACTION_TYPES = new Set([
  "call",
  "message",
  "meeting",
  "note",
  "email",
  "social",
]);
const CHANNELS = new Set(["email", "sms", "social", "other"]);
const IDEMPOTENCY_STEPS = new Set([
  "feedback",
  "log",
  "complete",
  "proposal",
]);
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseReply(input) {
  try {
    return parseReplyUnchecked(input);
  } catch {
    throw invalidReply();
  }
}

function parseReplyUnchecked(input) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input !== input.trim() ||
    /[\r\n]/.test(input)
  ) {
    throw invalidReply();
  }

  let match = /^socos accept item:([A-Za-z0-9_-]+)$/.exec(input);
  if (match) {
    return { kind: "feedback", action: "accept", itemId: entityId(match[1]) };
  }

  match =
    /^socos snooze item:([A-Za-z0-9_-]+) until (\S+)$/.exec(input);
  if (match) {
    return {
      kind: "feedback",
      action: "snooze",
      itemId: entityId(match[1]),
      snoozedUntil: rfc3339(match[2]),
    };
  }

  match = /^socos dismiss item:([A-Za-z0-9_-]+)$/.exec(input);
  if (match) {
    return { kind: "feedback", action: "dismiss", itemId: entityId(match[1]) };
  }

  match =
    /^socos dismiss item:([A-Za-z0-9_-]+) because ([^|]+)$/.exec(input);
  if (match) {
    return {
      kind: "feedback",
      action: "dismiss",
      itemId: entityId(match[1]),
      reason: boundedText(match[2], 500),
    };
  }

  match =
    /^socos complete quest:([A-Za-z0-9_-]+) with interaction:([A-Za-z0-9_-]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "quest-completion",
      questId: entityId(match[1]),
      interactionId: entityId(match[2]),
    };
  }

  match =
    /^socos complete quest:([A-Za-z0-9_-]+) with reminder:([A-Za-z0-9_-]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "quest-completion",
      questId: entityId(match[1]),
      reminderId: entityId(match[2]),
    };
  }

  match =
    /^socos did quest:([A-Za-z0-9_-]+) via ([a-z]+) \| ([^|]+)$/.exec(
      input,
    );
  if (match && INTERACTION_TYPES.has(match[2])) {
    return {
      kind: "quest-log-completion",
      questId: entityId(match[1]),
      interactionType: match[2],
      summary: boundedText(match[3], 10_000),
    };
  }

  match =
    /^socos propose message item:([A-Za-z0-9_-]+) via ([a-z]+) \| ([^|]+)$/.exec(
      input,
    );
  if (match && CHANNELS.has(match[2])) {
    return {
      kind: "proposal",
      actionType: "message",
      itemId: entityId(match[1]),
      channel: match[2],
      body: boundedText(match[3], 10_000),
    };
  }

  match =
    /^socos propose introduction item:([A-Za-z0-9_-]+) with contact:([A-Za-z0-9_-]+) \| ([^|]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "proposal",
      actionType: "introduction",
      itemId: entityId(match[1]),
      otherContactId: entityId(match[2]),
      context: boundedText(match[3], 2_000),
    };
  }

  match =
    /^socos propose invitation item:([A-Za-z0-9_-]+) at (\S+) \| ([^|]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "proposal",
      actionType: "invitation",
      itemId: entityId(match[1]),
      scheduledAt: rfc3339(match[2]),
      title: boundedText(match[3], 500),
    };
  }

  match =
    /^socos propose invitation item:([A-Za-z0-9_-]+) \| ([^|]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "proposal",
      actionType: "invitation",
      itemId: entityId(match[1]),
      title: boundedText(match[2], 500),
    };
  }

  match =
    /^socos propose merge contact:([A-Za-z0-9_-]+) into contact:([A-Za-z0-9_-]+)$/.exec(
      input,
    );
  if (match) {
    const sourceContactId = entityId(match[1]);
    const targetContactId = entityId(match[2]);
    if (sourceContactId === targetContactId) throw invalidReply();
    return {
      kind: "proposal",
      actionType: "merge",
      sourceContactId,
      targetContactId,
    };
  }

  match =
    /^socos propose delete (contact|interaction|reminder):([A-Za-z0-9_-]+)$/.exec(
      input,
    );
  if (match) {
    return {
      kind: "proposal",
      actionType: "delete",
      entityType: match[1],
      entityId: entityId(match[2]),
    };
  }

  throw invalidReply();
}

export function itemAddress(id) {
  return `item:${entityId(id)}`;
}

export function questAddress(id) {
  return `quest:${entityId(id)}`;
}

export function contactAddress(id) {
  return `contact:${entityId(id)}`;
}

export function renderAddress(kind, id) {
  const formatters = {
    item: itemAddress,
    quest: questAddress,
    contact: contactAddress,
  };
  const formatter = formatters[kind];
  if (!formatter) throw new Error("Invalid address kind.");
  return `\`${formatter(id)}\``;
}

export function addressBookForBrief(brief) {
  if (!brief || typeof brief !== "object") {
    throw new Error("Invalid Socos brief.");
  }
  const items = [];
  for (const [key, itemKind] of [
    ["people", "person"],
    ["dates", "date"],
    ["events", "event"],
  ]) {
    const entries = brief[key] ?? [];
    if (!Array.isArray(entries)) throw new Error("Invalid Socos brief.");
    for (const entry of entries) {
      const itemId = entityId(entry?.itemId);
      if (items.some((item) => item.itemId === itemId)) {
        throw new Error("Invalid Socos brief.");
      }
      const contactId =
        itemKind === "event" ? null : entityId(entry?.contact?.id);
      items.push({ itemId, contactId, itemKind });
    }
  }

  if (!Array.isArray(brief.quests)) throw new Error("Invalid Socos brief.");
  const quests = brief.quests.map((quest) => {
    const questId = entityId(quest?.questId);
    const itemId = entityId(quest?.itemId);
    if (
      !["interaction", "reminder"].includes(quest?.completionType) ||
      !items.some((item) => item.itemId === itemId)
    ) {
      throw new Error("Invalid Socos brief.");
    }
    return { questId, itemId, completionType: quest.completionType };
  });
  if (new Set(quests.map((quest) => quest.questId)).size !== quests.length) {
    throw new Error("Invalid Socos brief.");
  }
  return { items, quests };
}

export function assertKnownAddresses(command, book) {
  if (
    !command ||
    !book ||
    !Array.isArray(book.items) ||
    !Array.isArray(book.quests)
  ) {
    throw new Error("Invalid Socos address book.");
  }

  if (command.kind === "feedback" || command.kind === "proposal") {
    if (command.itemId === undefined) return {};
    const item = book.items.find((entry) => entry.itemId === command.itemId);
    if (!item) throw new Error("Unknown full item address.");
    if (command.kind === "proposal" && item.contactId === null) {
      throw new Error("Item does not resolve to a contact.");
    }
    return {
      itemId: item.itemId,
      ...(item.contactId === null ? {} : { contactId: item.contactId }),
      itemKind: item.itemKind,
    };
  }

  if (
    command.kind === "quest-completion" ||
    command.kind === "quest-log-completion"
  ) {
    const quest = book.quests.find((entry) => entry.questId === command.questId);
    if (!quest) throw new Error("Unknown full quest address.");
    const item = book.items.find((entry) => entry.itemId === quest.itemId);
    if (!item || item.contactId === null) {
      throw new Error("Quest does not resolve to a contact.");
    }
    if (command.kind === "quest-completion") {
      const evidenceType =
        command.interactionId === undefined ? "reminder" : "interaction";
      if (quest.completionType !== evidenceType) {
        throw new Error(`Quest expects ${quest.completionType} evidence.`);
      }
    }
    if (
      command.kind === "quest-log-completion" &&
      quest.completionType !== "interaction"
    ) {
      throw new Error("Quest does not accept interaction evidence.");
    }
    return {
      questId: quest.questId,
      itemId: item.itemId,
      contactId: item.contactId,
      itemKind: item.itemKind,
      completionType: quest.completionType,
    };
  }

  throw new Error("Invalid parsed Socos reply.");
}

export function canonicalizeReply(command) {
  return JSON.stringify(sortJson(command));
}

export function discordIdempotencyKey({ messageId, command, step }) {
  if (!DISCORD_MESSAGE_ID_PATTERN.test(messageId)) {
    throw new Error("Invalid Discord message ID.");
  }
  if (!IDEMPOTENCY_STEPS.has(step)) {
    throw new Error("Invalid idempotency step.");
  }
  const digest = createHash("sha256")
    .update(canonicalizeReply(command))
    .digest("hex")
    .slice(0, 24);
  const key = `dc.${messageId}.${digest}.${step}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error("Invalid idempotency key.");
  }
  return key;
}

export function discordMessageTimestamp(messageId) {
  if (!DISCORD_MESSAGE_ID_PATTERN.test(messageId)) {
    throw new Error("Invalid Discord message ID.");
  }
  const timestamp = (BigInt(messageId) >> 22n) + DISCORD_EPOCH_MS;
  const value = Number(timestamp);
  if (!Number.isSafeInteger(value)) {
    throw new Error("Invalid Discord message ID.");
  }
  return value;
}

export function assertRecentDiscordMessage({ messageId, nowMs }) {
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("Invalid current timestamp.");
  }
  const timestamp = discordMessageTimestamp(messageId);
  if (timestamp > nowMs) {
    throw new Error("Discord message has a future timestamp.");
  }
  if (nowMs - timestamp > MAX_MESSAGE_AGE_MS) {
    throw new Error("Discord message is older than 24 hours.");
  }
  return timestamp;
}

export function toolSequenceForReply(command) {
  if (command.kind === "feedback") {
    return ["socos_brief_today", "socos_brief_feedback"];
  }
  if (command.kind === "quest-completion") {
    return ["socos_brief_today", "socos_complete_quest"];
  }
  if (command.kind === "quest-log-completion") {
    return [
      "socos_brief_today",
      "socos_log_interaction",
      "socos_complete_quest",
    ];
  }
  if (command.kind === "proposal") {
    if (["message", "introduction", "invitation"].includes(command.actionType)) {
      return ["socos_brief_today", "socos_propose_action"];
    }
    return ["socos_propose_action"];
  }
  throw new Error("Invalid parsed Socos reply.");
}

function entityId(value) {
  if (typeof value !== "string" || !ENTITY_ID_PATTERN.test(value)) {
    throw new Error("Invalid entity ID.");
  }
  return value;
}

function boundedText(value, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    throw invalidReply();
  }
  return value;
}

function rfc3339(value) {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) throw invalidReply();

  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  if (year === 0 || second > 59) throw invalidReply();
  const nominal = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    nominal.getUTCFullYear() !== year ||
    nominal.getUTCMonth() !== month - 1 ||
    nominal.getUTCDate() !== day ||
    nominal.getUTCHours() !== hour ||
    nominal.getUTCMinutes() !== minute ||
    nominal.getUTCSeconds() !== second
  ) {
    throw invalidReply();
  }
  if (match[8] !== "Z" && (Number(match[10]) > 23 || Number(match[11]) > 59)) {
    throw invalidReply();
  }
  if (Number.isNaN(Date.parse(value))) throw invalidReply();
  return value;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function invalidReply() {
  return new Error("Invalid Socos reply.");
}
