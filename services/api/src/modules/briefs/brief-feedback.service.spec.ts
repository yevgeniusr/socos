import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { BriefFeedbackService } from "./brief-feedback.service.js";

const ownerId = "owner-synthetic";
const now = new Date("2026-07-16T12:00:00.000Z");

type StoredFeedback = {
  id: string;
  ownerId: string;
  briefItemId: string | null;
  questId: string | null;
  action: string;
  reason: string | null;
  snoozedUntil: Date | null;
  idempotencyKey: string;
  requestHash: string;
  createdAt: Date;
};

function createItemHarness(initialStatus = "pending") {
  const item = {
    id: "item-synthetic",
    ownerId,
    status: initialStatus,
    snoozedUntil:
      initialStatus === "snoozed" ? new Date("2026-07-17T12:00:00.000Z") : null,
    actionedAt: null as Date | null,
  };
  const feedback: StoredFeedback[] = [];
  const userUpdate = jest.fn();
  const xpCreate = jest.fn();

  const transactionClient = {
    briefItem: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === item.id && where.ownerId === item.ownerId ? item : null
      ),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(item, data);
        return item;
      }),
    },
    briefFeedback: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.ownerId_idempotencyKey;
        return (
          feedback.find(
            (entry) =>
              entry.ownerId === key.ownerId &&
              entry.idempotencyKey === key.idempotencyKey
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const stored = {
          id: `feedback-${feedback.length + 1}`,
          createdAt: now,
          reason: null,
          snoozedUntil: null,
          questId: null,
          briefItemId: null,
          ...data,
        } as StoredFeedback;
        feedback.push(stored);
        return stored;
      }),
    },
    user: { update: userUpdate },
    xpTransaction: { create: xpCreate },
  };
  const prisma = {
    ...transactionClient,
    $transaction: jest.fn(async (callback: any) => callback(transactionClient)),
  };

  return {
    feedback,
    item,
    prisma,
    service: new BriefFeedbackService(prisma as unknown as PrismaService),
    transactionClient,
    userUpdate,
    xpCreate,
  };
}

