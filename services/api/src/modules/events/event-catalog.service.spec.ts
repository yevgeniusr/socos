import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EventCatalogService } from "./event-catalog.service.js";

const listing = {
  id: "listing-uae",
  slug: "uae-public-holidays",
  title: "UAE public holidays",
  summary: "Official public holiday announcements for the UAE.",
  aliases: ["United Arab Emirates holidays"],
  tags: ["holidays", "uae"],
  kind: "country_holidays",
  status: "active",
  geographicScope: "country",
  countries: ["AE"],
  subdivisions: [],
  city: null,
  online: false,
  trustTier: "official",
  dateCertainty: "tentative",
  provenanceUrl: "https://u.ae/en/information-and-services/public-holidays-and-religious-affairs/public-holidays",
  sourceRevision: "seed-2026-07-18",
  checkedAt: new Date("2026-07-18T00:00:00.000Z"),
  freshnessSlaHours: 168,
  license: "official-public-information",
  attribution: "United Arab Emirates Government",
  updatedAt: new Date("2026-07-18T00:00:00.000Z"),
};

describe("EventCatalogService", () => {
  it("normalizes search filters, owner-scopes follow state, and emits a stable cursor", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...listing, follows: [{ status: "active", socialWeight: 8 }] },
      {
        ...listing,
        id: "listing-un",
        slug: "un-international-days",
        title: "UN International Days",
        follows: [],
      },
    ]);
    const service = new EventCatalogService(
      { eventCatalogListing: { findMany } } as never,
      () => new Date("2026-07-18T00:00:00.000Z")
    );

    const result = await service.search("owner-a", {
      q: "  UAE  ",
      tags: " Holidays, UAE ",
      kind: " country_holidays ",
      country: " ae ",
      trust: " official ",
      followed: "true",
      limit: 1,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        AND: [
          {
            OR: [
              { title: { contains: "UAE", mode: "insensitive" } },
              { summary: { contains: "UAE", mode: "insensitive" } },
              { aliases: { has: "uae" } },
            ],
          },
          { tags: { hasEvery: ["holidays", "uae"] } },
          { kind: "country_holidays" },
          { countries: { has: "AE" } },
          { trustTier: "official" },
          { follows: { some: { ownerId: "owner-a" } } },
        ],
      },
      orderBy: { slug: "asc" },
      take: 2,
      select: expect.objectContaining({
        connectorReference: false,
        contentHash: false,
        follows: {
          where: { ownerId: "owner-a" },
          select: { status: true, socialWeight: true },
          take: 1,
        },
      }),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        slug: "uae-public-holidays",
        followed: true,
        follow: { status: "active", socialWeight: 8 },
      })
    );
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it("uses a decoded slug boundary and never reads another owner's follow", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new EventCatalogService(
      { eventCatalogListing: { findMany } } as never,
      () => new Date()
    );
    const cursor = Buffer.from(
      JSON.stringify({ version: 1, slug: "uae-public-holidays" })
    ).toString("base64url");

    await service.search("owner-b", { cursor, followed: "false" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "active",
          AND: [
            { slug: { gt: "uae-public-holidays" } },
            { follows: { none: { ownerId: "owner-b" } } },
          ],
        },
        select: expect.objectContaining({
          follows: expect.objectContaining({ where: { ownerId: "owner-b" } }),
        }),
      })
    );
  });

  it.each(["not-a-cursor", Buffer.from("{}").toString("base64url")])(
    "rejects malformed cursor %s",
    async (cursor) => {
      const service = new EventCatalogService({} as never, () => new Date());
      await expect(service.search("owner-a", { cursor })).rejects.toBeInstanceOf(
        BadRequestException
      );
    }
  );

  it("returns detail with only the caller's follow and next occurrence", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...listing,
      follows: [
        {
          status: "paused",
          socialWeight: 4,
          source: {
            events: [
              {
                id: "event-1",
                title: "Synthetic conference",
                startAt: new Date("2026-07-20T08:00:00.000Z"),
                endAt: new Date("2026-07-20T10:00:00.000Z"),
                timeZone: "Asia/Dubai",
                city: "Dubai",
                countryCode: "AE",
              },
            ],
          },
        },
      ],
    });
    const service = new EventCatalogService(
      { eventCatalogListing: { findUnique } } as never,
      () => new Date("2026-07-18T00:00:00.000Z")
    );

    const result = await service.getBySlug("owner-a", "uae-public-holidays");

    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: "uae-public-holidays" },
      select: expect.objectContaining({
        connectorReference: false,
        contentHash: false,
        follows: {
          where: { ownerId: "owner-a" },
          select: {
            status: true,
            socialWeight: true,
            source: {
              select: {
                events: {
                  where: {
                    ownerId: "owner-a",
                    status: "scheduled",
                    startAt: { gte: new Date("2026-07-18T00:00:00.000Z") },
                  },
                  orderBy: [{ startAt: "asc" }, { id: "asc" }],
                  take: 1,
                  select: expect.any(Object),
                },
              },
            },
          },
          take: 1,
        },
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        followed: true,
        follow: { status: "paused", socialWeight: 4 },
        nextOccurrence: expect.objectContaining({ id: "event-1" }),
      })
    );
    expect(JSON.stringify(result)).not.toMatch(/connectorReference|contentHash/);
  });

  it("returns a fixed not-found response for absent or non-active listings", async () => {
    const service = new EventCatalogService(
      {
        eventCatalogListing: {
          findUnique: jest.fn().mockResolvedValue({ ...listing, status: "retired" }),
        },
      } as never,
      () => new Date()
    );

    await expect(
      service.getBySlug("owner-a", "retired-listing")
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
