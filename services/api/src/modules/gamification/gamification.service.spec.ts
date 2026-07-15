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
