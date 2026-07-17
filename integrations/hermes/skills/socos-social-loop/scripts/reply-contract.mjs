import { TextDecoder } from "node:util";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DISCORD_MESSAGE_ID_PATTERN = /^[0-9]{17,20}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_STDIN_BYTES = 64 * 1_024;
const CHANNELS = new Set(["email", "sms", "social", "other"]);
const IDEMPOTENCY_STEPS = new Set(["feedback", "complete", "proposal"]);
const ALLOWED_MUTATION_TOOLS = new Set([
  "socos_brief_feedback",
  "socos_complete_quest",
  "socos_propose_action",
]);
const ENVELOPE_KEYS = [
  "brief",
  "editedTimestamp",
  "messageId",
  "nowMs",
  "text",
];
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

  match = /^socos snooze item:([A-Za-z0-9_-]+) until (\S+)$/.exec(input);
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

  match = /^socos dismiss item:([A-Za-z0-9_-]+) because ([^|]+)$/.exec(input);
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

  match = /^socos propose invitation item:([A-Za-z0-9_-]+) \| ([^|]+)$/.exec(
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
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    throw new Error("Invalid Socos brief.");
  }
  if (brief.schemaVersion !== "1.0" && brief.schemaVersion !== "1.1") {
    throw new Error("Invalid Socos brief.");
  }
  if (brief.schemaVersion === "1.1" && !Array.isArray(brief.events)) {
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
      !["pending", "completed"].includes(quest?.status) ||
      !items.some((item) => item.itemId === itemId)
    ) {
      throw new Error("Invalid Socos brief.");
    }
    return {
      questId,
      itemId,
      completionType: quest.completionType,
      status: quest.status,
    };
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

  if (command.kind === "quest-completion") {
    const quest = book.quests.find((entry) => entry.questId === command.questId);
    if (!quest) throw new Error("Unknown full quest address.");
    if (quest.status !== "pending") throw new Error("Quest is not pending.");
    const item = book.items.find((entry) => entry.itemId === quest.itemId);
    if (!item || item.contactId === null) {
      throw new Error("Quest does not resolve to a contact.");
    }
    const evidenceType =
      command.interactionId === undefined ? "reminder" : "interaction";
    if (quest.completionType !== evidenceType) {
      throw new Error(`Quest expects ${quest.completionType} evidence.`);
    }
    return {
      questId: quest.questId,
      itemId: item.itemId,
      contactId: item.contactId,
      itemKind: item.itemKind,
      completionType: quest.completionType,
      status: quest.status,
    };
  }

  throw new Error("Invalid parsed Socos reply.");
}

export function discordIdempotencyKey({ messageId, step }) {
  if (!DISCORD_MESSAGE_ID_PATTERN.test(messageId)) {
    throw new Error("Invalid Discord message ID.");
  }
  if (!IDEMPOTENCY_STEPS.has(step)) {
    throw new Error("Invalid idempotency step.");
  }
  const key = `dc.${messageId}.${step}`;
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

export function planReply(input) {
  try {
    return planReplyUnchecked(input);
  } catch {
    throw new Error("Socos reply plan rejected.");
  }
}

function planReplyUnchecked(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid planner input.");
  }
  if (!sameKeys(Object.keys(input).sort(), ENVELOPE_KEYS)) {
    throw new Error("Invalid planner input.");
  }
  if (input.editedTimestamp !== null) {
    throw new Error("Edited Discord messages are rejected.");
  }
  assertRecentDiscordMessage({ messageId: input.messageId, nowMs: input.nowMs });
  const command = parseReply(input.text);
  const book = addressBookForBrief(input.brief);
  const resolved = assertKnownAddresses(command, book);

  if (command.kind === "feedback") {
    const toolInput = {
      itemId: command.itemId,
      idempotencyKey: discordIdempotencyKey({
        messageId: input.messageId,
        step: "feedback",
      }),
      action: command.action,
      ...(command.snoozedUntil === undefined
        ? {}
        : { snoozedUntil: command.snoozedUntil }),
      ...(command.reason === undefined ? {} : { reason: command.reason }),
    };
    return { calls: [mutationCall("socos_brief_feedback", toolInput)] };
  }

  if (command.kind === "quest-completion") {
    const toolInput = {
      questId: command.questId,
      idempotencyKey: discordIdempotencyKey({
        messageId: input.messageId,
        step: "complete",
      }),
      ...(command.interactionId === undefined
        ? { reminderId: command.reminderId }
        : { interactionId: command.interactionId }),
    };
    return { calls: [mutationCall("socos_complete_quest", toolInput)] };
  }

  if (command.kind === "proposal") {
    const toolInput = {
      actionType: command.actionType,
      idempotencyKey: discordIdempotencyKey({
        messageId: input.messageId,
        step: "proposal",
      }),
      payload: proposalPayload(command, resolved),
    };
    return { calls: [mutationCall("socos_propose_action", toolInput)] };
  }

  throw new Error("Invalid parsed Socos reply.");
}

function proposalPayload(command, resolved) {
  if (command.actionType === "message") {
    return {
      contactId: resolved.contactId,
      channel: command.channel,
      body: command.body,
    };
  }
  if (command.actionType === "introduction") {
    return {
      contactId: resolved.contactId,
      otherContactId: command.otherContactId,
      context: command.context,
    };
  }
  if (command.actionType === "invitation") {
    return {
      contactId: resolved.contactId,
      title: command.title,
      ...(command.scheduledAt === undefined
        ? {}
        : { scheduledAt: command.scheduledAt }),
    };
  }
  if (command.actionType === "merge") {
    return {
      sourceContactId: command.sourceContactId,
      targetContactId: command.targetContactId,
    };
  }
  if (command.actionType === "delete") {
    return { entityType: command.entityType, entityId: command.entityId };
  }
  throw new Error("Invalid proposal type.");
}

function mutationCall(tool, input) {
  if (!ALLOWED_MUTATION_TOOLS.has(tool)) {
    throw new Error("Forbidden Socos mutation tool.");
  }
  return { tool, input };
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
  const nominal = new Date(0);
  nominal.setUTCHours(hour, minute, second, 0);
  nominal.setUTCFullYear(year, month - 1, day);
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

function sameKeys(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function invalidReply() {
  return new Error("Invalid Socos reply.");
}

async function readBoundedStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_STDIN_BYTES) {
      throw new Error("Planner input is too large.");
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw new Error("Planner input is empty.");
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

async function runCli() {
  if (process.argv.length !== 3 || process.argv[2] !== "plan") {
    process.stderr.write("Socos reply plan rejected.\n");
    process.exitCode = 64;
    return;
  }
  try {
    const raw = await readBoundedStdin();
    const plan = planReply(JSON.parse(raw));
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  } catch {
    process.stderr.write("Socos reply plan rejected.\n");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await runCli();
}
