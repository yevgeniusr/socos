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
      findFirst: jest.fn().mockResolvedValue({ id: "watch-new" }),
    },
    calendarEvent: { findMany: jest.fn() },
    cityStay: { deleteMany: jest.fn() },
    calendarSource: {
      findFirst: jest.fn().mockResolvedValue({ pendingSyncAt: null }),
      updateMany: jest.fn(),
    },
    googleCalendarConnection: {
      findFirst: jest.fn().mockResolvedValue({ calendarListPendingAt: null }),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const prisma = {
    calendarWatch: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    calendarSource: { findFirst: jest.fn(), findMany: jest.fn() },
    googleCalendarConnection: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
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
  return { service, prisma, tx, provider, cipher };
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
      tx.calendarWatch.updateMany.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(enqueueOrder);
    expect(enqueueOrder).toBeLessThan(stoppingOrder);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
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

  it("stops only its own channel when another renewal wins election", async () => {
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
    tx.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    tx.calendarWatch.create.mockResolvedValue({ id: "watch-new" });
    tx.calendarWatch.findFirst.mockResolvedValue(null);
    prisma.calendarWatch.findMany.mockResolvedValue([
      {
        id: "watch-new",
        channelId: "channel-new",
        status: "stopping",
        expiresAt: new Date("2026-07-23T12:00:00Z"),
        resourceIdCiphertext: Buffer.from("resource"),
        resourceIdIv: envelope.iv,
        resourceIdTag: envelope.tag,
        resourceIdKeyVersion: 1,
      },
    ]);

    await service.createOrRenew(
      "owner",
      "connection",
      "calendar_list",
      "connection",
      NOW
    );

    expect(tx.calendarWatch.updateMany).not.toHaveBeenCalled();
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

  it("retries a target CAS race before committing the webhook message", async () => {
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
      lastMessageNumber: 8n,
    });
    tx.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    tx.calendarSource.findFirst
      .mockResolvedValueOnce({ pendingSyncAt: NOW })
      .mockResolvedValueOnce({
        pendingSyncAt: new Date(NOW.getTime() + 4),
      });
    tx.calendarSource.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

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
    expect(tx.calendarSource.updateMany).toHaveBeenCalledTimes(2);
  });

  it("rolls back the webhook message when target enqueue cannot win", async () => {
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
      lastMessageNumber: 8n,
    });
    tx.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    tx.calendarSource.findFirst.mockResolvedValue({ pendingSyncAt: NOW });
    tx.calendarSource.updateMany.mockResolvedValue({ count: 0 });

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
    ).rejects.toMatchObject({ status: 503 });
    expect(tx.calendarSource.updateMany).toHaveBeenCalledTimes(3);
  });

  it("prepares owner stops without mutating watch state or authorizing provider access", async () => {
    const { service, prisma, provider, cipher } = harness();
    prisma.googleCalendarConnection.findUnique.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.calendarWatch.findMany.mockResolvedValue([
      {
        id: "active-watch",
        channelId: "active-channel",
        status: "active",
        expiresAt: new Date("2026-07-17T12:00:00Z"),
        resourceIdCiphertext: Buffer.from("resource"),
        resourceIdIv: envelope.iv,
        resourceIdTag: envelope.tag,
        resourceIdKeyVersion: 1,
      },
    ]);
    cipher.decrypt
      .mockReturnValueOnce("refresh-token")
      .mockReturnValueOnce("resource-id");

    const prepared = await service.prepareOwnerStops("owner", NOW);

    expect(prisma.calendarWatch.updateMany).not.toHaveBeenCalled();
    expect(provider.authorize).not.toHaveBeenCalled();
    expect(provider.stopChannel).not.toHaveBeenCalled();
    expect(prepared).toEqual([
      expect.objectContaining({
        id: "active-watch",
        resourceId: "resource-id",
        accessToken: null,
        refreshToken: "refresh-token",
      }),
    ]);
  });

  it("authorizes during post-commit prepared owner stop when no access token was supplied", async () => {
    const { service, prisma, provider } = harness();
    prisma.calendarWatch.deleteMany.mockResolvedValue({ count: 1 });

    await service.stopPreparedBestEffort(
      [
        {
          id: "active-watch",
          ownerId: "owner",
          connectionId: "connection",
          channelId: "active-channel",
          resourceId: "resource",
          expiresAt: new Date("2026-07-17T12:00:00Z"),
          accessToken: null,
          refreshToken: "refresh-token",
        },
      ],
      NOW
    );

    expect(provider.authorize).toHaveBeenCalledWith("refresh-token");
    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "active-channel",
      resourceId: "resource",
    });
    expect(prisma.calendarWatch.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "active-watch",
        ownerId: "owner",
        connectionId: "connection",
        status: "stopping",
      },
    });
  });

  it("prepares, transitions, and deletes an active event watch on deselection", async () => {
    const { service, prisma, provider } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      connectionId: "connection",
    });
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.calendarWatch.findMany.mockResolvedValue([
      {
        id: "active-watch",
        channelId: "active-channel",
        status: "active",
        expiresAt: new Date("2026-07-17T12:00:00Z"),
        resourceIdCiphertext: Buffer.from("resource"),
        resourceIdIv: envelope.iv,
        resourceIdTag: envelope.tag,
        resourceIdKeyVersion: 1,
      },
    ]);
    prisma.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.deleteMany.mockResolvedValue({ count: 1 });

    const prepared = await service.prepareSourceStops("owner", "source");
    await service.transitionPreparedStops(prepared);
    await service.stopPreparedBestEffort(prepared, NOW);

    expect(prisma.calendarWatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetType: "events",
          targetKey: "source",
          status: { in: ["active", "stopping"] },
        }),
      })
    );
    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "active-channel",
      resourceId: "resource",
    });
    expect(prisma.calendarWatch.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "active-watch",
        ownerId: "owner",
        connectionId: "connection",
        status: "stopping",
      },
    });
  });

  it("removes calendar CityStays before finalizing a watchless disconnected connection", async () => {
    const { service, tx } = harness();
    tx.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
    });
    tx.calendarEvent.findMany.mockResolvedValue([{ id: "event" }]);
    tx.cityStay.deleteMany.mockResolvedValue({ count: 1 });

    await service.removeDisconnectedCalendarStays("owner");

    expect(tx.cityStay.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner",
        source: "calendar",
        sourceId: { in: ["event"] },
      },
    });

    tx.calendarWatch.findFirst.mockResolvedValue(null);
    tx.googleCalendarConnection.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.finalizeDisconnectedOwner("owner")).resolves.toBe(
      true
    );
    expect(tx.googleCalendarConnection.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "connection",
        ownerId: "owner",
        status: "disconnected",
        watches: { none: {} },
      },
    });
  });

  it("keyset-pages watch maintenance beyond a persistent first hundred", async () => {
    const { service, prisma } = harness();
    const first = Array.from({ length: 100 }, (_, index) => ({
      id: `w${String(index).padStart(3, "0")}`,
      ownerId: "owner",
      connectionId: "connection",
      targetType: "events",
      targetKey: "source",
      status: "stopping",
      expiresAt: new Date("2026-07-16T11:00:00Z"),
    }));
    const last = [{ ...first[0], id: "w100" }];
    prisma.calendarWatch.findMany.mockImplementation((args) => {
      if (args.where?.OR) {
        return Promise.resolve(args.where.id ? last : first);
      }
      return Promise.resolve([]);
    });
    prisma.googleCalendarConnection.findFirst.mockResolvedValue(null);
    prisma.googleCalendarConnection.findMany.mockResolvedValue([]);
    prisma.calendarSource.findMany.mockResolvedValue([]);

    await service.maintain(NOW);

    expect(prisma.calendarWatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: "w099" } }),
      })
    );
  });

  it("stops a far-future active watch after a crash following disconnect", async () => {
    const { service, prisma, tx, provider } = harness();
    const watch = {
      id: "disconnected-watch",
      ownerId: "owner",
      connectionId: "connection",
      targetType: "calendar_list",
      targetKey: "connection",
      channelId: "disconnected-channel",
      status: "active",
      expiresAt: new Date("2026-08-16T12:00:00Z"),
      resourceIdCiphertext: Buffer.from("resource"),
      resourceIdIv: envelope.iv,
      resourceIdTag: envelope.tag,
      resourceIdKeyVersion: 1,
    };
    prisma.calendarWatch.findMany.mockImplementation((args) => {
      if (args.where?.OR) return Promise.resolve([watch]);
      if (args.where?.targetKey === "connection") {
        return Promise.resolve([watch]);
      }
      return Promise.resolve([]);
    });
    prisma.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.deleteMany.mockResolvedValue({ count: 1 });
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "disconnected",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.googleCalendarConnection.findMany.mockImplementation((args) =>
      Promise.resolve(
        args.where?.status === "disconnected"
          ? [{ id: "connection", ownerId: "owner" }]
          : []
      )
    );
    prisma.calendarSource.findMany.mockResolvedValue([]);
    tx.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
    });
    tx.calendarEvent.findMany.mockResolvedValue([]);
    tx.calendarWatch.findFirst.mockResolvedValue(null);
    tx.googleCalendarConnection.deleteMany.mockResolvedValue({ count: 1 });

    await service.maintain(NOW);

    expect(prisma.calendarWatch.findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([
        {
          status: "active",
          connection: { status: "disconnected" },
        },
      ])
    );
    expect(prisma.calendarWatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "disconnected-watch",
          status: "active",
        }),
        data: { status: "stopping" },
      })
    );
    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "disconnected-channel",
      resourceId: "resource",
    });
    expect(prisma.calendarWatch.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "disconnected-watch",
        ownerId: "owner",
        connectionId: "connection",
        status: "stopping",
      },
    });
    expect(tx.googleCalendarConnection.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "connection",
        ownerId: "owner",
        status: "disconnected",
        watches: { none: {} },
      },
    });
  });

  it("stops a far-future active event watch after a crash following deselection", async () => {
    const { service, prisma, provider } = harness();
    const watch = {
      id: "deselected-watch",
      ownerId: "owner",
      connectionId: "connection",
      targetType: "events",
      targetKey: "deselected-source",
      channelId: "deselected-channel",
      status: "active",
      expiresAt: new Date("2026-08-16T12:00:00Z"),
      resourceIdCiphertext: Buffer.from("resource"),
      resourceIdIv: envelope.iv,
      resourceIdTag: envelope.tag,
      resourceIdKeyVersion: 1,
    };
    prisma.calendarWatch.findMany.mockImplementation((args) => {
      if (args.where?.OR) return Promise.resolve([watch]);
      if (args.where?.targetKey === "deselected-source") {
        return Promise.resolve([watch]);
      }
      return Promise.resolve([]);
    });
    prisma.calendarWatch.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.deleteMany.mockResolvedValue({ count: 1 });
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: "connection",
      ownerId: "owner",
      status: "active",
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.googleCalendarConnection.findMany.mockResolvedValue([]);
    prisma.calendarSource.findFirst.mockResolvedValue(null);
    prisma.calendarSource.findMany.mockResolvedValue([]);

    await service.maintain(NOW);

    expect(prisma.calendarWatch.findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([{ status: "active", targetType: "events" }])
    );
    expect(provider.stopChannel).toHaveBeenCalledWith("access", {
      channelId: "deselected-channel",
      resourceId: "resource",
    });
    expect(prisma.calendarWatch.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "deselected-watch",
        ownerId: "owner",
        connectionId: "connection",
        status: "stopping",
      },
    });
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