describe("BriefFeedbackService item feedback", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(["pending", "snoozed"])(
    "accepts an owner-scoped %s item atomically without awarding XP",
    async (initialStatus) => {
      const harness = createItemHarness(initialStatus);

      const result = await harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        "feedback:key-001",
        { action: "accept" }
      );

      expect(result).toEqual({
        feedbackId: "feedback-1",
        itemId: harness.item.id,
        action: "accept",
        status: "accepted",
        reason: null,
        snoozedUntil: null,
      });
      expect(harness.prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "Serializable" }
      );
      expect(harness.transactionClient.briefItem.update).toHaveBeenCalledWith({
        where: { id_ownerId: { id: harness.item.id, ownerId } },
        data: {
          status: "accepted",
          actionedAt: now,
          snoozedUntil: null,
        },
      });
      expect(
        harness.transactionClient.briefFeedback.create
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId,
          briefItemId: harness.item.id,
          action: "accept",
          idempotencyKey: "feedback:key-001",
          requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
      expect(harness.userUpdate).not.toHaveBeenCalled();
      expect(harness.xpCreate).not.toHaveBeenCalled();
    }
  );

  it("snoozes only until an ISO timestamp within the next 90 days", async () => {
    const harness = createItemHarness();
    const snoozedUntil = "2026-08-01T09:30:00.000Z";

    const result = await harness.service.recordItemFeedback(
      ownerId,
      harness.item.id,
      "feedback:key-002",
      { action: "snooze", snoozedUntil }
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "snooze",
        status: "snoozed",
        snoozedUntil: new Date(snoozedUntil),
      })
    );
    expect(harness.item).toEqual(
      expect.objectContaining({
        status: "snoozed",
        snoozedUntil: new Date(snoozedUntil),
      })
    );
  });

  it.each([
    ["", "missing"],
    ["not-a-date", "malformed"],
    ["2026-07-16T11:59:59.999Z", "past"],
    ["2026-10-15T12:00:00.001Z", "more than 90 days ahead"],
  ])("rejects a %s snooze timestamp (%s)", async (snoozedUntil) => {
    const harness = createItemHarness();

    await expect(
      harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        "feedback:key-003",
        { action: "snooze", snoozedUntil }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dismisses with an optional reason of at most 500 characters", async () => {
    const harness = createItemHarness();

    const result = await harness.service.recordItemFeedback(
      ownerId,
      harness.item.id,
      "feedback:key-004",
      { action: "dismiss", reason: "Synthetic reason" }
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: "dismiss",
        status: "dismissed",
        reason: "Synthetic reason",
      })
    );

    await expect(
      createItemHarness().service.recordItemFeedback(
        ownerId,
        "item-synthetic",
        "feedback:key-005",
        { action: "dismiss", reason: "x".repeat(501) }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns not found rather than exposing an item owned by another user", async () => {
    const harness = createItemHarness();

    await expect(
      harness.service.recordItemFeedback(
        "owner-foreign",
        harness.item.id,
        "feedback:key-006",
        { action: "accept" }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.transactionClient.briefItem.update).not.toHaveBeenCalled();
  });

  it("returns the original result for the same key and canonical request", async () => {
    const harness = createItemHarness();
    const request = [
      ownerId,
      harness.item.id,
      "feedback:key-007",
      { action: "dismiss" as const, reason: "Same request" },
    ] as const;

    const first = await harness.service.recordItemFeedback(...request);
    const retry = await harness.service.recordItemFeedback(...request);

    expect(retry).toEqual(first);
    expect(
      harness.transactionClient.briefFeedback.create
    ).toHaveBeenCalledTimes(1);
    expect(harness.transactionClient.briefItem.update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["item-other", { action: "dismiss", reason: "Original" }],
    ["item-synthetic", { action: "accept" }],
    ["item-synthetic", { action: "dismiss", reason: "Changed" }],
  ])(
    "rejects reuse of a key with a different resource, action, or body",
    async (itemId, dto) => {
      const harness = createItemHarness();
      await harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        "feedback:key-008",
        { action: "dismiss", reason: "Original" }
      );

      await expect(
        harness.service.recordItemFeedback(
          ownerId,
          itemId,
          "feedback:key-008",
          dto as any
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        harness.transactionClient.briefFeedback.create
      ).toHaveBeenCalledTimes(1);
      expect(harness.transactionClient.briefItem.update).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it.each(["short", "contains space", "x".repeat(129)])(
    "rejects an invalid idempotency key",
    async (idempotencyKey) => {
      const harness = createItemHarness();

      await expect(
        harness.service.recordItemFeedback(
          ownerId,
          harness.item.id,
          idempotencyKey,
          { action: "accept" }
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing idempotency key before opening a transaction", async () => {
    const harness = createItemHarness();

    await expect(
      harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        undefined as any,
        { action: "accept" }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects action-specific and unknown fields at the service boundary", async () => {
    const harness = createItemHarness();

    await expect(
      harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        "feedback:key-009",
        { action: "accept", xpReward: 999 } as any
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      harness.service.recordItemFeedback(
        ownerId,
        harness.item.id,
        "feedback:key-010",
        { action: "accept", reason: "not accepted here" } as any
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function createQuestHarness(
  completionType: "interaction" | "reminder" = "interaction"
) {
  const quest = {
    id: "quest-synthetic",
    ownerId,
    targetId:
      completionType === "interaction"
        ? "contact-synthetic"
        : "reminder-synthetic",
    completionType,
    xpReward: completionType === "interaction" ? 15 : 20,
    status: "pending",
    completedAt: null as Date | null,
    createdAt: new Date("2026-07-15T12:00:00.000Z"),
  };
  const interaction = {
    id: "interaction-synthetic",
    ownerId,
    contactId: "contact-synthetic",
    occurredAt: new Date("2026-07-16T08:00:00.000Z"),
  };
  const reminder = {
    id: "reminder-synthetic",
    ownerId,
    status: "completed",
    completedAt: new Date("2026-07-16T08:00:00.000Z"),
  };
  const feedback: StoredFeedback[] = [];
  const xpTransactions: Array<{
    id: string;
    ownerId: string;
    amount: number;
    sourceType: string;
    sourceId: string;
  }> = [];
  let userXp = 0;

  const transactionClient = {
    briefFeedback: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.ownerId_idempotencyKey;
        return (
          feedback.find(
            (entry) =>
              entry.ownerId === key.ownerId &&
              entry.idempotencyKey === key.idempotencyKey
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const stored = {
          id: `feedback-${feedback.length + 1}`,
          createdAt: now,
          reason: null,
          snoozedUntil: null,
          questId: null,
          briefItemId: null,
          ...data,
        } as StoredFeedback;
        feedback.push(stored);
        return stored;
      }),
    },
    quest: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === quest.id && where.ownerId === quest.ownerId ? quest : null
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (
          where.id !== quest.id ||
          where.ownerId !== quest.ownerId ||
          where.status !== quest.status
        ) {
          return { count: 0 };
        }
        Object.assign(quest, data);
        return { count: 1 };
      }),
    },
    interaction: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (
          where.id !== interaction.id ||
          where.ownerId !== interaction.ownerId ||
          where.contactId !== interaction.contactId ||
          interaction.occurredAt < where.occurredAt.gte
        ) {
          return null;
        }
        return interaction;
      }),
    },
    reminder: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (
          where.id !== reminder.id ||
          where.ownerId !== reminder.ownerId ||
          where.status !== reminder.status ||
          reminder.completedAt === null ||
          reminder.completedAt < where.completedAt.gte
        ) {
          return null;
        }
        return reminder;
      }),
    },
    xpTransaction: {
      findUnique: jest.fn(async ({ where }: any) => {
        const key = where.ownerId_sourceType_sourceId;
        return (
          xpTransactions.find(
            (entry) =>
              entry.ownerId === key.ownerId &&
              entry.sourceType === key.sourceType &&
              entry.sourceId === key.sourceId
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const stored = {
          id: `xp-${xpTransactions.length + 1}`,
          ...data,
        };
        xpTransactions.push(stored);
        return stored;
      }),
    },
    user: {
      update: jest.fn(async ({ data }: any) => {
        userXp += data.xp.increment;
        return { id: ownerId, xp: userXp, lastActiveAt: data.lastActiveAt };
      }),
    },
  };

  const prisma = {
    ...transactionClient,
    $transaction: jest.fn(async (callback: any) => callback(transactionClient)),
  };

  return {
    feedback,
    interaction,
    prisma,
    quest,
    reminder,
    service: new BriefFeedbackService(prisma as unknown as PrismaService),
    transactionClient,
    xpTransactions,
    userXp: () => userXp,
  };
}

describe("BriefFeedbackService quest completion", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("verifies an owner-scoped target interaction and awards server-owned XP in one transaction", async () => {
    const harness = createQuestHarness("interaction");

    const result = await harness.service.completeQuest(
      ownerId,
      harness.quest.id,
      "complete:key-001",
      { interactionId: harness.interaction.id }
    );

    expect(result).toEqual({
      feedbackId: "feedback-1",
      questId: harness.quest.id,
      status: "completed",
      completedAt: now,
      xpAwarded: 15,
    });
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    expect(
      harness.transactionClient.interaction.findFirst
    ).toHaveBeenCalledWith({
      where: {
        id: harness.interaction.id,
        ownerId,
        contactId: harness.quest.targetId,
        occurredAt: { gte: harness.quest.createdAt },
      },
    });
    expect(harness.transactionClient.quest.updateMany).toHaveBeenCalledWith({
      where: { id: harness.quest.id, ownerId, status: "pending" },
      data: { status: "completed", completedAt: now },
    });
    expect(harness.transactionClient.xpTransaction.create).toHaveBeenCalledWith(
      {
        data: {
          ownerId,
          amount: 15,
          sourceType: "quest",
          sourceId: harness.quest.id,
        },
      }
    );
    expect(harness.transactionClient.user.update).toHaveBeenCalledWith({
      where: { id: ownerId },
      data: { xp: { increment: 15 }, lastActiveAt: now },
    });
    expect(harness.transactionClient.briefFeedback.create).toHaveBeenCalledWith(
      {
        data: {
          ownerId,
          questId: harness.quest.id,
          action: "complete",
          idempotencyKey: "complete:key-001",
          requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }
    );
  });

  it("verifies the target reminder is owner-scoped, completed, and recent enough", async () => {
    const harness = createQuestHarness("reminder");

    const result = await harness.service.completeQuest(
      ownerId,
      harness.quest.id,
      "complete:key-002",
      { reminderId: harness.reminder.id }
    );

    expect(result.xpAwarded).toBe(20);
    expect(harness.transactionClient.reminder.findFirst).toHaveBeenCalledWith({
      where: {
        id: harness.quest.targetId,
        ownerId,
        status: "completed",
        completedAt: { gte: harness.quest.createdAt },
      },
    });
  });

  it.each([
    [
      "foreign interaction",
      (h: ReturnType<typeof createQuestHarness>) => {
        h.interaction.ownerId = "owner-foreign";
      },
    ],
    [
      "wrong target contact",
      (h: ReturnType<typeof createQuestHarness>) => {
        h.interaction.contactId = "contact-other";
      },
    ],
    [
      "interaction before quest creation",
      (h: ReturnType<typeof createQuestHarness>) => {
        h.interaction.occurredAt = new Date("2026-07-15T11:59:59.999Z");
      },
    ],
  ])("rejects a %s without writing XP", async (_label, mutate) => {
    const harness = createQuestHarness("interaction");
    mutate(harness);

    await expect(
      harness.service.completeQuest(
        ownerId,
        harness.quest.id,
        "complete:key-003",
        { interactionId: harness.interaction.id }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.transactionClient.quest.updateMany).not.toHaveBeenCalled();
    expect(
      harness.transactionClient.xpTransaction.create
    ).not.toHaveBeenCalled();
    expect(harness.transactionClient.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      "not completed",
      (h: ReturnType<typeof createQuestHarness>) => {
        h.reminder.status = "pending";
      },
    ],
    [
      "completed too early",
      (h: ReturnType<typeof createQuestHarness>) => {
        h.reminder.completedAt = new Date("2026-07-15T11:59:59.999Z");
      },
    ],
  ])("rejects a reminder that is %s", async (_label, mutate) => {
    const harness = createQuestHarness("reminder");
    mutate(harness);

    await expect(
      harness.service.completeQuest(
        ownerId,
        harness.quest.id,
        "complete:key-004",
        { reminderId: harness.reminder.id }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.xpTransactions).toHaveLength(0);
  });

  it("does not expose a quest owned by another user", async () => {
    const harness = createQuestHarness();

    await expect(
      harness.service.completeQuest(
        "owner-foreign",
        harness.quest.id,
        "complete:key-005",
        { interactionId: harness.interaction.id }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    {},
    {
      interactionId: "interaction-synthetic",
      reminderId: "reminder-synthetic",
    },
    { interactionId: "interaction-synthetic", xpReward: 999 },
  ])(
    "rejects ambiguous, missing, or client-owned completion inputs",
    async (dto) => {
      const harness = createQuestHarness();

      await expect(
        harness.service.completeQuest(
          ownerId,
          harness.quest.id,
          "complete:key-006",
          dto as any
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("resolves a serialization loser from committed feedback and XP ledger rows", async () => {
    const harness = createQuestHarness();
    const request = [
      ownerId,
      harness.quest.id,
      "complete:key-race",
      { interactionId: harness.interaction.id },
    ] as const;
    const committed = await harness.service.completeQuest(...request);
    harness.prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });

    const retry = await harness.service.completeQuest(...request);

    expect(retry).toEqual(committed);
    expect(harness.feedback).toHaveLength(1);
    expect(harness.xpTransactions).toHaveLength(1);
    expect(harness.userXp()).toBe(15);
  });

  it("rejects a later different-key intent with QUEST_ALREADY_COMPLETED and no writes", async () => {
    const harness = createQuestHarness();
    await harness.service.completeQuest(
      ownerId,
      harness.quest.id,
      "complete:key-008",
      { interactionId: harness.interaction.id }
    );

    let conflict: unknown;
    try {
      await harness.service.completeQuest(
        ownerId,
        harness.quest.id,
        "complete:key-009",
        { interactionId: harness.interaction.id }
      );
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: "QUEST_ALREADY_COMPLETED" })
    );
    expect(harness.feedback).toHaveLength(1);
    expect(harness.xpTransactions).toHaveLength(1);
    expect(harness.userXp()).toBe(15);
  });

  it("rejects same-key reuse with different evidence before additional writes", async () => {
    const harness = createQuestHarness();
    await harness.service.completeQuest(
      ownerId,
      harness.quest.id,
      "complete:key-010",
      { interactionId: harness.interaction.id }
    );

    await expect(
      harness.service.completeQuest(
        ownerId,
        harness.quest.id,
        "complete:key-010",
        { interactionId: "interaction-other" }
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(harness.feedback).toHaveLength(1);
    expect(harness.xpTransactions).toHaveLength(1);
  });
});
