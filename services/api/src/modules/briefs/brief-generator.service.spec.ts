import type { PrismaService } from "../prisma/prisma.service.js";
import type { ImportantDateCandidate } from "./important-dates.service.js";
import type { ImportantDatesService } from "./important-dates.service.js";
import { BriefGeneratorService } from "./brief-generator.service.js";

const ownerId = "synthetic-owner";
const now = new Date("2026-07-16T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

function contact(overrides: Record<string, unknown>) {
  return {
    id: "contact-default",
    ownerId,
    isDemo: false,
    firstName: "Synthetic",
    lastName: "Person",
    importance: 3,
    preferredCadenceDays: 90,
    lastContactedAt: daysAgo(90),
    interactions: [{ occurredAt: daysAgo(90) }],
    tasks: [],
    ...overrides,
  };
}

function dateCandidate(
  overrides: Partial<ImportantDateCandidate> = {}
): ImportantDateCandidate {
  return {
    sourceType: "birthday",
    sourceId: "date-source",
    contactId: "date-contact",
    contactName: "Synthetic Date",
    title: "Synthetic Date's birthday",
    dateKey: "2026-07-20",
    daysAway: 4,
    reason: "Synthetic Date's birthday is in 4 days",
    ...overrides,
  };
}

function readyBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "ready-brief",
    ownerId,
    schemaVersion: "1.0",
    localDate: new Date("2026-07-16T00:00:00.000Z"),
    timeZone: "UTC",
    status: "ready",
    generatedAt: now,
    items: [],
    quests: [],
    ...overrides,
  };
}

function harness(
  options: {
    contacts?: ReturnType<typeof contact>[];
    dates?: ImportantDateCandidate[];
    feedback?: Array<Record<string, unknown>>;
    pendingQuests?: Array<Record<string, unknown>>;
    transactionPendingQuests?: Array<Record<string, unknown>>;
    existing?: ReturnType<typeof readyBatch> | null;
    transactionError?: unknown;
  } = {}
) {
  const contactRows = [...(options.contacts ?? [])].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const feedbackRows = (options.feedback ?? [])
    .map((entry, index) => ({
      id: `feedback-${String(index).padStart(6, "0")}`,
      ...entry,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const pendingQuestRows = (options.pendingQuests ?? [])
    .map((entry, index) => ({
      id: `pending-quest-${String(index).padStart(6, "0")}`,
      ...entry,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const page = <T extends { id: string }>(
    rows: T[],
    args: { cursor?: { id: string }; take: number }
  ): T[] => {
    const start = args.cursor
      ? Math.max(0, rows.findIndex((row) => row.id === args.cursor!.id) + 1)
      : 0;
    return rows.slice(start, start + args.take);
  };
  const items: Array<Record<string, unknown>> = [];
  const quests: Array<Record<string, unknown>> = [];
  const batch = {
    id: "generated-brief",
    ownerId,
    schemaVersion: "1.0",
    localDate: new Date("2026-07-16T00:00:00.000Z"),
    timeZone: "UTC",
    status: "generating",
    generatedAt: null,
  };
  const tx = {
    briefBatch: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...batch, ...data })
        ),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...batch,
          ...data,
          items: [...items],
          quests: [...quests],
        })
      ),
    },
    briefItem: {
      create: jest.fn().mockImplementation(({ data }) => {
        const item = { id: `item-${items.length + 1}`, ...data };
        items.push(item);
        return Promise.resolve(item);
      }),
    },
    quest: {
      findMany: jest
        .fn()
        .mockResolvedValue(options.transactionPendingQuests ?? []),
      create: jest.fn().mockImplementation(({ data }) => {
        const quest = {
          id: `quest-${quests.length + 1}`,
          status: "pending",
          ...data,
        };
        quests.push(quest);
        return Promise.resolve(quest);
      }),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ timeZone: "UTC" }),
    },
    briefBatch: {
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
    },
    contact: {
      findMany: jest
        .fn()
        .mockImplementation((args) => Promise.resolve(page(contactRows, args))),
    },
    briefFeedback: {
      findMany: jest
        .fn()
        .mockImplementation((args) =>
          Promise.resolve(page(feedbackRows, args))
        ),
    },
    quest: {
      findMany: jest
        .fn()
        .mockImplementation((args) =>
          Promise.resolve(page(pendingQuestRows, args))
        ),
    },
    $transaction: jest.fn().mockImplementation(async (callback) => {
      if (options.transactionError) throw options.transactionError;
      return callback(tx);
    }),
  };
  const importantDates = {
    collect: jest.fn().mockResolvedValue(options.dates ?? []),
  };
  const service = new BriefGeneratorService(
    prisma as unknown as PrismaService,
    importantDates as unknown as ImportantDatesService
  );

  return { service, prisma, importantDates, tx, items, quests };
}

