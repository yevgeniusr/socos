import { LocationRetentionService } from "./location-retention.service.js";

const NOW = new Date("2026-07-16T03:15:00.000Z");

describe("LocationRetentionService", () => {
  it("runs daily at exactly 03:15 UTC independently of feature flags", () => {
    expect(
      Reflect.getMetadata(
        "SCHEDULE_CRON_OPTIONS",
        LocationRetentionService.prototype.handleCron
      )
    ).toEqual(
      expect.objectContaining({
        cronTime: "0 15 3 * * *",
        timeZone: "UTC",
      })
    );
  });

  it("pages active and revoked devices by ID and applies exact per-device cutoffs", async () => {
    const { service, prisma, tx } = harness([
      device("device-a", "owner-a", 30, 90, "revoked"),
      device("device-b", "owner-b", 60, 180, "active"),
    ]);

    await service.runRetention(NOW);

    expect(prisma.locationDevice.findMany).toHaveBeenCalledWith({
      orderBy: { id: "asc" },
      take: 100,
      select: {
        id: true,
        ownerId: true,
        rawRetentionDays: true,
        derivedRetentionDays: true,
      },
    });
    expect(prisma.locationDevice.findMany.mock.calls[0][0]).not.toHaveProperty(
      "where.status"
    );
    expect(tx.locationSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: "owner-a",
          deviceId: "device-a",
          recordedAt: { lt: new Date("2026-06-16T03:15:00.000Z") },
        },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        take: 500,
      })
    );
    expect(tx.derivedVisit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: "owner-a",
          deviceId: "device-a",
          departedAt: {
            not: null,
            lt: new Date("2026-04-17T03:15:00.000Z"),
          },
        },
        orderBy: [{ departedAt: "asc" }, { id: "asc" }],
        take: 500,
      })
    );
  });

  it("deletes 501 rows in bounded ordered owner/device/cutoff batches", async () => {
    const first500 = Array.from({ length: 500 }, (_, index) => ({
      id: `sample-${index}`,
    }));
    const { service, tx } = harness([device("device", "owner", 30, 90)], {
      sampleBatches: [first500, [{ id: "sample-500" }]],
    });

    const result = await service.runRetention(NOW);

    expect(result.samplesDeleted).toBe(501);
    expect(tx.locationSample.findMany).toHaveBeenCalledTimes(2);
    expect(tx.locationSample.deleteMany).toHaveBeenCalledTimes(2);
    for (const call of tx.locationSample.deleteMany.mock.calls) {
      expect(call[0].where).toEqual(
        expect.objectContaining({
          ownerId: "owner",
          deviceId: "device",
          recordedAt: { lt: new Date("2026-06-16T03:15:00.000Z") },
          id: { in: expect.any(Array) },
        })
      );
      expect(call[0].where.id.in.length).toBeLessThanOrEqual(500);
    }
  });

  it("never deletes open visits or rows at the exact cutoff", async () => {
    const { service, tx } = harness([device("device", "owner", 30, 90)]);

    await service.runRetention(NOW);

    expect(tx.derivedVisit.findMany.mock.calls[0][0].where.departedAt).toEqual({
      not: null,
      lt: new Date("2026-04-17T03:15:00.000Z"),
    });
    expect(tx.derivedVisit.deleteMany).not.toHaveBeenCalled();
  });
});

function harness(
  devices: any[],
  options: { sampleBatches?: Array<Array<{ id: string }>> } = {}
) {
  const sampleBatches = options.sampleBatches ?? [[]];
  const tx = {
    locationSample: {
      findMany: jest.fn(),
      deleteMany: jest.fn(({ where }: any) => ({ count: where.id.in.length })),
    },
    derivedVisit: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(({ where }: any) => ({ count: where.id.in.length })),
    },
  };
  for (const batch of sampleBatches) {
    tx.locationSample.findMany.mockResolvedValueOnce(batch);
  }
  tx.locationSample.findMany.mockResolvedValue([]);
  const prisma = {
    locationDevice: {
      findMany: jest.fn().mockResolvedValueOnce(devices).mockResolvedValue([]),
    },
    $transaction: jest.fn((operation: any) => operation(tx)),
  };
  return {
    service: new LocationRetentionService(prisma as any),
    prisma,
    tx,
  };
}

function device(
  id: string,
  ownerId: string,
  rawRetentionDays: number,
  derivedRetentionDays: number,
  status = "active"
) {
  return {
    id,
    ownerId,
    rawRetentionDays,
    derivedRetentionDays,
    status,
  };
}
