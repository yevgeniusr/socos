import type { PrismaService } from "../prisma/prisma.service.js";
import type { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import type { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import type { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import {
  CalendarWatchService,
  parseWebhookHeaders,
} from "./calendar-watch.service.js";
import type { GoogleCalendarProvider } from "./calendar-sync.service.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const envelope = {
  ciphertext: Buffer.from("cipher"),
  iv: Buffer.alloc(12),
  tag: Buffer.alloc(16),
  keyVersion: 1,
};

function harness() {
  const tx = {
    calendarWatch: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    calendarSource: {
      findFirst: jest.fn().mockResolvedValue({ pendingSyncAt: null }),
      updateMany: jest.fn(),
    },
    googleCalendarConnection: {
      findFirst: jest.fn().mockResolvedValue({ calendarListPendingAt: null }),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    calendarWatch: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    calendarSource: { findFirst: jest.fn() },
    googleCalendarConnection: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)),
  };
  const cipher = {
    encrypt: jest.fn().mockReturnValue(envelope),
    decrypt: jest.fn().mockReturnValue("resource"),
  };
  const index = {
    mac: jest.fn((_p, _o, value) => `mac:${value}`),
    verify: jest.fn((mac, _p, _o, value) => mac === `mac:${value}`),
  };
  const provider: jest.Mocked<GoogleCalendarProvider> = {
    authorize: jest.fn().mockResolvedValue({ accessToken: "access" }),
    listCalendars: jest.fn(),
    listEvents: jest.fn(),
    watchCalendarList: jest.fn().mockResolvedValue({
      resourceId: "resource",
      expiresAt: new Date("2026-07-23T12:00:00Z"),
    }),
    watchEvents: jest.fn(),
    stopChannel: jest.fn(),
  };
  const config = { requireEnabled: jest.fn() };
  const service = new CalendarWatchService(
    prisma as unknown as PrismaService,
    cipher as unknown as PersonalDataCipherService,
    index as unknown as PersonalDataIndexService,
    config as unknown as PersonalDataConfigService,
    provider,
    {
      get: jest
        .fn()
        .mockReturnValue(
          "https://socos.test/api/integrations/google-calendar/webhook"
        ),
    } as never,
    jest.fn().mockReturnValueOnce("watch-new").mockReturnValue("channel-new"),
    jest.fn().mockReturnValue("token-new")
  );
  return { service, prisma, tx, provider };
}

describe("CalendarWatchService", () => {
  it("persists replacement and enqueues before marking older channels stopping", async () => {
    const { service, prisma, tx, provider } = harness();
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    tx.calendarWatch.create.mockResolvedValue({ id: "watch-new" });
    tx.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.findMany.mockResolvedValue([]);

    await service.createOrRenew(
      "owner",
      "connection",
      "calendar_list",
      "connection",
      NOW
    );

    expect(provider.watchCalendarList).toHaveBeenCalledWith(
      "access",
      expect.objectContaining({
        address: "https://socos.test/api/integrations/google-calendar/webhook",
        channelId: "channel-new",
        token: "token-new",
      })
    );
    const createOrder = tx.calendarWatch.create.mock.invocationCallOrder[0];
    const enqueueOrder =
      tx.googleCalendarConnection.updateMany.mock.invocationCallOrder[1];
    const stoppingOrder =
      prisma.calendarWatch.updateMany.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(enqueueOrder);
    expect(enqueueOrder).toBeLessThan(stoppingOrder);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.calendarWatch.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a future target backoff monotonic when a new watch enqueues work", async () => {
    const { service, prisma, tx } = harness();
    const future = new Date("2026-07-16T12:10:00.000Z");
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    tx.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    tx.googleCalendarConnection.findFirst.mockResolvedValue({
      calendarListPendingAt: future,
    });
    tx.calendarWatch.create.mockResolvedValue({ id: "watch-new" });
    prisma.calendarWatch.updateMany.mockResolvedValue({ count: 0 });
    prisma.calendarWatch.findMany.mockResolvedValue([]);

    await service.createOrRenew(
      "owner",
      "connection",
      "calendar_list",
      "connection",
      NOW
    );

    expect(tx.googleCalendarConnection.updateMany).toHaveBeenLastCalledWith({
      where: { id: "connection", ownerId: "owner", status: "active" },
      data: { calendarListPendingAt: new Date(future.getTime() + 1) },
    });
  });

  it("stops a newly-created remote channel when durable persistence fails", async () => {
    const { service, prisma, provider } = harness();
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.$transaction.mockRejectedValue(new Error("synthetic-db-failure"));

    await expect(
      service.createOrRenew(
        "owner",
        "connection",
        "calendar_list",
        "connection",
        NOW
      )
    ).rejects.toThrow("synthetic-db-failure");

    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "channel-new",
      resourceId: "resource",
    });
    expect(prisma.calendarWatch.updateMany).not.toHaveBeenCalled();
  });

  it("cleans up remotely when disconnect wins before watch persistence", async () => {
    const { service, prisma, tx, provider } = harness();
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    tx.googleCalendarConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createOrRenew(
        "owner",
        "connection",
        "calendar_list",
        "connection",
        NOW
      )
    ).rejects.toThrow("calendar_watch_target_stale");

    expect(tx.calendarWatch.create).not.toHaveBeenCalled();
    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "channel-new",
      resourceId: "resource",
    });
  });

  it("validates opaque headers and advances a target only for a larger signed bigint", async () => {
    const { service, prisma, tx } = harness();
    prisma.calendarWatch.findUnique.mockResolvedValue({
      id: "watch",
      ownerId: "owner",
      connectionId: "connection",
      targetType: "events",
      targetKey: "source",
      status: "stopping",
      expiresAt: new Date("2026-07-16T13:00:00Z"),
      tokenMac: "mac:token",
      resourceIdMac: "mac:resource",
      lastMessageNumber: 8n,
    });
    tx.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    tx.calendarSource.findFirst.mockResolvedValue({ pendingSyncAt: NOW });
    tx.calendarSource.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.handleWebhook(
        {
          channelId: "opaque",
          token: "token",
          resourceId: "resource",
          resourceState: "exists",
          messageNumber: 9n,
        },
        NOW
      )
    ).resolves.toBe("accepted");
    expect(tx.calendarWatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "watch",
          ownerId: "owner",
          OR: [{ lastMessageNumber: null }, { lastMessageNumber: { lt: 9n } }],
        }),
        data: { lastMessageNumber: 9n },
      })
    );
    expect(tx.calendarSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { pendingSyncAt: new Date(NOW.getTime() + 1) },
      })
    );
  });

  it("accepts valid duplicate messages without enqueueing and rejects spoofed MACs generically", async () => {
    const { service, prisma, tx } = harness();
    prisma.calendarWatch.findUnique.mockResolvedValue({
      id: "watch",
      ownerId: "owner",
      connectionId: "connection",
      targetType: "events",
      targetKey: "source",
      status: "active",
      expiresAt: new Date("2026-07-16T13:00:00Z"),
      tokenMac: "mac:token",
      resourceIdMac: "mac:resource",
      lastMessageNumber: 10n,
    });
    tx.calendarWatch.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.handleWebhook(
        {
          channelId: "opaque",
          token: "token",
          resourceId: "resource",
          resourceState: "exists",
          messageNumber: 9n,
        },
        NOW
      )
    ).resolves.toBe("duplicate");
    expect(tx.calendarSource.updateMany).not.toHaveBeenCalled();
    await expect(
      service.handleWebhook(
        {
          channelId: "opaque",
          token: "wrong",
          resourceId: "resource",
          resourceState: "exists",
          messageNumber: 11n,
        },
        NOW
      )
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("parseWebhookHeaders", () => {
  it("requires one canonical value, a known state, and a positive signed bigint", () => {
    expect(
      parseWebhookHeaders({
        "x-goog-channel-id": "channel",
        "x-goog-channel-token": "token",
        "x-goog-resource-id": "resource",
        "x-goog-resource-state": "sync",
        "x-goog-message-number": "9223372036854775807",
      })
    ).toMatchObject({
      channelId: "channel",
      resourceState: "sync",
      messageNumber: 9223372036854775807n,
    });
    expect(() =>
      parseWebhookHeaders({ "x-goog-channel-id": ["one", "two"] })
    ).toThrow();
    expect(() =>
      parseWebhookHeaders({
        "x-goog-channel-id": "channel",
        "x-goog-channel-token": "token",
        "x-goog-resource-id": "resource",
        "x-goog-resource-state": "bogus",
        "x-goog-message-number": "0",
      })
    ).toThrow();
  });
});
