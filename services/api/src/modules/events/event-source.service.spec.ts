import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  EventSourceService,
  parseAllowedEventHosts,
  certifyEventFeedUrl,
} from "./event-source.service.js";

describe("event source certification", () => {
  it("accepts only a complete, unique lowercase hostname allowlist", () => {
    expect(
      parseAllowedEventHosts("events.example.com,sub.public.test")
    ).toEqual(new Set(["events.example.com", "sub.public.test"]));

    for (const value of [
      "",
      "events.example.com,",
      "events.example.com,events.example.com",
      "Events.example.com",
      "events.example.com.",
      "*.example.com",
      "events.example.com:443",
      "https://events.example.com",
      "127.0.0.1",
      "[::1]",
      "-events.example.com",
      "events..example.com",
    ]) {
      expect(() => parseAllowedEventHosts(value)).toThrow(
        "Invalid event source allowlist"
      );
    }
  });

  it("canonicalizes only exact allowlisted public HTTPS feed URLs", () => {
    const allowed = new Set(["events.example.com"]);
    expect(
      certifyEventFeedUrl(
        "https://events.example.com/a/../feed.ics?b=2&a=1",
        allowed
      )
    ).toEqual({
      href: "https://events.example.com/feed.ics?b=2&a=1",
      hostname: "events.example.com",
    });

    for (const value of [
      "http://events.example.com/feed.ics",
      "https://user@events.example.com/feed.ics",
      "https://events.example.com:444/feed.ics",
      "https://events.example.com/feed.ics#secret",
      "https://events.example.com/feed.ics#",
      "https://other.example.com/feed.ics",
      "https://127.0.0.1/feed.ics",
      "https://[::1]/feed.ics",
    ]) {
      expect(() => certifyEventFeedUrl(value, allowed)).toThrow(
        "Invalid event source URL"
      );
    }
  });
});

