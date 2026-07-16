import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import { AgentReadService } from "./agent-read.service.js";

const ownerId = "owner-synthetic";

function harness() {
  const prisma = {
    contact: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  const brief = { getReadyForOwner: jest.fn() };
  const dates = { collect: jest.fn() };
  const reminders = { getUpcoming: jest.fn() };
  return {
    service: new AgentReadService(
      prisma as unknown as PrismaService,
      brief as never,
      dates as never,
      reminders as never
    ),
    prisma,
    brief,
    dates,
    reminders,
  };
}

describe("AgentReadService", () => {
  it("searches only owner-scoped non-demo contacts with a least-privilege select", async () => {
    const { service, prisma } = harness();
    prisma.contact.findMany.mockResolvedValue([
      {
        id: "contact-synthetic",
        firstName: "Synthetic",
        lastName: "Person",
        company: "Example",
        jobTitle: null,
        lastContactedAt: new Date("2026-07-10T12:00:00.000Z"),
      },
    ]);

    await expect(
      service.contactsSearch(ownerId, "synthetic", 10)
    ).resolves.toEqual({
      contacts: [
        {
          id: "contact-synthetic",
          name: "Synthetic Person",
          company: "Example",
          jobTitle: null,
          lastContactedAt: "2026-07-10T12:00:00.000Z",
        },
      ],
    });
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        ownerId,
        isDemo: false,
        OR: expect.any(Array),
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      take: 10,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        jobTitle: true,
        lastContactedAt: true,
      },
    });
  });

  it("computes owner-scoped relationship health and hides private contact fields", async () => {
    const { service, prisma } = harness();
    prisma.contact.findFirst.mockResolvedValue({
      id: "contact-synthetic",
      firstName: "Synthetic",
      lastName: "Person",
      preferredCadenceDays: 10,
      lastContactedAt: new Date("2026-07-01T12:00:00.000Z"),
    });

    await expect(
      service.relationshipHealth(
        ownerId,
        "contact-synthetic",
        new Date("2026-07-16T12:00:00.000Z")
      )
    ).resolves.toEqual({
      contact: { id: "contact-synthetic", name: "Synthetic Person" },
      health: {
        score: 25,
        band: "at-risk",
        daysSinceContact: 15,
        daysOverdue: 5,
        reasonCode: "cadence_overdue",
      },
      preferredCadenceDays: 10,
      lastContactedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "contact-synthetic", ownerId, isDemo: false },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredCadenceDays: true,
        lastContactedAt: true,
      },
    });
  });

  it("does not reveal whether a demo or foreign contact exists", async () => {
    const { service, prisma } = harness();
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(
      service.relationshipHealth(ownerId, "foreign-contact", new Date())
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("derives timezone server-side for important dates", async () => {
    const { service, prisma, dates } = harness();
    prisma.user.findUnique.mockResolvedValue({ timeZone: "Asia/Dubai" });
    dates.collect.mockResolvedValue([
      {
        sourceType: "birthday",
        sourceId: "contact-synthetic",
        contactId: "contact-synthetic",
        contactName: "Synthetic Person",
        title: "Synthetic birthday",
        dateKey: "2026-07-20",
        daysAway: 4,
        reason: "Birthday in 4 days",
      },
    ]);
    const now = new Date("2026-07-16T12:00:00.000Z");

    await service.importantDates(ownerId, 14, now);

    expect(dates.collect).toHaveBeenCalledWith(ownerId, now, "Asia/Dubai", 14);
  });
});
