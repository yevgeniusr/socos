import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  addressBookForBrief,
  assertKnownAddresses,
  discordIdempotencyKey,
  parseReply,
  planReply,
  renderAddress,
} from "./reply-contract.mjs";

const contractPath = fileURLToPath(new URL("./reply-contract.mjs", import.meta.url));
const installerPath = fileURLToPath(
  new URL("../../../../../scripts/install-hermes-socos-skill.sh", import.meta.url),
);
const itemId = "cmitem1234567890abcdef";
const eventItemId = "cmevent1234567890abcdef";
const reminderItemId = "cmdate1234567890abcdefg";
const questId = "cmquest1234567890abcde";
const completedQuestId = "cmquest1111111111abcde";
const reminderQuestId = "cmquest9876543210abcde";
const contactId = "cmcontact1234567890abc";
const otherContactId = "cmcontact9876543210xyz";
const interactionId = "cminteraction123456789";
const reminderId = "cmreminder1234567890ab";
const nowMs = Date.parse("2026-07-17T12:00:00.000Z");
const DISCORD_EPOCH_MS = 1_420_070_400_000;

function snowflakeAt(timestampMs) {
  return ((BigInt(timestampMs - DISCORD_EPOCH_MS) << 22n) + 1n).toString();
}

function brief() {
  return {
    schemaVersion: "1.1",
    briefId: "cmbrief1234567890abcdef",
    localDate: "2026-07-17",
    timeZone: "Asia/Dubai",
    generatedAt: "2026-07-17T05:00:00.000Z",
    people: [
      {
        itemId,
        contact: { id: contactId, name: "Synthetic Contact" },
        state: "pending",
      },
    ],
    dates: [
      {
        itemId: reminderItemId,
        contact: { id: contactId, name: "Synthetic Contact" },
        state: "pending",
      },
    ],
    events: [{ itemId: eventItemId, state: "pending" }],
    quests: [
      {
        questId,
        itemId,
        completionType: "interaction",
        status: "pending",
      },
      {
        questId: completedQuestId,
        itemId,
        completionType: "interaction",
        status: "completed",
      },
      {
        questId: reminderQuestId,
        itemId: reminderItemId,
        completionType: "reminder",
        status: "pending",
      },
    ],
    allowedActions: ["accept", "snooze", "dismiss", "complete"],
  };
}

function envelope(text, overrides = {}) {
  return {
    text,
    messageId: snowflakeAt(nowMs - 1_000),
    editedTimestamp: null,
    nowMs,
    brief: { ok: true, data: brief() },
    ...overrides,
  };
}

test("accepts only the strict real MCP success envelope for the brief", () => {
  const validText = `socos accept item:${itemId}`;
  assert.equal(planReply(envelope(validText)).calls.length, 1);

  for (const briefResult of [
    brief(),
    {
      ok: false,
      error: {
        code: "BRIEF_NOT_READY",
        message: "Synthetic not ready.",
        retryable: false,
      },
    },
    { ok: true, data: brief(), extra: true },
    { ok: true, data: brief(), error: { code: "INVALID_INPUT" } },
    { ok: true },
    { ok: "true", data: brief() },
  ]) {
    assert.throws(
      () => planReply(envelope(validText, { brief: briefResult })),
      /Socos reply plan rejected/,
    );
  }
});

test("parses feedback, explicit evidence completion, and proposal grammar only", () => {
  assert.deepEqual(parseReply(`socos accept item:${itemId}`), {
    kind: "feedback",
    action: "accept",
    itemId,
  });
  assert.deepEqual(
    parseReply(`socos complete quest:${questId} with interaction:${interactionId}`),
    { kind: "quest-completion", questId, interactionId },
  );
  assert.deepEqual(
    parseReply(`socos complete quest:${reminderQuestId} with reminder:${reminderId}`),
    { kind: "quest-completion", questId: reminderQuestId, reminderId },
  );
  assert.deepEqual(
    parseReply(`socos propose message item:${itemId} via social | Hello`),
    {
      kind: "proposal",
      actionType: "message",
      itemId,
      channel: "social",
      body: "Hello",
    },
  );
});

test("rejects fuzzy, multiline, ambiguous, and invalid commands", () => {
  const invalid = [
    `accept item:${itemId}`,
    `SOCOS accept item:${itemId}`,
    `socos accept P1`,
    `socos accept item:${itemId}\nsocos dismiss item:${itemId}`,
    `socos snooze item:${itemId} until 2026-07-18T09:30:00`,
    `socos snooze item:${itemId} until 2026-02-30T09:30:00+04:00`,
    `socos propose message item:${itemId} via discord | Hello`,
    `socos propose merge contact:${contactId} into contact:${contactId}`,
    `socos propose delete user:${contactId}`,
    `socos propose message item:${itemId} via social | one | two`,
    `socos execute approved action`,
  ];

  for (const command of invalid) {
    assert.throws(() => parseReply(command), /Invalid Socos reply/);
  }
});

