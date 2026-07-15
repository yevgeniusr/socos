import type { PrismaService } from "../prisma/prisma.service.js";
import { AgentsService } from "./agents.service.js";

describe("AgentsService", () => {
  it("reports the real owner-scoped non-demo contact count", async () => {
    const success = { success: true, data: [], executedAt: new Date() };
    const relationshipAgent = {
      getRecommendations: jest.fn().mockResolvedValue(success),
    };
    const reminderAgent = {
      getUpcomingReminders: jest.fn().mockResolvedValue(success),
    };
    const suggestionAgent = {
      getSuggestions: jest.fn().mockResolvedValue(success),
    };
    const prisma = { contact: { count: jest.fn().mockResolvedValue(12) } };
    const service = new AgentsService(
      relationshipAgent as never,
      reminderAgent as never,
      {} as never,
      {} as never,
      suggestionAgent as never,
      prisma as unknown as PrismaService
    );

    const result = await service.getDashboard({ userId: "synthetic-owner" });

    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: { ownerId: "synthetic-owner", isDemo: false },
    });
    expect(result.data?.stats.totalContacts).toBe(12);
  });
});
