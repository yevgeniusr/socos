import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ContactEnrichmentService } from "./contact-enrichment.service.js";
import { normalizeCandidateValue } from "./contact-enrichment.validation.js";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-synthetic",
    ownerId: "owner-synthetic",
    contactId: "contact-synthetic",
    fieldName: "company",
    proposedValue: "Synthetic Labs",
    sourceKind: "second_brain",
    sourceLocator: "people/synthetic-person.md",
    sourceReference: "frontmatter: company",
    sourceRetrievedAt: new Date("2026-07-18T10:00:00.000Z"),
    confidence: 0.98,
    matchRationale: "Exact full-name match and explicitly labeled field.",
    status: "pending",
    contentHash: "a".repeat(64),
    decidedAt: null,
    appliedAt: null,
    createdAt: new Date("2026-07-18T10:00:00.000Z"),
    updatedAt: new Date("2026-07-18T10:00:00.000Z"),
    ...overrides,
  };
}

function harness() {
  const transaction = {
    contact: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    contactEnrichmentCandidate: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn((operation: (tx: typeof transaction) => unknown) =>
      operation(transaction)
    ),
  };
  return {
    service: new ContactEnrichmentService(prisma as unknown as PrismaService),
    prisma,
    transaction,
  };
}

describe("ContactEnrichmentService", () => {
  it("lists incomplete contacts without a name query using owner-scoped pagination", async () => {
    const { service, prisma } = harness();
    prisma.contact.findMany.mockResolvedValue([
      {
        id: "contact-synthetic",
        firstName: "Synthetic",
        lastName: "Person",
        photo: null,
        bio: "Existing bio",
        company: "Synthetic Labs",
        jobTitle: "Researcher",
        birthday: null,
        birthdayMonth: 2,
        birthdayDay: 29,
        anniversary: null,
        socialLinks: {},
        firstMetDate: null,
        firstMetContext: "Conference",
      },
    ]);
    prisma.contact.count.mockResolvedValue(1);

    await expect(
      service.listIncomplete("owner-synthetic", { offset: 10, limit: 5 })
    ).resolves.toEqual({
      contacts: [
        {
          id: "contact-synthetic",
          name: "Synthetic Person",
          missingFields: [
            "photo",
            "anniversary",
            "socialLinks",
            "firstMetDate",
          ],
        },
      ],
      total: 1,
      offset: 10,
      limit: 5,
    });
    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "owner-synthetic",
          isDemo: false,
        }),
        skip: 10,
        take: 5,
      })
    );
  });

  it("deduplicates the same owner-scoped evidence without creating another row", async () => {
    const { service, transaction } = harness();
    transaction.contact.findFirst.mockResolvedValue({
      id: "contact-synthetic",
    });
    transaction.contactEnrichmentCandidate.findFirst.mockResolvedValue(
      candidate()
    );

    await expect(
      service.submitCandidate(
        "owner-synthetic",
        {
          contactId: "contact-synthetic",
          fieldName: "company",
          proposedValue: " Synthetic Labs ",
          sourceKind: "second_brain",
          sourceLocator: "people/synthetic-person.md",
          sourceReference: "frontmatter: company",
          sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
          confidence: 0.98,
          matchRationale: "Exact full-name match and explicitly labeled field.",
        },
        transaction as never
      )
    ).resolves.toEqual({ candidate: candidate(), deduplicated: true });

    expect(transaction.contact.findFirst).toHaveBeenCalledWith({
      where: {
        id: "contact-synthetic",
        ownerId: "owner-synthetic",
        isDemo: false,
      },
      select: { id: true },
    });
    expect(
      transaction.contactEnrichmentCandidate.create
    ).not.toHaveBeenCalled();
  });

  it("rejects raw-content-shaped source locators instead of storing private bodies", async () => {
    const { service, transaction } = harness();
    transaction.contact.findFirst.mockResolvedValue({
      id: "contact-synthetic",
    });

    await expect(
      service.submitCandidate(
        "owner-synthetic",
        {
          contactId: "contact-synthetic",
          fieldName: "company",
          proposedValue: "Synthetic Labs",
          sourceKind: "second_brain",
          sourceLocator: "Company: Synthetic Labs\nPrivate note body",
          sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
          confidence: 0.98,
          matchRationale: "Exact full-name match and labeled field.",
        },
        transaction as never
      )
    ).rejects.toThrow("Invalid enrichment candidate metadata");
    expect(
      transaction.contactEnrichmentCandidate.create
    ).not.toHaveBeenCalled();
  });

  it("accepts a high-confidence first-party candidate only into an empty field", async () => {
    const { service, transaction } = harness();
    transaction.contactEnrichmentCandidate.findFirst.mockResolvedValue(
      candidate()
    );
    transaction.contact.updateMany.mockResolvedValue({ count: 1 });
    transaction.contactEnrichmentCandidate.updateMany.mockResolvedValue({
      count: 1,
    });

    await expect(
      service.acceptCandidate(
        "owner-synthetic",
        "candidate-synthetic",
        transaction as never
      )
    ).resolves.toMatchObject({
      candidateId: "candidate-synthetic",
      contactId: "contact-synthetic",
      fieldName: "company",
      status: "accepted",
      applied: true,
    });

    expect(transaction.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contact-synthetic",
        ownerId: "owner-synthetic",
        isDemo: false,
        OR: [{ company: null }, { company: "" }],
      },
      data: { company: "Synthetic Labs" },
    });
    expect(
      transaction.contactEnrichmentCandidate.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "candidate-synthetic",
          ownerId: "owner-synthetic",
          status: "pending",
        },
        data: expect.objectContaining({ status: "accepted" }),
      })
    );
  });

  it("refuses to overwrite a populated contact field and leaves evidence pending", async () => {
    const { service, transaction } = harness();
    transaction.contactEnrichmentCandidate.findFirst.mockResolvedValue(
      candidate()
    );
    transaction.contact.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.acceptCandidate(
        "owner-synthetic",
        "candidate-synthetic",
        transaction as never
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      transaction.contactEnrichmentCandidate.updateMany
    ).not.toHaveBeenCalled();
  });

  it("stores a yearless birthday as month/day without inventing a date", async () => {
    const { service, transaction } = harness();
    transaction.contactEnrichmentCandidate.findFirst.mockResolvedValue(
      candidate({
        fieldName: "birthday",
        proposedValue: { month: 2, day: 29 },
        sourceKind: "vcard",
      })
    );
    transaction.contact.updateMany.mockResolvedValue({ count: 1 });
    transaction.contactEnrichmentCandidate.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.acceptCandidate(
      "owner-synthetic",
      "candidate-synthetic",
      transaction as never
    );

    expect(transaction.contact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contact-synthetic",
        ownerId: "owner-synthetic",
        isDemo: false,
        birthday: null,
        birthdayMonth: null,
        birthdayDay: null,
      },
      data: { birthdayMonth: 2, birthdayDay: 29 },
    });
  });

  it("keeps public-web evidence pending even when its confidence is high", async () => {
    const { service, transaction } = harness();
    transaction.contactEnrichmentCandidate.findFirst.mockResolvedValue(
      candidate({ sourceKind: "public_web", confidence: 0.99 })
    );

    await expect(
      service.acceptCandidate(
        "owner-synthetic",
        "candidate-synthetic",
        transaction as never
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.contact.updateMany).not.toHaveBeenCalled();
  });

  it("rejects public evidence from a people-search data broker", async () => {
    const { service, transaction } = harness();
    transaction.contact.findFirst.mockResolvedValue({
      id: "contact-synthetic",
    });

    await expect(
      service.submitCandidate(
        "owner-synthetic",
        {
          contactId: "contact-synthetic",
          fieldName: "company",
          proposedValue: "Synthetic Labs",
          sourceKind: "public_web",
          sourceLocator: "https://www.whitepages.com/example",
          sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
          confidence: 0.6,
          matchRationale: "Operator supplied an explicit contact id.",
        },
        transaction as never
      )
    ).rejects.toThrow("Invalid enrichment candidate metadata");
  });

  it.each([
    "Arc/StorableCommandBarAdditionalRanking.json",
    "Arc/SidebarTelemetry.json",
    "Arc/ArchiveSecrets.json",
  ])("rejects unsupported Arc sidebar evidence locator %s", async (sourceLocator) => {
    const { service, transaction } = harness();
    transaction.contact.findFirst.mockResolvedValue({
      id: "contact-synthetic",
    });

    await expect(
      service.submitCandidate(
        "owner-synthetic",
        {
          contactId: "contact-synthetic",
          fieldName: "socialLinks",
          proposedValue: { github: "https://github.com/synthetic-person" },
          sourceKind: "arc_sidebar",
          sourceLocator,
          sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
          confidence: 0.92,
          matchRationale: "Exact Arc title match.",
        },
        transaction as never
      )
    ).rejects.toThrow("Invalid enrichment candidate metadata");
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "file:///tmp/avatar.png",
    "http://127.0.0.1/avatar.png",
    "https://192.168.1.20/avatar.png",
    "https://[::1]/avatar.png",
    "https://[::ffff:127.0.0.1]/avatar.png",
    "https://localhost./avatar.png",
    "https://service.local./avatar.png",
  ])("rejects unsafe photo URL %s", (value) => {
    expect(() => normalizeCandidateValue("photo", value)).toThrow(
      "Invalid enrichment candidate value"
    );
  });

  it("rejects a social URL on a host not allowlisted for its network", () => {
    expect(() =>
      normalizeCandidateValue("socialLinks", {
        linkedin: "https://example.test/synthetic-person",
      })
    ).toThrow("Invalid enrichment candidate value");
  });

  it("lists candidates with owner isolation and stable pagination", async () => {
    const { service, prisma } = harness();
    prisma.contact.findFirst.mockResolvedValue({ id: "contact-synthetic" });
    prisma.contactEnrichmentCandidate.findMany.mockResolvedValue([]);
    prisma.contactEnrichmentCandidate.count.mockResolvedValue(0);

    await expect(
      service.listCandidates("owner-synthetic", "contact-synthetic", {
        offset: 20,
        limit: 10,
      })
    ).resolves.toEqual({ candidates: [], total: 0, offset: 20, limit: 10 });

    expect(prisma.contactEnrichmentCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: "owner-synthetic",
          contactId: "contact-synthetic",
        },
        skip: 20,
        take: 10,
      })
    );
  });
});