describe("EventSourceService", () => {
  const config = {
    get: jest.fn((name: string) =>
      name === "EVENT_SOURCE_ALLOWED_HOSTS" ? "events.example.com" : undefined
    ),
  } as unknown as ConfigService;

  it("rejects source creation when the literal discovery flag is disabled", async () => {
    const service = new EventSourceService(
      {} as never,
      {} as never,
      {} as never,
      {
        requireEnabled: jest.fn(() => {
          throw new BadRequestException();
        }),
      } as never,
      config,
      () => "source-id",
      () => "external-id"
    );

    await expect(
      service.create("owner-1", {
        name: "Public events",
        feedUrl: "https://events.example.com/feed.ics",
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("encrypts the canonical URL with the generated record ID and returns only public fields", async () => {
    const create = jest.fn().mockImplementation(({ data, select }) => ({
      id: data.id,
      name: data.name,
      allowedHost: data.allowedHost,
      selectedFields: Object.keys(select),
    }));
    const cipher = {
      encrypt: jest.fn(() => ({
        ciphertext: Buffer.from("cipher"),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
      })),
    };
    const service = new EventSourceService(
      { eventSource: { create } } as never,
      cipher as never,
      { mac: jest.fn(() => "url-mac") } as never,
      { requireEnabled: jest.fn() } as never,
      config,
      () => "source-id",
      () => "external-id"
    );

    const result = await service.create("owner-1", {
      name: "Public events",
      feedUrl: "https://events.example.com/a/../feed.ics",
    });

    expect(cipher.encrypt).toHaveBeenCalledWith(
      "event-source-feed-url",
      "owner-1",
      "source-id",
      "https://events.example.com/feed.ics"
    );
    expect(create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        id: "source-id",
        ownerId: "owner-1",
        externalSourceId: "external-id",
        allowedHost: "events.example.com",
      })
    );
    expect(JSON.stringify(result)).not.toMatch(
      /feedUrl|cipher|externalSourceId|leaseUntil|ownerId/
    );
  });

  it("owner-scopes updates and clears the lease on every edit", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new EventSourceService(
      {
        eventSource: {
          findFirst: jest.fn().mockResolvedValue({
            id: "source-1",
            allowedHost: "events.example.com",
          }),
          updateMany,
          findFirstOrThrow: jest.fn().mockResolvedValue({ id: "source-1" }),
        },
      } as never,
      {} as never,
      {} as never,
      { requireEnabled: jest.fn() } as never,
      config,
      () => "source-id",
      () => "external-id"
    );

    await service.update("owner-1", "source-1", { status: "disabled" });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "source-1", ownerId: "owner-1" },
      data: expect.objectContaining({ status: "disabled", leaseUntil: null }),
    });
  });

  it.each([
    [0, 15],
    [10, 1440],
  ])(
    "accepts the database social weight and poll interval boundary %s/%s",
    async (socialWeight, pollIntervalMinutes) => {
      const create = jest.fn().mockResolvedValue({ id: "source-id" });
      const service = new EventSourceService(
        { eventSource: { create } } as never,
        {
          encrypt: jest.fn(() => ({
            ciphertext: Buffer.from("cipher"),
            iv: Buffer.alloc(12),
            tag: Buffer.alloc(16),
            keyVersion: 1,
          })),
        } as never,
        { mac: jest.fn(() => "mac") } as never,
        { requireEnabled: jest.fn() } as never,
        config,
        () => "source-id",
        () => "external-id"
      );

      await service.create("owner-1", {
        name: "Public events",
        feedUrl: "https://events.example.com/feed.ics",
        socialWeight,
        pollIntervalMinutes,
      });

      expect(create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ socialWeight, pollIntervalMinutes })
      );
    }
  );

  it.each([
    [-1, 60],
    [11, 60],
    [5, 14],
    [5, 1441],
  ])(
    "rejects out-of-schema source boundary %s/%s",
    async (socialWeight, pollIntervalMinutes) => {
      const service = new EventSourceService(
        { eventSource: { create: jest.fn() } } as never,
        {
          encrypt: jest.fn(() => ({
            ciphertext: Buffer.from("cipher"),
            iv: Buffer.alloc(12),
            tag: Buffer.alloc(16),
            keyVersion: 1,
          })),
        } as never,
        { mac: jest.fn(() => "mac") } as never,
        { requireEnabled: jest.fn() } as never,
        config,
        () => "source-id",
        () => "external-id"
      );

      await expect(
        service.create("owner-1", {
          name: "Public events",
          feedUrl: "https://events.example.com/feed.ics",
          socialWeight,
          pollIntervalMinutes,
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  );

  it("deletes event brief feedback and items before deleting the source in an owner-scoped serializable transaction", async () => {
    const calls: string[] = [];
    const tx = {
      discoveredEvent: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: "event-1" },
            { id: "event-2" },
          ])
          .mockResolvedValueOnce([]),
      },
      briefFeedback: {
        deleteMany: jest.fn(async () => {
          calls.push("feedback");
          return { count: 2 };
        }),
      },
      briefItem: {
        deleteMany: jest.fn(async () => {
          calls.push("items");
          return { count: 2 };
        }),
      },
      eventSource: {
        deleteMany: jest.fn(async () => {
          calls.push("source");
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new EventSourceService(
      prisma as never,
      {} as never,
      {} as never,
      { requireEnabled: jest.fn() } as never,
      config,
      () => "source-id",
      () => "external-id"
    );

    await service.remove("owner-1", "source-1");

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(tx.discoveredEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "owner-1", sourceId: "source-1" },
        select: { id: true },
        orderBy: { id: "asc" },
      })
    );
    expect(tx.briefFeedback.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-1",
        briefItem: {
          kind: "event",
          sourceType: "discovered_event",
          sourceId: { in: ["event-1", "event-2"] },
        },
      },
    });
    expect(tx.briefItem.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-1",
        kind: "event",
        sourceType: "discovered_event",
        sourceId: { in: ["event-1", "event-2"] },
      },
    });
    expect(tx.eventSource.deleteMany).toHaveBeenCalledWith({
      where: { id: "source-1", ownerId: "owner-1" },
    });
    expect(calls).toEqual(["feedback", "items", "source"]);
  });
});
