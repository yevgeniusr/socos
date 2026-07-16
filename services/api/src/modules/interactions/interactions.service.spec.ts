import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GamificationService } from "../gamification/gamification.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { InteractionType } from "./interactions.dto.js";
import { InteractionsService } from "./interactions.service.js";

const ownerId = "owner-synthetic";
const contactId = "contact-synthetic";
const now = new Date("2026-07-16T12:00:00.000Z");
const input = {
  contactId,
  type: InteractionType.CALL,
  title: "Catch up",
  content: "Discussed project status",
  occurredAt: now.toISOString(),
};

function harness(
  contact: {
    id: string;
    ownerId: string;
    isDemo: boolean;
    lastContactedAt?: Date | null;
  } | null = {
    id: contactId,
    ownerId,
    isDemo: false,
    lastContactedAt: null,
  }
) {
  const tx = {
    contact: {
      findFirst: jest.fn().mockResolvedValue(contact),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    interaction: {
      create: jest.fn().mockResolvedValue({
        id: "interaction-synthetic",
        contactId,
        type: InteractionType.CALL,
        title: "Catch up",
        occurredAt: now,
        xpEarned: 10,
      }),
      count: jest.fn().mockResolvedValue(2),
    },
    achievement: {
      upsert: jest.fn().mockResolvedValue({
        id: "achievement-first",
        xpReward: 50,
      }),
    },
    userAchievement: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    xpTransaction: {
      create: jest.fn().mockResolvedValue({ id: "xp-synthetic" }),
    },
    user: {
      update: jest.fn().mockResolvedValue({ xp: 110, level: 2 }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  const gamification = {
    calculateInteractionXp: jest.fn().mockResolvedValue(10),
    checkLevelUp: jest.fn(),
    checkAchievements: jest.fn(),
    notifyInteractionRewards: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InteractionsService(
    prisma as unknown as PrismaService,
    gamification as unknown as GamificationService
  );
  return { gamification, prisma, service, tx };
}

describe("InteractionsService agent commands", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("atomically records interaction, contact activity, XP evidence, and user activity", async () => {
    const { gamification, prisma, service, tx } = harness();

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual({
      interactionId: "interaction-synthetic",
      contactId,
      type: InteractionType.CALL,
      occurredAt: now,
      xpAwarded: 10,
      totalXp: 110,
      level: 2,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { id: contactId, ownerId, isDemo: false },
      select: {
        id: true,
        ownerId: true,
        isDemo: true,
      },
    });
    expect(gamification.calculateInteractionXp).toHaveBeenCalledWith(
      InteractionType.CALL
    );
    expect(tx.interaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId,
        ownerId,
        type: InteractionType.CALL,
        occurredAt: now,
        xpEarned: 10,
      }),
      select: {
        id: true,
        contactId: true,
        type: true,
        title: true,
        occurredAt: true,
        xpEarned: true,
      },
    });
    expect(tx.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: contactId,
        ownerId,
        isDemo: false,
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: now } }],
      },
      data: { lastContactedAt: now },
    });
    expect(tx.xpTransaction.create).toHaveBeenCalledWith({
      data: {
        ownerId,
        amount: 10,
        sourceType: "interaction",
        sourceId: "interaction-synthetic",
      },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: ownerId },
      data: { xp: { increment: 10 }, lastActiveAt: now },
      select: { xp: true, level: true },
    });
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
    expect(gamification.notifyInteractionRewards).not.toHaveBeenCalled();
  });

  it("unlocks first_interaction and awards its XP with distinct evidence", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue({ xp: 160, level: 2 });

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual(
      expect.objectContaining({ xpAwarded: 10, totalXp: 160, level: 2 })
    );

    expect(tx.interaction.count).toHaveBeenCalledWith({
      where: {
        ownerId,
        contact: { ownerId, isDemo: false },
      },
    });
    expect(tx.achievement.upsert).toHaveBeenCalledWith({
      where: { code: "first_interaction" },
      update: {},
      create: {
        code: "first_interaction",
        name: "First Interaction",
        description: "You logged 1 interactions!",
        xpReward: 50,
        requirement: JSON.stringify({
          type: "count",
          target: 1,
          object: "interactions",
        }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        xpReward: true,
      },
    });
    expect(tx.userAchievement.createMany).toHaveBeenCalledWith({
      data: [{ userId: ownerId, achievementId: "achievement-first" }],
      skipDuplicates: true,
    });
    expect(tx.xpTransaction.create).toHaveBeenNthCalledWith(2, {
      data: {
        ownerId,
        amount: 50,
        sourceType: "achievement",
        sourceId: "achievement-first",
      },
    });
    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: ownerId },
      data: { xp: { increment: 60 }, lastActiveAt: now },
      select: { xp: true, level: true },
    });
  });

  it("unlocks prolific without re-awarding first_interaction", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(100);
    tx.achievement.upsert
      .mockResolvedValueOnce({ id: "achievement-first", xpReward: 50 })
      .mockResolvedValueOnce({ id: "achievement-prolific", xpReward: 5000 });
    tx.userAchievement.createMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    tx.user.update.mockResolvedValue({ xp: 5410, level: 8 });

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual(expect.objectContaining({ totalXp: 5410, level: 8 }));

    expect(tx.achievement.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { code: "prolific" },
        create: expect.objectContaining({
          code: "prolific",
          name: "Prolific",
          xpReward: 5000,
        }),
      })
    );
    expect(tx.xpTransaction.create).toHaveBeenCalledTimes(2);
    expect(tx.xpTransaction.create).toHaveBeenNthCalledWith(2, {
      data: {
        ownerId,
        amount: 5000,
        sourceType: "achievement",
        sourceId: "achievement-prolific",
      },
    });
    expect(tx.user.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { xp: { increment: 5010 }, lastActiveAt: now },
      })
    );
  });

  it("does not award achievement XP when the achievement is already unlocked", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 0 });

    await service.createForAgent(ownerId, input, tx as never);

    expect(tx.userAchievement.createMany).toHaveBeenCalledWith({
      data: [{ userId: ownerId, achievementId: "achievement-first" }],
      skipDuplicates: true,
    });
    expect(tx.xpTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: { xp: { increment: 10 }, lastActiveAt: now },
      })
    );
  });

  it("rejects achievement evidence collisions before incrementing any XP", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 1 });
    tx.xpTransaction.create
      .mockResolvedValueOnce({ id: "xp-interaction" })
      .mockRejectedValueOnce(
        Object.assign(new Error("duplicate achievement evidence"), {
          code: "P2002",
        })
      );

    await expect(service.createForAgent(ownerId, input)).rejects.toMatchObject({
      code: "P2002",
    });

    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("computes the final level only after interaction and achievement XP", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 1 });
    tx.user.update
      .mockResolvedValueOnce({ xp: 400, level: 2 })
      .mockResolvedValueOnce({ xp: 400, level: 3 });

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual(expect.objectContaining({ totalXp: 400, level: 3 }));

    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: ownerId },
      data: { xp: { increment: 60 }, lastActiveAt: now },
      select: { xp: true, level: true },
    });
    expect(tx.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: ownerId },
      data: { level: 3 },
      select: { xp: true, level: true },
    });
  });

  it("rejects a late level write after achievement writes so all can roll back", async () => {
    const { service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 1 });
    tx.user.update
      .mockResolvedValueOnce({ xp: 400, level: 2 })
      .mockRejectedValueOnce(new Error("level update failed"));

    await expect(service.createForAgent(ownerId, input)).rejects.toThrow(
      "level update failed"
    );

    expect(tx.userAchievement.createMany).toHaveBeenCalledTimes(1);
    expect(tx.xpTransaction.create).toHaveBeenCalledTimes(2);
  });

  it("opens a serializable transaction when the caller does not supply one", async () => {
    const { prisma, service } = harness();

    await service.createForAgent(ownerId, input);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("keeps a newer contact timestamp when backfilling an older interaction", async () => {
    const existingContactAt = new Date("2026-07-16T10:00:00.000Z");
    const occurredAt = new Date("2026-07-15T08:00:00.000Z");
    const { service, tx } = harness({
      id: contactId,
      ownerId,
      isDemo: false,
      lastContactedAt: existingContactAt,
    });
    tx.interaction.create.mockResolvedValue({
      id: "interaction-synthetic",
      contactId,
      type: InteractionType.CALL,
      title: "Catch up",
      occurredAt,
      xpEarned: 10,
    });
    tx.contact.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createForAgent(
        ownerId,
        { ...input, occurredAt: occurredAt.toISOString() },
        tx as never
      )
    ).resolves.toEqual(expect.objectContaining({ occurredAt }));

    expect(tx.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastContactedAt: null },
            { lastContactedAt: { lt: occurredAt } },
          ],
        }),
        data: { lastContactedAt: occurredAt },
      })
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { xp: { increment: 10 }, lastActiveAt: now },
      })
    );
  });

  it("advances contact chronology to a newer interaction event time", async () => {
    const existingContactAt = new Date("2026-07-14T08:00:00.000Z");
    const occurredAt = new Date("2026-07-15T08:00:00.000Z");
    const { service, tx } = harness({
      id: contactId,
      ownerId,
      isDemo: false,
      lastContactedAt: existingContactAt,
    });
    tx.interaction.create.mockResolvedValue({
      id: "interaction-synthetic",
      contactId,
      type: InteractionType.CALL,
      title: "Catch up",
      occurredAt,
      xpEarned: 10,
    });

    await service.createForAgent(
      ownerId,
      { ...input, occurredAt: occurredAt.toISOString() },
      tx as never
    );

    expect(tx.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastContactedAt: null },
            { lastContactedAt: { lt: occurredAt } },
          ],
        }),
        data: { lastContactedAt: occurredAt },
      })
    );
  });

  it("persists the existing level formula exactly when XP reaches a threshold", async () => {
    const { gamification, service, tx } = harness();
    tx.user.update
      .mockResolvedValueOnce({ xp: 400, level: 2 })
      .mockResolvedValueOnce({ xp: 400, level: 3 });

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual(expect.objectContaining({ totalXp: 400, level: 3 }));

    expect(tx.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: ownerId },
      data: { level: 3 },
      select: { xp: true, level: true },
    });
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
  });

  it("rejects a late level write so the surrounding transaction can roll back", async () => {
    const { gamification, service, tx } = harness();
    tx.user.update
      .mockResolvedValueOnce({ xp: 400, level: 2 })
      .mockRejectedValueOnce(new Error("level update failed"));

    await expect(service.createForAgent(ownerId, input)).rejects.toThrow(
      "level update failed"
    );

    expect(tx.xpTransaction.create).toHaveBeenCalledTimes(1);
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-owner", { id: contactId, ownerId: "owner-foreign", isDemo: false }],
    ["demo", { id: contactId, ownerId, isDemo: true }],
  ])("rejects a %s contact before writes", async (_label, contact) => {
    const { service, tx } = harness(contact);

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.interaction.create).not.toHaveBeenCalled();
    expect(tx.contact.updateMany).not.toHaveBeenCalled();
    expect(tx.xpTransaction.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("rejects the command so the transaction rolls back when any write fails", async () => {
    const { service, tx } = harness();
    tx.contact.updateMany.mockRejectedValue(new Error("contact update failed"));

    await expect(service.createForAgent(ownerId, input)).rejects.toThrow(
      "contact update failed"
    );
    expect(tx.interaction.create).toHaveBeenCalled();
    expect(tx.xpTransaction.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("cannot increment XP twice when concurrent evidence collides", async () => {
    const { service, tx } = harness();
    tx.xpTransaction.create
      .mockResolvedValueOnce({ id: "xp-synthetic" })
      .mockRejectedValueOnce(
        Object.assign(new Error("duplicate evidence"), { code: "P2002" })
      );

    await service.createForAgent(ownerId, input);
    await expect(service.createForAgent(ownerId, input)).rejects.toMatchObject({
      code: "P2002",
    });

    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });
});

describe("InteractionsService human commands", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("uses the serializable interaction transaction and preserves the REST response", async () => {
    const { gamification, prisma, service, tx } = harness();

    await expect(service.create(ownerId, input)).resolves.toEqual({
      interaction: {
        id: "interaction-synthetic",
        type: InteractionType.CALL,
        title: "Catch up",
        occurredAt: now,
        xpEarned: 10,
      },
      user: {
        xp: 110,
        level: 2,
        xpToNextLevel: 400,
      },
      newAchievements: [],
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.interaction.create).toHaveBeenCalledTimes(1);
    expect(tx.contact.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.xpTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
  });

  it("notifies from committed achievement metadata and the actual level transition", async () => {
    const { gamification, prisma, service, tx } = harness();
    tx.interaction.count.mockResolvedValue(1);
    tx.achievement.upsert.mockResolvedValue({
      id: "achievement-first",
      name: "First Interaction",
      description: "Persisted first interaction description",
      xpReward: 50,
    });
    tx.userAchievement.createMany.mockResolvedValue({ count: 1 });
    tx.user.update
      .mockResolvedValueOnce({ xp: 400, level: 2 })
      .mockResolvedValueOnce({ xp: 400, level: 3 });

    await expect(service.create(ownerId, input)).resolves.toEqual({
      interaction: {
        id: "interaction-synthetic",
        type: InteractionType.CALL,
        title: "Catch up",
        occurredAt: now,
        xpEarned: 10,
      },
      user: {
        xp: 400,
        level: 3,
        xpToNextLevel: 900,
      },
      newAchievements: ["First Interaction"],
    });

    expect(gamification.notifyInteractionRewards).toHaveBeenCalledWith(
      ownerId,
      {
        achievements: [
          {
            name: "First Interaction",
            description: "Persisted first interaction description",
            xpReward: 50,
          },
        ],
        previousLevel: 2,
        newLevel: 3,
      }
    );
    expect(
      prisma.$transaction.mock.invocationCallOrder[0]
    ).toBeLessThan(
      gamification.notifyInteractionRewards.mock.invocationCallOrder[0]
    );
  });

  it("does not notify when the human transaction rolls back", async () => {
    const { gamification, service, tx } = harness();
    tx.user.update.mockRejectedValue(new Error("user update failed"));

    await expect(service.create(ownerId, input)).rejects.toThrow(
      "user update failed"
    );

    expect(gamification.notifyInteractionRewards).not.toHaveBeenCalled();
  });

  it("keeps notification failures out of the human interaction response", async () => {
    const { gamification, service } = harness();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    gamification.notifyInteractionRewards.mockRejectedValue(
      new Error("notification failed")
    );

    await expect(service.create(ownerId, input)).resolves.toEqual(
      expect.objectContaining({
        interaction: expect.objectContaining({
          id: "interaction-synthetic",
        }),
      })
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to send interaction reward notifications:",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it.each([
    ["cross-owner", { id: contactId, ownerId: "owner-foreign", isDemo: false }],
    ["demo", { id: contactId, ownerId, isDemo: true }],
  ])("rejects a %s contact before human writes", async (_label, contact) => {
    const { service, tx } = harness(contact);

    await expect(service.create(ownerId, input)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(tx.interaction.create).not.toHaveBeenCalled();
    expect(tx.contact.updateMany).not.toHaveBeenCalled();
    expect(tx.xpTransaction.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("uses the actual historical event time for contact chronology", async () => {
    const occurredAt = new Date("2026-07-15T08:00:00.000Z");
    const { service, tx } = harness();
    tx.interaction.create.mockResolvedValue({
      id: "interaction-synthetic",
      contactId,
      type: InteractionType.CALL,
      title: "Catch up",
      occurredAt,
      xpEarned: 10,
    });

    await service.create(ownerId, {
      ...input,
      occurredAt: occurredAt.toISOString(),
    });

    expect(tx.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastContactedAt: null },
            { lastContactedAt: { lt: occurredAt } },
          ],
        }),
        data: { lastContactedAt: occurredAt },
      })
    );
  });
});
