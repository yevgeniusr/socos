import {
  deriveVisits,
  haversineDistanceM,
  sourceIdentity,
  VisitDerivationService,
  weightedCentroid,
} from "./visit-derivation.service.js";

const OWNER = "owner-synthetic";
const DEVICE = "device-synthetic";
const METERS_PER_RADIAN = 6_371_008.8;

describe("visit derivation v1", () => {
  it("uses the exact 150 metre and ten minute opening boundaries", () => {
    const atBoundary = longitudeAtDistance(150);
    const visits = deriveVisits([
      sample("a", 0, 0, 0),
      sample("b", 0, 0, 5),
      sample("c", 0, atBoundary, 10),
    ]);

    expect(
      haversineDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: atBoundary })
    ).toBeCloseTo(150, 8);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      arrivedAt: instant(0),
      departedAt: null,
      sampleIds: ["a", "b", "c"],
    });
    expect(
      deriveVisits([
        sample("a", 0, 0, 0),
        sample("b", 0, 0, 5),
        sample("c", 0, atBoundary, 9, 201),
      ])
    ).toHaveLength(0);
  });

  it("orders same-time samples by id and excluded accuracy neither advances nor breaks state", () => {
    const visits = deriveVisits([
      sample("c", 0, 0, 10),
      sample("excluded", 30, 30, 20, 200.000_001),
      sample("b", 0, 0, 0),
      sample("a", 0, 0, 0),
    ]);

    expect(visits[0]?.sampleIds).toEqual(["a", "b", "c"]);
    expect(visits[0]?.arrivedAt).toEqual(instant(0));
  });

  it("treats null and zero accuracy as ten metre weights", () => {
    const centroid = weightedCentroid([
      { lat: 0, lon: 0, accuracyM: null },
      { lat: 0, lon: 1, accuracyM: 0 },
      { lat: 0, lon: 2, accuracyM: 20 },
    ]);
    expect(centroid.lat).toBe(0);
    expect(centroid.lon).toBeCloseTo(0.8, 12);
  });

  it("unwraps longitude across the antimeridian and normalizes to [-180, 180)", () => {
    const centroid = weightedCentroid([
      { lat: 10, lon: 179.8, accuracyM: 10 },
      { lat: 10, lon: -179.8, accuracyM: 10 },
    ]);

    expect(centroid.lat).toBe(10);
    expect(centroid.lon).toBe(-180);
  });

  it("closes only after an over-250m away run reaches five minutes and replays it", () => {
    const away = longitudeAtDistance(251);
    const visits = deriveVisits([
      sample("home-1", 0, 0, 0),
      sample("home-2", 0, 0, 5),
      sample("home-3", 0, 0, 10),
      sample("away-1", 0, away, 12),
      sample("away-2", 0, away, 17),
      sample("away-3", 0, away, 22),
    ]);

    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({
      departedAt: instant(12),
      sampleIds: ["home-1", "home-2", "home-3"],
    });
    expect(visits[1]).toMatchObject({
      arrivedAt: instant(12),
      departedAt: null,
      sampleIds: ["away-1", "away-2", "away-3"],
    });
  });

  it("keeps an away point at exactly 250m in the resident visit", () => {
    const edge = longitudeAtDistance(250);
    const visits = deriveVisits([
      sample("a", 0, 0, 0),
      sample("b", 0, 0, 5),
      sample("c", 0, 0, 10),
      sample("edge", 0, edge, 11),
    ]);

    expect(visits[0]?.sampleIds).toContain("edge");
    expect(visits[0]?.departedAt).toBeNull();
  });

  it("builds the exact deterministic source identity", () => {
    expect(sourceIdentity(DEVICE, ["a", "b"])).toBe(
      '{"derivationVersion":1,"deviceId":"device-synthetic","sampleIds":["a","b"]}'
    );
  });

  it("stabilizes late and out-of-order samples to the same visits", () => {
    const ordered = [
      sample("home-a", 0, 0, 0),
      sample("home-b", 0, 0, 5),
      sample("home-c", 0, 0, 10),
      sample("away-a", 0, longitudeAtDistance(251), 12),
      sample("late-home", 0, 0, 15),
      sample("away-b", 0, longitudeAtDistance(251), 20),
      sample("away-c", 0, longitudeAtDistance(251), 30),
    ];

    expect(deriveVisits([...ordered].reverse())).toEqual(deriveVisits(ordered));
    expect(deriveVisits(ordered)[0]?.departedAt).toEqual(instant(20));
  });
});

