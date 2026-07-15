import type { PrismaService } from "../../prisma/prisma.service.js";
import * as relationshipHealth from "../../briefs/relationship-health.js";
import { RelationshipAgent } from "./relationship-agent.js";

const userId = "synthetic-owner";
const now = new Date("2026-07-16T12:00:00Z");

describe("RelationshipAgent", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("excludes demos and assesses each contact with its own cadence", async () => {
    const contact = {
      id: "contact-1",
      firstName: "Synthetic",
      lastName: "Person",
      company: null,
      birthday: null,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      lastContactedAt: new Date("2026-06-16T12:00:00Z"),
      preferredCadenceDays: 30,
      relationshipScore: 90,
      _count: { interactions: 1 },
    };
    const prisma = {
      contact: { findMany: jest.fn().mockResolvedValue([contact]) },
    };
    const assessSpy = jest.spyOn(relationshipHealth, "assessRelationship");
    const agent = new RelationshipAgent(prisma as unknown as PrismaService);

    const result = await agent.getRecommendations({ userId });

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: userId, isDemo: false }),
      })
    );
    expect(assessSpy).toHaveBeenCalledWith({
      now,
      lastContactedAt: contact.lastContactedAt,
      preferredCadenceDays: 30,
    });
    expect(result.data?.[0]).toMatchObject({
      contactId: contact.id,
      daysSinceContact: 30,
      priority: "medium",
    });
  });

  it("includes newly imported contacts that have never been contacted", async () => {
    const contact = {
      id: "newly-imported-contact",
      firstName: "Synthetic",
      lastName: "Import",
      company: null,
      birthday: null,
      createdAt: now,
      importedAt: now,
      lastContactedAt: null,
      preferredCadenceDays: 90,
      relationshipScore: 50,
      _count: { interactions: 0 },
    };
    const prisma = {
      contact: { findMany: jest.fn().mockResolvedValue([contact]) },
    };
    const assessSpy = jest.spyOn(relationshipHealth, "assessRelationship");
    const agent = new RelationshipAgent(prisma as unknown as PrismaService);

    const result = await agent.getRecommendations({ userId });

    expect(prisma.contact.findMany.mock.calls[0][0].where.OR).toContainEqual({
      lastContactedAt: null,
    });
    expect(assessSpy).toHaveBeenCalledWith({
      now,
      lastContactedAt: null,
      preferredCadenceDays: 90,
    });
    expect(result.data?.[0]).toMatchObject({
      contactId: contact.id,
      reason: "No interaction has been recorded yet.",
      priority: "medium",
    });
  });

  it("refreshes shared health scores but never updates demos", async () => {
    const prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "demo-contact",
            isDemo: true,
            lastContactedAt: null,
            preferredCadenceDays: 30,
            relationshipScore: 50,
          },
          {
            id: "real-contact",
            isDemo: false,
            lastContactedAt: new Date("2026-06-16T12:00:00Z"),
            preferredCadenceDays: 30,
            relationshipScore: 90,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const agent = new RelationshipAgent(prisma as unknown as PrismaService);

    const result = await agent.refreshScores(userId);

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: userId, isDemo: false },
      })
    );
    expect(prisma.contact.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "real-contact",
        ownerId: userId,
        isDemo: false,
      },
      data: { relationshipScore: 50 },
    });
    expect(result.data).toEqual({ updated: 1 });
  });
});
