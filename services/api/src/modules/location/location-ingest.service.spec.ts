import { ServiceUnavailableException } from "@nestjs/common";
import {
  LocationIngestService,
  canonicalOwnTracksPayload,
} from "./location-ingest.service.js";

const DEVICE = {
  id: "internal-device-id",
  ownerId: "resolved-owner-id",
  username: "u".repeat(32),
};
const RECEIVED_AT = new Date("2026-07-16T12:00:00.000Z");
const ENVELOPE = {
  ciphertext: Buffer.from("ciphertext"),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
  keyVersion: 3,
};

describe("canonicalOwnTracksPayload", () => {
  it("uses exact ordered keys, explicit nulls, internal device id, and normalized zero", () => {
    const canonical = canonicalOwnTracksPayload(DEVICE.id, {
      _type: "location",
      tst: 1,
      lat: -0,
      lon: 55.25,
      tid: "ZZ",
    });

    expect(canonical).toBe(
      '{"deviceId":"internal-device-id","tst":1,"lat":0,"lon":55.25,"acc":null,"alt":null,"vel":null,"cog":null,"batt":null,"t":null}'
    );
    expect(canonical).not.toContain("tid");
  });
});

describe("LocationIngestService", () => {
  let tx: any;
  let prisma: any;
  let config: any;
  let cipher: any;
  let index: any;
  let derivation: any;
  let service: LocationIngestService;

  beforeEach(() => {
    tx = {
      locationDevice: {
        findFirst: jest.fn().mockResolvedValue({ lastSeenAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      locationSample: { create: jest.fn().mockResolvedValue({ id: "sample" }) },
    };
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((operation: any) => operation(tx)),
      locationDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    config = { requireEnabled: jest.fn() };
    cipher = { encrypt: jest.fn().mockReturnValue(ENVELOPE) };
    index = { mac: jest.fn().mockReturnValue("b".repeat(64)) };
    derivation = { recomputeForSample: jest.fn().mockResolvedValue(undefined) };
    service = new LocationIngestService(
      prisma,
      config,
      cipher,
      index,
      derivation
    );
  });

  it("does no DB, crypto, or MAC work when location ingest is disabled", async () => {
    config.requireEnabled.mockImplementation(() => {
      throw new ServiceUnavailableException({
        code: "integration_not_configured",
        message: "Integration is not configured",
      });
    });

    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(index.mac).not.toHaveBeenCalled();
  });

  it("stores only the exact encrypted coordinate envelope and queryable exceptions", async () => {
    const input = {
      _type: "location" as const,
      tst: 1_721_131_200,
      lat: 25.2048,
      lon: 55.2708,
      acc: 7.5,
      alt: 12,
      vel: 2.25,
      cog: 181.5,
      batt: 84,
      t: "p",
      tid: "S1",
    };

    await expect(service.ingest(DEVICE, input, RECEIVED_AT)).resolves.toEqual(
      []
    );

    const canonical =
      '{"deviceId":"internal-device-id","tst":1721131200,"lat":25.2048,"lon":55.2708,"acc":7.5,"alt":12,"vel":2.25,"cog":181.5,"batt":84,"t":"p"}';
    expect(index.mac).toHaveBeenCalledWith(
      "owntracks-payload",
      DEVICE.ownerId,
      canonical
    );
    const createData = tx.locationSample.create.mock.calls[0][0].data;
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "location-sample-coordinates",
      DEVICE.ownerId,
      createData.id,
      { lat: 25.2048, lon: 55.2708, alt: 12, cog: 181.5, vel: 2.25 }
    );
    expect(createData).toEqual({
      id: expect.any(String),
      ownerId: DEVICE.ownerId,
      deviceId: DEVICE.id,
      recordedAt: new Date("2024-07-16T12:00:00.000Z"),
      receivedAt: RECEIVED_AT,
      coordinatesCiphertext: ENVELOPE.ciphertext,
      coordinatesIv: ENVELOPE.iv,
      coordinatesTag: ENVELOPE.tag,
      coordinatesKeyVersion: 3,
      accuracyM: 7.5,
      batteryPercent: 84,
      trigger: "p",
      payloadMac: "b".repeat(64),
    });
    expect(createData).not.toHaveProperty("lat");
    expect(createData).not.toHaveProperty("lon");
    expect(createData).not.toHaveProperty("tid");
    expect(createData).not.toHaveProperty("rawPayload");
    expect(tx.locationDevice.findFirst).toHaveBeenCalledWith({
      where: {
        id: DEVICE.id,
        ownerId: DEVICE.ownerId,
        status: "active",
        username: DEVICE.username,
      },
      select: { lastSeenAt: true },
    });
  });

  it("accepts old queued history without a past-age cutoff", async () => {
    const input = validLocation({ tst: 1 });

    await expect(service.ingest(DEVICE, input, RECEIVED_AT)).resolves.toEqual(
      []
    );

    expect(tx.locationSample.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recordedAt: new Date(1_000) }),
      })
    );
  });

  it("rejects when credentials rotate after guard verification and before insert", async () => {
    tx.locationDevice.findFirst.mockImplementation(({ where }: any) =>
      where.username === DEVICE.username ? null : { lastSeenAt: null }
    );

    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).rejects.toMatchObject({
      response: {
        statusCode: 401,
        code: "invalid_device_credentials",
        message: "Unauthorized",
      },
    });
    expect(tx.locationDevice.findFirst).toHaveBeenCalledWith({
      where: {
        id: DEVICE.id,
        ownerId: DEVICE.ownerId,
        status: "active",
        username: DEVICE.username,
      },
      select: { lastSeenAt: true },
    });
    expect(tx.locationSample.create).not.toHaveBeenCalled();
  });

  it("accepts HMAC duplicate delivery and keeps the last-seen update owner-scoped", async () => {
    prisma.$transaction.mockRejectedValue({
      code: "P2002",
      meta: { target: ["deviceId", "payloadMac"] },
    });

    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).resolves.toEqual([]);

    expect(prisma.locationDevice.updateMany).toHaveBeenCalledWith({
      where: {
        id: DEVICE.id,
        ownerId: DEVICE.ownerId,
        status: "active",
        username: DEVICE.username,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(1_000) } }],
      },
      data: { lastSeenAt: new Date(1_000) },
    });
  });

  it("does not lower lastSeenAt for older queued samples", async () => {
    tx.locationDevice.findFirst.mockResolvedValue({
      lastSeenAt: new Date("2026-07-16T11:00:00.000Z"),
    });

    await service.ingest(DEVICE, validLocation({ tst: 1 }), RECEIVED_AT);

    expect(tx.locationDevice.updateMany).not.toHaveBeenCalled();
  });

  it("raises lastSeenAt monotonically using an owner-scoped mutation", async () => {
    const recordedAt = new Date("2026-07-16T11:30:00.000Z");

    await service.ingest(
      DEVICE,
      validLocation({ tst: Math.floor(recordedAt.getTime() / 1_000) }),
      RECEIVED_AT
    );

    expect(tx.locationDevice.updateMany).toHaveBeenCalledWith({
      where: {
        id: DEVICE.id,
        ownerId: DEVICE.ownerId,
        status: "active",
        username: DEVICE.username,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: recordedAt } }],
      },
      data: { lastSeenAt: recordedAt },
    });
  });

  it("does not treat unrelated database failures as duplicate deliveries", async () => {
    prisma.$transaction.mockRejectedValue(
      new Error("synthetic database failure")
    );

    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).rejects.toThrow("synthetic database failure");
    expect(prisma.locationDevice.updateMany).not.toHaveBeenCalled();
  });

  it("derives only a newly committed sample and keeps accepted ingest successful if derivation fails", async () => {
    derivation.recomputeForSample.mockRejectedValue(
      new Error("synthetic derivation failure")
    );

    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).resolves.toEqual([]);

    const sampleId = tx.locationSample.create.mock.calls[0][0].data.id;
    expect(derivation.recomputeForSample).toHaveBeenCalledWith(
      DEVICE.ownerId,
      DEVICE.id,
      sampleId
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      derivation.recomputeForSample.mock.invocationCallOrder[0]
    );

    derivation.recomputeForSample.mockClear();
    prisma.$transaction.mockRejectedValueOnce({
      code: "P2002",
      meta: { target: ["deviceId", "payloadMac"] },
    });
    await expect(
      service.ingest(DEVICE, validLocation(), RECEIVED_AT)
    ).resolves.toEqual([]);
    expect(derivation.recomputeForSample).not.toHaveBeenCalled();
  });

  it("lets a later new sample recover after a prior non-fatal derivation failure", async () => {
    derivation.recomputeForSample
      .mockRejectedValueOnce(new Error("synthetic first failure"))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.ingest(DEVICE, validLocation({ tst: 1 }), RECEIVED_AT)
    ).resolves.toEqual([]);
    await expect(
      service.ingest(DEVICE, validLocation({ tst: 2 }), RECEIVED_AT)
    ).resolves.toEqual([]);

    expect(derivation.recomputeForSample).toHaveBeenCalledTimes(2);
    expect(derivation.recomputeForSample.mock.calls[1].slice(0, 2)).toEqual([
      DEVICE.ownerId,
      DEVICE.id,
    ]);
  });
});

function validLocation(overrides: Record<string, unknown> = {}) {
  return {
    _type: "location" as const,
    tst: 1,
    lat: 1,
    lon: 2,
    ...overrides,
  };
}