describe("BriefGeneratorService", () => {
  it("ranks deterministically and persists the top three people plus at most five dates", async () => {
    const contacts = [
      contact({
        id: "contact-tie-b",
        importance: 3,
        lastContactedAt: daysAgo(90),
      }),
      contact({
        id: "contact-never",
        importance: 5,
        lastContactedAt: null,
        interactions: [],
      }),
      contact({
        id: "contact-high",
        importance: 3,
        lastContactedAt: daysAgo(180),
      }),
      contact({
        id: "contact-tie-a",
        importance: 3,
        lastContactedAt: daysAgo(90),
      }),
      contact({
        id: "contact-demo",
        isDemo: true,
        importance: 5,
        lastContactedAt: null,
      }),
    ];
    const dates = Array.from({ length: 6 }, (_, index) =>
      dateCandidate({
        sourceId: `date-${index + 1}`,
        dateKey: `2026-07-${String(17 + index).padStart(2, "0")}`,
        daysAway: index + 1,
      })
    );
    const { service, prisma, importantDates, items, quests, tx } = harness({
      contacts,
      dates,
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId, isDemo: false },
        take: expect.any(Number),
      })
    );
    expect(importantDates.collect).toHaveBeenCalledWith(
      ownerId,
      now,
      "UTC",
      14
    );
    expect(result.people.map((person) => person.contact.id)).toEqual([
      "contact-high",
      "contact-never",
      "contact-tie-a",
    ]);
    expect(result.dates).toHaveLength(5);
    expect(result.people[0]).toMatchObject({
      health: { score: 0, band: "at-risk" },
      lastInteractionAt: daysAgo(90).toISOString(),
      reason: "Preferred check-in cadence is overdue by 90 days.",
      evidence: expect.arrayContaining([
        { code: "reason_code", value: "cadence_overdue" },
        { code: "importance", value: 3 },
      ]),
    });
    expect(result.people[1]).toMatchObject({
      health: { score: 35, band: "needs-attention" },
      lastInteractionAt: null,
      reason: "No interaction has been recorded yet.",
    });
    expect(quests).toHaveLength(3);
    expect(quests.every((quest) => quest.xpReward === 15)).toBe(true);
    expect(tx.briefBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "generating" }),
      })
    );
    expect(tx.briefBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ready", generatedAt: now } })
    );
    expect(items).toHaveLength(8);
  });

  it("returns one or two people when fewer than three are eligible", async () => {
    const { service } = harness({
      contacts: [contact({ id: "contact-b" }), contact({ id: "contact-a" })],
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.people.map((person) => person.contact.id)).toEqual([
      "contact-a",
      "contact-b",
    ]);
  });

  it("ranks the true top three when the highest-urgency contact is after page one", async () => {
    const contacts = Array.from({ length: 106 }, (_, index) =>
      contact({
        id: `contact-${String(index).padStart(3, "0")}`,
        importance: index === 105 ? 5 : 1,
        lastContactedAt: index === 105 ? daysAgo(180) : daysAgo(1),
        interactions: [
          { occurredAt: index === 105 ? daysAgo(180) : daysAgo(1) },
        ],
      })
    );
    const { service, prisma } = harness({ contacts });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.people[0].contact.id).toBe("contact-105");
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(2);
    expect(
      prisma.contact.findMany.mock.calls.every(([args]) => args.take === 100)
    ).toBe(true);
    expect(prisma.contact.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: "contact-099" },
      skip: 1,
    });
  });

  it("excludes active snoozes and recent dismissals but allows an expired dismissal", async () => {
    const contacts = [
      contact({ id: "snoozed-contact" }),
      contact({ id: "recently-dismissed-contact" }),
      contact({ id: "cooled-contact" }),
    ];
    const feedback = [
      {
        action: "snooze",
        snoozedUntil: new Date(now.getTime() + DAY_MS),
        createdAt: daysAgo(40),
        briefItem: { contactId: "snoozed-contact" },
      },
      {
        action: "dismiss",
        snoozedUntil: null,
        createdAt: daysAgo(10),
        briefItem: { contactId: "recently-dismissed-contact" },
      },
      {
        action: "dismiss",
        snoozedUntil: null,
        createdAt: daysAgo(31),
        briefItem: { contactId: "cooled-contact" },
      },
    ];
    const { service } = harness({ contacts, feedback });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.people.map((person) => person.contact.id)).toEqual([
      "cooled-contact",
    ]);
  });

  it("paginates active feedback so repeated rows cannot hide another contact cooldown", async () => {
    const repeated = Array.from({ length: 501 }, (_, index) => ({
      id: `feedback-${String(index).padStart(6, "0")}`,
      action: "snooze",
      snoozedUntil: new Date(now.getTime() + DAY_MS),
      createdAt: daysAgo(1),
      briefItem: { contactId: "crowded-contact" },
    }));
    const feedback = [
      ...repeated,
      {
        id: "feedback-999999",
        action: "dismiss",
        snoozedUntil: null,
        createdAt: daysAgo(2),
        briefItem: { contactId: "hidden-dismissed-contact" },
      },
    ];
    const { service, prisma } = harness({
      contacts: [
        contact({ id: "crowded-contact" }),
        contact({ id: "hidden-dismissed-contact" }),
        contact({ id: "eligible-contact" }),
      ],
      feedback,
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.people.map((person) => person.contact.id)).toEqual([
      "eligible-contact",
    ]);
    expect(prisma.briefFeedback.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(
      prisma.briefFeedback.findMany.mock.calls.every(
        ([args]) => args.take <= 100
      )
    ).toBe(true);
  });

  it("fills quests with pending reminders after selected people using server-owned rewards", async () => {
    const dates = Array.from({ length: 2 }, (_, index) =>
      dateCandidate({
        sourceType: "reminder",
        sourceId: `reminder-${index + 1}`,
        title: `Synthetic reminder ${index + 1}`,
      })
    );
    const { service } = harness({
      contacts: [contact({ id: "contact-b" }), contact({ id: "contact-a" })],
      dates,
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.quests).toHaveLength(4);
    expect(
      result.quests.map((quest) => [quest.completionType, quest.xpReward])
    ).toEqual([
      ["interaction", 15],
      ["interaction", 15],
      ["reminder", 20],
      ["reminder", 20],
    ]);
  });

  it("emits each distinct verifiable target once and permits principled 0/1 scarcity", async () => {
    const duplicateReminder = dateCandidate({
      sourceType: "reminder",
      sourceId: "one-reminder",
      title: "Synthetic reminder",
    });
    const { service, quests } = harness({
      contacts: [],
      dates: [
        duplicateReminder,
        {
          ...duplicateReminder,
          sourceId: "one-reminder",
          dateKey: "2026-07-21",
        },
      ],
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.quests).toHaveLength(1);
    expect(quests).toHaveLength(1);
    expect(quests[0]).toMatchObject({
      completionType: "reminder",
      targetId: "one-reminder",
      xpReward: 20,
    });
  });

  it("does not stack a second pending quest for the same action on the next day", async () => {
    const firstDay = harness({
      contacts: [contact({ id: "repeat-contact" })],
    });
    const firstBrief = await firstDay.service.generateForOwner(ownerId, now);
    const unrelatedPending = Array.from({ length: 100 }, (_, index) => ({
      id: `prior-${String(index).padStart(3, "0")}`,
      completionType: "interaction",
      targetId: `unrelated-contact-${index}`,
      status: "pending",
    }));
    const secondDay = harness({
      contacts: [contact({ id: "repeat-contact" })],
      pendingQuests: [
        ...unrelatedPending,
        {
          id: "prior-999",
          completionType: "interaction",
          targetId: "repeat-contact",
          status: "pending",
        },
      ],
    });

    const secondBrief = await secondDay.service.generateForOwner(
      ownerId,
      new Date(now.getTime() + DAY_MS)
    );

    expect(firstBrief.quests).toHaveLength(1);
    expect(secondBrief.quests).toHaveLength(0);
    expect(firstBrief.quests.length + secondBrief.quests.length).toBe(1);
    expect(secondDay.prisma.quest.findMany).toHaveBeenCalledTimes(2);
    expect(
      secondDay.prisma.quest.findMany.mock.calls.every(
        ([args]) => args.take === 100
      )
    ).toBe(true);
    expect(secondDay.prisma.quest.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: "prior-099" },
      skip: 1,
    });
  });

  it("rechecks pending quest targets inside a serializable write transaction", async () => {
    const { service, prisma, tx } = harness({
      contacts: [contact({ id: "racing-contact" })],
      transactionPendingQuests: [
        {
          id: "racing-quest",
          completionType: "interaction",
          targetId: "racing-contact",
          status: "pending",
        },
      ],
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.quests).toHaveLength(0);
    expect(tx.quest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId,
          status: "pending",
          OR: [{ completionType: "interaction", targetId: "racing-contact" }],
        }),
      })
    );
    expect(tx.quest.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("backfills later distinct quest targets when the first four become pending", async () => {
    const dates = Array.from({ length: 5 }, (_, index) =>
      dateCandidate({
        sourceType: "reminder",
        sourceId: `reminder-${index + 1}`,
        title: `Synthetic reminder ${index + 1}`,
      })
    );
    const { service, tx } = harness({
      contacts: [
        contact({ id: "contact-a" }),
        contact({ id: "contact-b" }),
        contact({ id: "contact-c" }),
      ],
      dates,
      transactionPendingQuests: [
        {
          id: "racing-contact-a",
          completionType: "interaction",
          targetId: "contact-a",
        },
        {
          id: "racing-contact-b",
          completionType: "interaction",
          targetId: "contact-b",
        },
        {
          id: "racing-contact-c",
          completionType: "interaction",
          targetId: "contact-c",
        },
        {
          id: "racing-reminder-1",
          completionType: "reminder",
          targetId: "reminder-1",
        },
      ],
    });

    const result = await service.generateForOwner(ownerId, now);

    expect(result.quests).toHaveLength(4);
    expect(result.quests.map((quest) => quest.itemId)).toEqual([
      "item-5",
      "item-6",
      "item-7",
      "item-8",
    ]);
    expect(
      tx.quest.create.mock.calls.map(([args]) => args.data.targetId)
    ).toEqual(["reminder-2", "reminder-3", "reminder-4", "reminder-5"]);
    expect(tx.quest.findMany.mock.calls[0][0].where.OR).toHaveLength(8);
  });

  it("propagates a mid-generation failure without finalizing the batch", async () => {
    const { service, tx } = harness({
      contacts: [contact({ id: "contact-1" })],
    });
    tx.briefItem.create.mockRejectedValueOnce(
      new Error("synthetic item failure")
    );

    await expect(service.generateForOwner(ownerId, now)).rejects.toThrow(
      "synthetic item failure"
    );

    expect(tx.briefBatch.create).toHaveBeenCalled();
    expect(tx.quest.create).not.toHaveBeenCalled();
    expect(tx.briefBatch.update).not.toHaveBeenCalled();
  });

  it("returns the winning ready brief after a P2002 conflict", async () => {
    const conflict = Object.assign(new Error("unique conflict"), {
      code: "P2002",
    });
    const winner = readyBatch();
    const { service, prisma } = harness({ transactionError: conflict });
    prisma.briefBatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    const result = await service.generateForOwner(ownerId, now);

    expect(result.briefId).toBe("ready-brief");
    expect(prisma.briefBatch.findUnique).toHaveBeenCalledTimes(2);
  });

  it("fully replans after a P2034 serialization loser observes the winner", async () => {
    const serializationConflict = Object.assign(
      new Error("serialization conflict"),
      { code: "P2034" }
    );
    const { service, prisma, importantDates, tx } = harness({
      contacts: [contact({ id: "winner-contact" })],
    });
    prisma.$transaction.mockRejectedValueOnce(serializationConflict);
    prisma.quest.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: "winner-quest",
        completionType: "interaction",
        targetId: "winner-contact",
      },
    ]);

    const result = await service.generateForOwner(ownerId, now);

    expect(result.quests).toHaveLength(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.briefBatch.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(2);
    expect(importantDates.collect).toHaveBeenCalledTimes(2);
    expect(prisma.quest.findMany).toHaveBeenCalledTimes(2);
    expect(tx.quest.create).not.toHaveBeenCalled();
  });

  it("stops after the bounded P2034 retry budget is exhausted", async () => {
    const serializationConflict = Object.assign(
      new Error("persistent serialization conflict"),
      { code: "P2034" }
    );
    const { service, prisma, importantDates } = harness({
      contacts: [contact({ id: "retry-contact" })],
    });
    prisma.$transaction.mockRejectedValue(serializationConflict);

    await expect(service.generateForOwner(ownerId, now)).rejects.toBe(
      serializationConflict
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(3);
    expect(importantDates.collect).toHaveBeenCalledTimes(3);
  });

  it("returns an existing ready brief without writes or candidate queries", async () => {
    const { service, prisma, importantDates } = harness({
      existing: readyBatch(),
    });

    const first = await service.generateForOwner(ownerId, now);
    const second = await service.generateForOwner(ownerId, now);

    expect(second).toEqual(first);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
    expect(importantDates.collect).not.toHaveBeenCalled();
  });

  it("returns a byte-equivalent persisted brief on a retry after generation", async () => {
    const { service, prisma, tx, importantDates } = harness({
      contacts: [contact({ id: "contact-1" })],
    });

    const first = await service.generateForOwner(ownerId, now);
    const persisted = await tx.briefBatch.update.mock.results[0].value;
    prisma.briefBatch.findUnique.mockResolvedValue(persisted);
    const second = await service.generateForOwner(ownerId, now);

    expect(second).toEqual(first);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(1);
    expect(importantDates.collect).toHaveBeenCalledTimes(1);
  });

  it("recovers a visible generating batch inside the replacement transaction", async () => {
    const generating = readyBatch({ status: "generating", generatedAt: null });
    const { service, tx } = harness({ existing: generating });

    await service.generateForOwner(ownerId, now);

    expect(tx.briefBatch.deleteMany).toHaveBeenCalledWith({
      where: { id: "ready-brief", ownerId, status: "generating" },
    });
    expect(tx.briefBatch.create).toHaveBeenCalled();
  });

  it("retrieves only a ready brief without starting a transaction", async () => {
    const { service, prisma } = harness({ existing: readyBatch() });

    const result = await service.getReadyForOwner(ownerId, now);

    expect(result?.briefId).toBe("ready-brief");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("returns null for a visible non-ready batch without writing", async () => {
    const { service, prisma } = harness({
      existing: readyBatch({ status: "generating", generatedAt: null }),
    });

    await expect(service.getReadyForOwner(ownerId, now)).resolves.toBeNull();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