describe("VisitDerivationService adapter", () => {
  it("serializes by owner/device and scopes the inserted sample lookup", async () => {
    const tx = transactionHarness();
    const prisma = {
      $transaction: jest.fn((operation: any) => operation(tx)),
    };
    const service = new VisitDerivationService(
      prisma as any,
      { decrypt: jest.fn(), encrypt: jest.fn() } as any,
      { mac: jest.fn() } as any
    );

    await service.recomputeForSample(OWNER, DEVICE, "sample-id");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(JSON.stringify([OWNER, DEVICE]));
    expect(tx.locationSample.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sample-id", ownerId: OWNER, deviceId: DEVICE },
      })
    );
  });

  it("domain-separates source MACs by owner", async () => {
    const first = transactionHarness({ withVisit: true });
    const second = transactionHarness({ withVisit: true });
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce((operation: any) => operation(first))
        .mockImplementationOnce((operation: any) => operation(second)),
    };
    const index = { mac: jest.fn().mockReturnValue("a".repeat(64)) };
    const cipher = {
      decrypt: jest.fn().mockReturnValue({ lat: 0, lon: 0 }),
      encrypt: jest.fn().mockReturnValue({
        ciphertext: Buffer.from("synthetic"),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
      }),
    };
    const service = new VisitDerivationService(
      prisma as any,
      cipher as any,
      index as any
    );

    await service.recomputeForSample("owner-a", DEVICE, "sample-id");
    await service.recomputeForSample("owner-b", DEVICE, "sample-id");

    expect(
      index.mac.mock.calls.map((call: unknown[]) => call.slice(0, 2))
    ).toEqual([
      ["derived-visit-source", "owner-a"],
      ["derived-visit-source", "owner-b"],
    ]);
  });

  it("uses only the immediate predecessor when no visit expands the interval", async () => {
    const tx = transactionHarness();
    tx.locationSample.findFirst
      .mockReset()
      .mockResolvedValueOnce({ recordedAt: instant(10), id: "inserted" })
      .mockResolvedValueOnce({ recordedAt: instant(5), id: "preceding" });
    const service = new VisitDerivationService(
      { $transaction: (operation: any) => operation(tx) } as any,
      { decrypt: jest.fn() } as any,
      { mac: jest.fn() } as any
    );

    await service.recomputeForSample(OWNER, DEVICE, "inserted");

    expect(tx.locationSample.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.locationSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: { gte: instant(5), lt: instant(25) },
        }),
      })
    );
  });

  it("includes the exact departure sample when a stored visit expands the interval", async () => {
    const tx = transactionHarness();
    tx.locationSample.findFirst
      .mockReset()
      .mockResolvedValueOnce({ recordedAt: instant(10), id: "inserted" })
      .mockResolvedValue(null);
    tx.derivedVisit.findMany
      .mockReset()
      .mockResolvedValueOnce([storedVisit({ departedAt: instant(30) })])
      .mockResolvedValue([]);
    const service = new VisitDerivationService(
      { $transaction: (operation: any) => operation(tx) } as any,
      { decrypt: jest.fn() } as any,
      { mac: jest.fn() } as any
    );

    await service.recomputeForSample(OWNER, DEVICE, "inserted");

    expect(tx.locationSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: {
            gte: instant(0),
            lt: new Date(instant(30).getTime() + 1),
          },
        }),
      })
    );
  });

  it("does not re-encrypt or mutate an unchanged derived envelope", async () => {
    const tx = transactionHarness({ withVisit: true });
    tx.derivedVisit.findFirst.mockResolvedValue(storedVisit());
    const cipher = {
      decrypt: jest.fn().mockReturnValue({ lat: 0, lon: 0 }),
      encrypt: jest.fn(),
    };
    const service = new VisitDerivationService(
      { $transaction: (operation: any) => operation(tx) } as any,
      cipher as any,
      { mac: jest.fn().mockReturnValue("a".repeat(64)) } as any
    );

    await service.recomputeForSample(OWNER, DEVICE, "sample-id");

    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(tx.derivedVisit.create).not.toHaveBeenCalled();
    expect(tx.derivedVisit.updateMany).not.toHaveBeenCalled();
    expect(tx.derivedVisit.deleteMany).not.toHaveBeenCalled();
  });
});

function transactionHarness(options: { withVisit?: boolean } = {}) {
  const rows = options.withVisit
    ? [sampleRow("a", 0), sampleRow("b", 5), sampleRow("c", 10)]
    : [];
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ acquired: 1 }]),
    locationSample: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ recordedAt: instant(0), id: "sample-id" })
        .mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(rows),
    },
    derivedVisit: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function sampleRow(id: string, minute: number) {
  return {
    id,
    recordedAt: instant(minute),
    accuracyM: 10,
    coordinatesCiphertext: Buffer.from(id),
    coordinatesIv: Buffer.alloc(12),
    coordinatesTag: Buffer.alloc(16),
    coordinatesKeyVersion: 1,
  };
}

function storedVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-existing",
    arrivedAt: instant(0),
    departedAt: null,
    centroidCiphertext: Buffer.from("centroid"),
    centroidIv: Buffer.alloc(12),
    centroidTag: Buffer.alloc(16),
    centroidKeyVersion: 1,
    radiusM: 0,
    confidence: 1,
    sourceMac: "a".repeat(64),
    derivationVersion: 1,
    ...overrides,
  };
}

function sample(
  id: string,
  lat: number,
  lon: number,
  minute: number,
  accuracyM: number | null = 10
) {
  return { id, recordedAt: instant(minute), lat, lon, accuracyM };
}

function instant(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, minute));
}

function longitudeAtDistance(metres: number): number {
  return (metres / METERS_PER_RADIAN) * (180 / Math.PI);
}
