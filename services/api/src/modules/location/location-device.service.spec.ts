import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { LocationDeviceService } from "./location-device.service.js";

const OWNER_ID = "owner-synthetic";
const DEVICE_ID = "device-synthetic";
const ENVELOPE = {
  ciphertext: Buffer.from("ciphertext"),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
  keyVersion: 1,
};
const CREATED_AT = new Date("2026-07-16T10:00:00.000Z");

describe("LocationDeviceService", () => {
  let prisma: any;
  let config: any;
  let cipher: any;
  let index: any;
  let credentials: any;
  let service: LocationDeviceService;

  beforeEach(() => {
    prisma = {
      locationDevice: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    config = { requireEnabled: jest.fn() };
    cipher = {
      encrypt: jest.fn().mockReturnValue(ENVELOPE),
      decrypt: jest.fn(),
    };
    index = { mac: jest.fn().mockReturnValue("a".repeat(64)) };
    credentials = {
      generate: jest.fn().mockResolvedValue({
        username: "u".repeat(32),
        password: "one-time-password",
        passwordHash: "stored-scrypt-hash",
      }),
    };
    service = new LocationDeviceService(
      prisma,
      config,
      cipher,
      index,
      credentials
    );
  });

  it("does no DB, crypto, or credential work when location ingest is disabled", async () => {
    config.requireEnabled.mockImplementation(() => {
      throw new ServiceUnavailableException({
        code: "integration_not_configured",
        message: "Integration is not configured",
      });
    });

    await expect(
      service.create(OWNER_ID, { name: "Pixel", externalDeviceId: "pixel-1" })
    ).rejects.toMatchObject({
      response: { code: "integration_not_configured" },
    });
    expect(prisma.locationDevice.create).not.toHaveBeenCalled();
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(index.mac).not.toHaveBeenCalled();
    expect(credentials.generate).not.toHaveBeenCalled();
  });

  it("encrypts and MACs private fields before creation and returns credentials once", async () => {
    prisma.locationDevice.create.mockResolvedValue({
      id: DEVICE_ID,
      status: "active",
      rawRetentionDays: 45,
      derivedRetentionDays: 365,
      lastSeenAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    const result = await service.create(OWNER_ID, {
      name: "Synthetic Pixel",
      externalDeviceId: "pixel-synthetic",
      rawRetentionDays: 45,
      derivedRetentionDays: 365,
    });

    expect(config.requireEnabled).toHaveBeenCalledWith("locationIngest");
    expect(index.mac).toHaveBeenNthCalledWith(
      1,
      "location-device-name",
      OWNER_ID,
      "Synthetic Pixel"
    );
    expect(index.mac).toHaveBeenNthCalledWith(
      2,
      "location-device-external-id",
      OWNER_ID,
      "pixel-synthetic"
    );
    const createData = prisma.locationDevice.create.mock.calls[0][0].data;
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "location-device-name",
      OWNER_ID,
      createData.id,
      "Synthetic Pixel"
    );
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "location-device-external-id",
      OWNER_ID,
      createData.id,
      "pixel-synthetic"
    );
    expect(createData).toEqual({
      id: expect.any(String),
      ownerId: OWNER_ID,
      nameMac: "a".repeat(64),
      nameCiphertext: ENVELOPE.ciphertext,
      nameIv: ENVELOPE.iv,
      nameTag: ENVELOPE.tag,
      nameKeyVersion: 1,
      username: "u".repeat(32),
      credentialHash: "stored-scrypt-hash",
      externalDeviceIdMac: "a".repeat(64),
      externalDeviceIdCiphertext: ENVELOPE.ciphertext,
      externalDeviceIdIv: ENVELOPE.iv,
      externalDeviceIdTag: ENVELOPE.tag,
      externalDeviceIdKeyVersion: 1,
      rawRetentionDays: 45,
      derivedRetentionDays: 365,
    });
    expect(result).toEqual({
      device: {
        id: DEVICE_ID,
        name: "Synthetic Pixel",
        externalDeviceId: "pixel-synthetic",
        status: "active",
        rawRetentionDays: 45,
        derivedRetentionDays: 365,
        lastSeenAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      credentials: { username: "u".repeat(32), password: "one-time-password" },
    });
    expect(JSON.stringify(result)).not.toContain("stored-scrypt-hash");
  });

  it("lists only decrypted owner-scoped device presentation fields", async () => {
    prisma.locationDevice.findMany.mockResolvedValue([
      {
        id: DEVICE_ID,
        ownerId: OWNER_ID,
        nameCiphertext: ENVELOPE.ciphertext,
        nameIv: ENVELOPE.iv,
        nameTag: ENVELOPE.tag,
        nameKeyVersion: 1,
        externalDeviceIdCiphertext: ENVELOPE.ciphertext,
        externalDeviceIdIv: ENVELOPE.iv,
        externalDeviceIdTag: ENVELOPE.tag,
        externalDeviceIdKeyVersion: 1,
        status: "active",
        rawRetentionDays: 90,
        derivedRetentionDays: 730,
        lastSeenAt: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);
    cipher.decrypt
      .mockReturnValueOnce("Synthetic Pixel")
      .mockReturnValueOnce("pixel-synthetic");

    const result = await service.list(OWNER_ID);

    expect(prisma.locationDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: OWNER_ID } })
    );
    expect(cipher.decrypt).toHaveBeenNthCalledWith(
      1,
      "location-device-name",
      OWNER_ID,
      DEVICE_ID,
      ENVELOPE
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: DEVICE_ID,
        name: "Synthetic Pixel",
        externalDeviceId: "pixel-synthetic",
      }),
    ]);
    for (const forbidden of [
      "username",
      "credentialHash",
      "nameCiphertext",
      "nameIv",
      "nameTag",
      "nameKeyVersion",
      "externalDeviceIdCiphertext",
    ]) {
      expect(result[0]).not.toHaveProperty(forbidden);
    }
  });

  it("rotates credentials transactionally with an owner-scoped mutation", async () => {
    const tx = {
      locationDevice: {
        findFirst: jest.fn().mockResolvedValue({
          id: DEVICE_ID,
          username: "o".repeat(32),
          status: "active",
          rawRetentionDays: 90,
          derivedRetentionDays: 730,
          lastSeenAt: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation((operation: any) => operation(tx));

    const result = await service.rotate(OWNER_ID, DEVICE_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.locationDevice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEVICE_ID, ownerId: OWNER_ID, status: "active" },
      })
    );
    expect(tx.locationDevice.updateMany).toHaveBeenCalledWith({
      where: {
        id: DEVICE_ID,
        ownerId: OWNER_ID,
        status: "active",
        username: "o".repeat(32),
      },
      data: { username: "u".repeat(32), credentialHash: "stored-scrypt-hash" },
    });
    expect(result.credentials).toEqual({
      username: "u".repeat(32),
      password: "one-time-password",
    });
  });

  it("allows only one concurrent rotation from the same current credential", async () => {
    const oldUsername = "o".repeat(32);
    let storedUsername = oldUsername;
    credentials.generate
      .mockResolvedValueOnce({
        username: "a".repeat(32),
        password: "first-password",
        passwordHash: "first-hash",
      })
      .mockResolvedValueOnce({
        username: "b".repeat(32),
        password: "second-password",
        passwordHash: "second-hash",
      });
    const transaction = {
      locationDevice: {
        findFirst: jest.fn().mockImplementation(async () => ({
          id: DEVICE_ID,
          username: oldUsername,
          status: "active",
          rawRetentionDays: 90,
          derivedRetentionDays: 730,
          lastSeenAt: null,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        })),
        updateMany: jest
          .fn()
          .mockImplementation(async ({ where, data }: any) => {
            if (where.username !== storedUsername) return { count: 0 };
            storedUsername = data.username;
            return { count: 1 };
          }),
      },
    };
    prisma.$transaction.mockImplementation((operation: any) =>
      operation(transaction)
    );

    const results = await Promise.allSettled([
      service.rotate(OWNER_ID, DEVICE_ID),
      service.rotate(OWNER_ID, DEVICE_ID),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<any> =>
        result.status === "fulfilled"
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value.device).not.toHaveProperty("username");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason).toMatchObject({
      response: {
        statusCode: 409,
        code: "credential_rotation_conflict",
        message: "Credential rotation conflict",
      },
    });
    expect(transaction.locationDevice.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: DEVICE_ID,
        ownerId: OWNER_ID,
        status: "active",
        username: oldUsername,
      },
      data: { username: "a".repeat(32), credentialHash: "first-hash" },
    });
  });

  it("revokes with an owner-scoped status mutation and never deletes the row", async () => {
    prisma.locationDevice.updateMany.mockResolvedValue({ count: 1 });

    await service.revoke(OWNER_ID, DEVICE_ID);

    expect(prisma.locationDevice.updateMany).toHaveBeenCalledWith({
      where: { id: DEVICE_ID, ownerId: OWNER_ID, status: "active" },
      data: { status: "revoked" },
    });
    expect((prisma.locationDevice as any).delete).toBeUndefined();
  });

  it("returns the same owner-scoped not-found result for cross-owner rotation", async () => {
    const tx = {
      locationDevice: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((operation: any) => operation(tx));

    await expect(
      service.rotate("other-owner", DEVICE_ID)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.locationDevice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEVICE_ID, ownerId: "other-owner", status: "active" },
      })
    );
    expect(tx.locationDevice.updateMany).not.toHaveBeenCalled();
  });
});
