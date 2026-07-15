import type { PrismaService } from "../../prisma/prisma.service.js";
import { SuggestionAgent } from "./suggestion-agent.js";

const userId = "synthetic-owner";

describe("SuggestionAgent", () => {
  it("excludes demo contacts from every candidate query", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ contacts: [] }) },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const agent = new SuggestionAgent(prisma as unknown as PrismaService);

    await agent.getSuggestions({ userId });
    await agent.suggestScoreImprovement({ userId });

    expect(
      prisma.user.findUnique.mock.calls[0][0].include.contacts.where
    ).toEqual({ isDemo: false });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: userId, isDemo: false }),
      })
    );
  });

  it("fails closed when the contact graph cannot support introductions", async () => {
    const prisma = {
      contact: { findMany: jest.fn() },
    };
    const agent = new SuggestionAgent(prisma as unknown as PrismaService);

    const result = await agent.suggestIntroductions({ userId });

    expect(result).toMatchObject({
      success: false,
      data: [],
      error: "INSUFFICIENT_GRAPH_DATA",
    });
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });
});
