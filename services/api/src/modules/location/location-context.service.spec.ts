import { LocationContextService } from "./location-context.service.js";

const OWNER = "owner-synthetic";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const ENVELOPE = {
  ciphertext: Buffer.from("synthetic"),
  iv: Buffer.alloc(12),
  tag: Buffer.alloc(16),
  keyVersion: 1,
};

describe("LocationContextService", () => {
  let prisma: any;
  let cipher: any;
  let service: LocationContextService;

  beforeEach(() => {
    prisma = {
      locationSample: { findFirst: jest.fn().mockResolvedValue(null) },
      derivedVisit: { findFirst: jest.fn().mockResolvedValue(null) },
      cityStay: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    cipher = { decrypt: jest.fn().mockReturnValue({ lat: 1, lon: 2 }) };
    service = new LocationContextService(prisma, cipher);
  });

  it("uses a sample at exactly 30 minutes, ignores future samples, and exposes no coordinates publicly", async () => {
    prisma.locationSample.findFirst.mockResolvedValue(sampleAt(-30));

    const internal = await service.resolveCurrent(OWNER, NOW);
    const output = await service.current(OWNER, NOW);

    expect(internal).toMatchObject({
      source: "sample",
      freshness: "fresh",
      origin: { lat: 1, lon: 2 },
      distanceCapability: true,
      city: null,
      lastSeenAt: new Date("2026-07-16T11:30:00.000Z"),
    });
    expect(output).toEqual({
      source: "sample",
      city: null,
      countryCode: null,
      timeZone: null,
      distanceCapability: true,
      lastSeenAt: new Date("2026-07-16T11:30:00.000Z"),
    });
    expect(JSON.stringify(output)).not.toContain("lat");
    expect(JSON.stringify(output)).not.toContain("lon");
    expect(JSON.stringify(output)).not.toContain("cipher");
    expect(prisma.locationSample.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: OWNER,
          recordedAt: {
            gte: new Date("2026-07-16T11:30:00.000Z"),
            lte: NOW,
          },
        },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      })
    );
  });

  it("falls through a sample older than 30 minutes to a current open visit", async () => {
    prisma.derivedVisit.findFirst.mockResolvedValue(openVisit());

    const result = await service.resolveCurrent(OWNER, NOW);

    expect(result).toMatchObject({
      source: "visit",
      freshness: "recent",
      origin: { lat: 1, lon: 2 },
      distanceCapability: true,
    });
    expect(prisma.derivedVisit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: OWNER, departedAt: null, arrivedAt: { lte: NOW } },
      })
    );
  });

  it("uses half-open calendar stays with deterministic confidence/start/source ordering", async () => {
    prisma.cityStay.findFirst.mockResolvedValue({
      startsAt: new Date("2026-07-16T11:00:00.000Z"),
      endsAt: new Date("2026-07-16T13:00:00.000Z"),
      city: "Planned City",
      countryCode: "GB",
      timeZone: "Europe/London",
      sourceId: "event-a",
      confidence: 1,
    });

    const result = await service.resolveCurrent(OWNER, NOW);

    expect(result).toMatchObject({
      source: "calendar",
      freshness: "planned",
      city: "Planned City",
      distanceCapability: false,
      origin: null,
    });
    expect(prisma.cityStay.findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: OWNER,
        startsAt: { lte: NOW },
        OR: [{ endsAt: null }, { endsAt: { gt: NOW } }],
      },
      orderBy: [
        { confidence: "desc" },
        { startsAt: "desc" },
        { sourceId: "asc" },
      ],
      select: expect.any(Object),
    });
  });

  it("uses Dubai when no current device, visit, or stay context exists", async () => {
    await expect(service.current(OWNER, NOW)).resolves.toEqual({
      source: "fallback",
      city: "Dubai",
      countryCode: "AE",
      timeZone: "Asia/Dubai",
      distanceCapability: false,
      lastSeenAt: null,
    });
  });

  it("uses device-first at exactly six hours and planned-stay-first beyond six hours", async () => {
    prisma.locationSample.findFirst.mockResolvedValue(sampleAt(-1));
    prisma.cityStay.findFirst.mockResolvedValue({
      startsAt: new Date("2026-07-16T18:00:00.000Z"),
      endsAt: new Date("2026-07-16T20:00:00.000Z"),
      city: "Event City",
      countryCode: "US",
      timeZone: "America/New_York",
      sourceId: "event",
      confidence: 1,
    });

    await expect(
      service.resolveForEvent(OWNER, new Date("2026-07-16T18:00:00.000Z"), NOW)
    ).resolves.toMatchObject({ source: "sample" });

    await expect(
      service.resolveForEvent(OWNER, new Date("2026-07-16T18:00:00.001Z"), NOW)
    ).resolves.toMatchObject({ source: "calendar", city: "Event City" });
  });

  it("does not select a stay at its exact end boundary", async () => {
    await service.resolveForEvent(
      OWNER,
      NOW,
      new Date("2026-07-16T00:00:00.000Z")
    );

    expect(prisma.cityStay.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ endsAt: null }, { endsAt: { gt: NOW } }],
        }),
      })
    );
  });
});

function sampleAt(minutes: number) {
  const recordedAt = new Date(NOW.getTime() + minutes * 60_000);
  return {
    id: "sample",
    recordedAt,
    coordinatesCiphertext: ENVELOPE.ciphertext,
    coordinatesIv: ENVELOPE.iv,
    coordinatesTag: ENVELOPE.tag,
    coordinatesKeyVersion: ENVELOPE.keyVersion,
    device: { lastSeenAt: recordedAt },
  };
}

function openVisit() {
  return {
    id: "visit",
    arrivedAt: new Date("2026-07-16T10:00:00.000Z"),
    centroidCiphertext: ENVELOPE.ciphertext,
    centroidIv: ENVELOPE.iv,
    centroidTag: ENVELOPE.tag,
    centroidKeyVersion: ENVELOPE.keyVersion,
    device: { lastSeenAt: new Date("2026-07-16T11:00:00.000Z") },
  };
}