test("preserves quest status and rejects non-pending or mismatched completion", () => {
  const book = addressBookForBrief(brief());
  assert.equal(
    book.quests.find((quest) => quest.questId === completedQuestId)?.status,
    "completed",
  );
  assert.throws(
    () =>
      assertKnownAddresses(
        parseReply(
          `socos complete quest:${completedQuestId} with interaction:${interactionId}`,
        ),
        book,
      ),
    /Quest is not pending/,
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

test("uses exact full brief addresses and rejects event contact proposals", () => {
  const book = addressBookForBrief(brief());
  assert.equal(renderAddress("item", itemId), `\`item:${itemId}\``);
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
});

test("derives idempotency from immutable message ID and step only", () => {
  const messageId = snowflakeAt(nowMs - 1_000);
  const first = discordIdempotencyKey({ messageId, step: "feedback" });
  const alteredPayload = discordIdempotencyKey({
    messageId,
    step: "feedback",
    command: { altered: "ignored" },
  });
  const otherStep = discordIdempotencyKey({ messageId, step: "proposal" });

  assert.equal(first, alteredPayload);
  assert.notEqual(first, otherStep);
  assert.equal(first, `dc.${messageId}.feedback`);
  assert.match(first, /^[A-Za-z0-9._:-]{8,128}$/);

  const accepted = planReply(
    envelope(`socos accept item:${itemId}`, { messageId }),
  );
  const dismissed = planReply(
    envelope(`socos dismiss item:${itemId}`, { messageId }),
  );
  assert.equal(
    accepted.calls[0].input.idempotencyKey,
    dismissed.calls[0].input.idempotencyKey,
  );
});

test("plans exact feedback and quest MCP calls", () => {
  assert.deepEqual(planReply(envelope(`socos accept item:${itemId}`)), {
    calls: [
      {
        tool: "socos_brief_feedback",
        input: {
          itemId,
          idempotencyKey: `dc.${snowflakeAt(nowMs - 1_000)}.feedback`,
          action: "accept",
        },
      },
    ],
  });
  assert.deepEqual(
    planReply(
      envelope(
        `socos complete quest:${questId} with interaction:${interactionId}`,
      ),
    ),
    {
      calls: [
        {
          tool: "socos_complete_quest",
          input: {
            questId,
            idempotencyKey: `dc.${snowflakeAt(nowMs - 1_000)}.complete`,
            interactionId,
          },
        },
      ],
    },
  );
});

test("plans exact payloads for every proposal type and never execution", () => {
  const cases = [
    [
      `socos propose message item:${itemId} via social | Hello`,
      {
        actionType: "message",
        payload: { contactId, channel: "social", body: "Hello" },
      },
    ],
    [
      `socos propose introduction item:${itemId} with contact:${otherContactId} | Shared work`,
      {
        actionType: "introduction",
        payload: { contactId, otherContactId, context: "Shared work" },
      },
    ],
    [
      `socos propose invitation item:${itemId} at 2026-07-20T18:00:00+04:00 | Meetup`,
      {
        actionType: "invitation",
        payload: {
          contactId,
          title: "Meetup",
          scheduledAt: "2026-07-20T18:00:00+04:00",
        },
      },
    ],
    [
      `socos propose merge contact:${contactId} into contact:${otherContactId}`,
      {
        actionType: "merge",
        payload: { sourceContactId: contactId, targetContactId: otherContactId },
      },
    ],
    [
      `socos propose delete reminder:${reminderId}`,
      {
        actionType: "delete",
        payload: { entityType: "reminder", entityId: reminderId },
      },
    ],
  ];

  for (const [text, expected] of cases) {
    const result = planReply(envelope(text));
    assert.deepEqual(result, {
      calls: [
        {
          tool: "socos_propose_action",
          input: {
            idempotencyKey: `dc.${snowflakeAt(nowMs - 1_000)}.proposal`,
            ...expected,
          },
        },
      ],
    });
    assert.ok(
      result.calls.every((call) => call.tool !== "socos_execute_approved_action"),
    );
  }
});

test("rejects missing, extra, edited, old, future, and invalid planner envelopes", () => {
  const validText = `socos accept item:${itemId}`;
  const missingFields = Object.keys(envelope(validText)).map((field) => {
    const input = envelope(validText);
    delete input[field];
    return input;
  });
  const cases = [
    ...missingFields,
    { ...envelope(validText), extra: true },
    envelope(validText, { editedTimestamp: "2026-07-17T11:59:59.000Z" }),
    envelope(validText, {
      messageId: snowflakeAt(nowMs - 24 * 60 * 60 * 1_000 - 1),
    }),
    envelope(validText, { messageId: snowflakeAt(nowMs + 1) }),
    envelope(`socos accept item:${itemId.slice(0, 8)}`),
    envelope(`socos propose message item:${eventItemId} via social | Hello`),
    envelope(
      `socos complete quest:${completedQuestId} with interaction:${interactionId}`,
    ),
    envelope(validText, { brief: { schemaVersion: "1.1" } }),
  ];

  for (const input of cases) {
    assert.throws(() => planReply(input), /Socos reply plan rejected/);
  }
});

test("stdin plan CLI accepts one bounded strict JSON object", () => {
  const result = spawnSync(process.execPath, [contractPath, "plan"], {
    input: JSON.stringify(envelope(`socos accept item:${itemId}`)),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), planReply(envelope(`socos accept item:${itemId}`)));
  assert.equal(result.stderr, "");
});

test("stdin plan CLI runs when invoked through a symlinked install path", () => {
  const directory = mkdtempSync(join(tmpdir(), "socos-reply-contract-"));
  const linkedDirectory = join(directory, "linked");
  symlinkSync(dirname(contractPath), linkedDirectory, "dir");
  const result = spawnSync(
    process.execPath,
    [join(linkedDirectory, "reply-contract.mjs"), "plan"],
    {
      input: JSON.stringify(envelope(`socos accept item:${itemId}`)),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    planReply(envelope(`socos accept item:${itemId}`)),
  );
});

test("stdin CLI rejects argv payloads, MCP failures, edits, and oversized input", () => {
  const argvPayload = spawnSync(
    process.execPath,
    [contractPath, "plan", `socos accept item:${itemId}`],
    { input: "{}", encoding: "utf8" },
  );
  assert.notEqual(argvPayload.status, 0);
  assert.equal(argvPayload.stdout, "");

  for (const input of [
    "{}{}",
    JSON.stringify(
      envelope(`socos accept item:${itemId}`, {
        brief: {
          ok: false,
          error: {
            code: "BRIEF_NOT_READY",
            message: "Synthetic not ready.",
            retryable: false,
          },
        },
      }),
    ),
    JSON.stringify(
      envelope(`socos accept item:${itemId}`, {
        editedTimestamp: "2026-07-17T11:59:59.000Z",
      }),
    ),
    "x".repeat(65_537),
  ]) {
    const result = spawnSync(process.execPath, [contractPath, "plan"], {
      input,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Socos reply plan rejected.\n");
    assert.doesNotMatch(result.stderr, new RegExp(itemId));
  }
});

test("installer and runtime honor an isolated custom HERMES_HOME", () => {
  const directory = mkdtempSync(join(tmpdir(), "socos-hermes-home-"));
  const hermesHome = join(directory, "custom-hermes");
  const install = spawnSync("sh", [installerPath], {
    encoding: "utf8",
    env: { ...process.env, HERMES_HOME: hermesHome },
  });
  assert.equal(install.status, 0, install.stderr);

  const installedRoot = join(
    hermesHome,
    "skills/socos/socos-social-loop",
  );
  const installedSkill = readFileSync(join(installedRoot, "SKILL.md"), "utf8");
  assert.match(
    installedSkill,
    /\$\{HERMES_HOME:-\$HOME\/\.hermes\}\/skills\/socos\/socos-social-loop/,
  );

  const runtime = spawnSync(
    "sh",
    [
      "-c",
      'node "${HERMES_HOME:-$HOME/.hermes}/skills/socos/socos-social-loop/scripts/reply-contract.mjs" plan',
    ],
    {
      input: JSON.stringify(envelope(`socos accept item:${itemId}`)),
      encoding: "utf8",
      env: { ...process.env, HERMES_HOME: hermesHome },
    },
  );
  assert.equal(runtime.status, 0, runtime.stderr);
});

test("installer resolves its repository when invoked through a symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "socos-installer-link-"));
  const linkedInstaller = join(directory, "install-socos");
  const hermesHome = join(directory, "hermes");
  symlinkSync(installerPath, linkedInstaller);

  const install = spawnSync("sh", [linkedInstaller], {
    encoding: "utf8",
    env: { ...process.env, HERMES_HOME: hermesHome },
  });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(
    readFileSync(
      join(hermesHome, "skills/socos/socos-social-loop/SKILL.md"),
      "utf8",
    ).length > 0,
    true,
  );
});
