import type { PrismaService } from "../prisma/prisma.service.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import { GamificationService } from "./gamification.service.js";

describe("GamificationService demo exclusion", () => {
  it("excludes demo contacts and their interactions from stats", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "synthetic-owner",
          name: "Synthetic",
          email: "synthetic@example.test",
          xp: 0,
          level: 1,
          _count: { contacts: 0, interactions: 0 },
        }),
      },
    };
    const service = new GamificationService(
      prisma as unknown as PrismaService,
      {} as NotificationsService
    );

    await service.getStats("synthetic-owner");

    expect(
      prisma.user.findUnique.mock.calls[0][0].select._count.select
    ).toEqual({
      contacts: { where: { isDemo: false } },
      interactions: { where: { contact: { isDemo: false } } },
    });
  });

  it("excludes demo contact activity from achievement counts", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          _count: { contacts: 0, interactions: 0 },
          achievements: [],
        }),
      },
    };
    const service = new GamificationService(
      prisma as unknown as PrismaService,
      {} as NotificationsService
    );

    await service.checkAchievements("synthetic-owner");

    expect(
      prisma.user.findUnique.mock.calls[0][0].include._count.select
    ).toEqual({
      contacts: { where: { isDemo: false } },
      interactions: { where: { contact: { isDemo: false } } },
    });
  });
});

describe("GamificationService interaction reward notifications", () => {
  it("sends persisted achievement metadata and the committed level name", async () => {
    const notifications = {
      sendGamificationAchievement: jest.fn().mockResolvedValue({ results: [] }),
      sendGamificationLevelUp: jest.fn().mockResolvedValue({ results: [] }),
    };
    const service = new GamificationService(
      {} as PrismaService,
      notifications as unknown as NotificationsService
    );

    await service.notifyInteractionRewards("synthetic-owner", {
      achievements: [
        {
          name: "First Interaction",
          description: "Persisted first interaction description",
          xpReward: 50,
        },
      ],
      previousLevel: 4,
      newLevel: 5,
    });

    expect(notifications.sendGamificationAchievement).toHaveBeenCalledWith(
      "synthetic-owner",
      {
        name: "First Interaction",
        description: "Persisted first interaction description",
        xpReward: 50,
      }
    );
    expect(notifications.sendGamificationLevelUp).toHaveBeenCalledWith(
      "synthetic-owner",
      5,
      "Connector"
    );
  });

  it("isolates achievement and level notification failures", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const notifications = {
      sendGamificationAchievement: jest
        .fn()
        .mockRejectedValue(new Error("achievement notification failed")),
      sendGamificationLevelUp: jest
        .fn()
        .mockRejectedValue(new Error("level notification failed")),
    };
    const service = new GamificationService(
      {} as PrismaService,
      notifications as unknown as NotificationsService
    );

    await expect(
      service.notifyInteractionRewards("synthetic-owner", {
        achievements: [
          {
            name: "Prolific",
            description: "Persisted prolific description",
            xpReward: 5000,
          },
        ],
        previousLevel: 7,
        newLevel: 8,
      })
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
