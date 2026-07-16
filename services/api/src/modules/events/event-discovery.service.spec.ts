import {
  EventDiscoveryService,
  type EventSourceClaim,
} from "./event-discovery.service.js";

const NOW = new Date("2026-07-16T10:00:00.000Z");
const LEASE = new Date("2026-07-16T10:05:00.000Z");

function claim(overrides: Partial<EventSourceClaim> = {}): EventSourceClaim {
  return {
    id: "source-1",
    ownerId: "owner-1",
    provider: "ics",
    allowedHost: "events.example.com",
    feedUrlCiphertext: Buffer.from("cipher"),
    feedUrlIv: Buffer.alloc(12),
    feedUrlTag: Buffer.alloc(16),
    feedUrlKeyVersion: 1,
    status: "active",
    pollIntervalMinutes: 60,
    leaseUntil: LEASE,
    ...overrides,
  };
}

function normalizedEvent() {
  return {
    providerEventId: "uid-1:2026-07-17T18:00:00.000Z",
    canonicalIdentity: "uid-1:2026-07-17T18:00:00.000Z",
    title: "Public meetup",
    descriptionExcerpt: null,
    url: null,
    startAt: new Date("2026-07-17T18:00:00.000Z"),
    endAt: new Date("2026-07-17T20:00:00.000Z"),
    timeZone: "UTC",
    venueName: null,
    address: null,
    city: "Dubai",
    countryCode: "AE",
    latitude: null,
    longitude: null,
    category: "community",
    tags: ["community"],
    status: "scheduled" as const,
    sourceUpdatedAt: new Date("2026-07-15T12:00:00.000Z"),
    expiresAt: new Date("2026-07-17T20:00:00.000Z"),
  };
}

function createHarness(
  options: {
    fenceCount?: number;
    parseError?: boolean;
    events?: ReturnType<typeof normalizedEvent>[];
    existingRows?: Array<{ id: string; providerEventIdMac: string }>;
    idGenerator?: () => string;
  } = {}
) {
  const tx = {
    eventSource: {
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options.fenceCount ?? 1 }),
    },
    discoveredEvent: {
      findMany: jest.fn().mockResolvedValue(
        options.existingRows ?? [
          {
            id: "existing-event",
            providerEventIdMac:
              "discovered-event-provider-event-id:uid-1:2026-07-17T18:00:00.000Z",
          },
        ]
      ),
      createMany: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ count: data.length })
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    ),
    $queryRaw: jest.fn().mockResolvedValue([]),
    eventSource: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const cipher = {
    encrypt: jest.fn(() => ({
      ciphertext: Buffer.from("encrypted"),
      iv: Buffer.alloc(12),
      tag: Buffer.alloc(16),
      keyVersion: 1,
    })),
  };
  const index = {
    mac: jest.fn(
      (purpose: string, _owner: string, value: string) => `${purpose}:${value}`
    ),
  };
  const sources = {
    decryptAndRecertify: jest.fn(() => ({
      href: "https://events.example.com/feed.ics",
      hostname: "events.example.com",
    })),
  };
  const fetcher = { fetchText: jest.fn().mockResolvedValue("synthetic-ics") };
  const adapter = {
    parse: options.parseError
      ? jest.fn(() => {
          throw new Error("private parser detail");
        })
      : jest.fn(() => options.events ?? [normalizedEvent()]),
  };
  const config = { isEnabled: jest.fn(() => true) };
  const service = new EventDiscoveryService(
    prisma as never,
    cipher as never,
    index as never,
    config as never,
    sources as never,
    fetcher as never,
    adapter as never,
    options.idGenerator ?? (() => "new-event-id"),
    () => NOW
  );
  return { service, prisma, tx, cipher, index, sources, fetcher, adapter };
}

describe("EventDiscoveryService", () => {
  it("does no claim work unless the discovery flag is literal true", async () => {
    const harness = createHarness();
    (harness as any).service["config"].isEnabled.mockReturnValue(false);

    await harness.service.pollDueSources(NOW);

    expect(harness.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("claims bounded work with a skip-locked lease statement", async () => {
    const harness = createHarness();

    await harness.service.pollDueSources(NOW);

    const statement = harness.prisma.$queryRaw.mock.calls[0][0] as {
      strings: readonly string[];
    };
    expect(statement.strings.join("?")).toContain("FOR UPDATE SKIP LOCKED");
    expect(statement.strings.join("?")).toContain(
      'ORDER BY "nextPollAt" ASC, "id" ASC'
    );
  });

  it("continues polling other claims when one isolated worker rejects", async () => {
    const harness = createHarness();
    harness.prisma.$queryRaw.mockResolvedValue([
      claim({ id: "source-1" }),
      claim({ id: "source-2" }),
    ]);
    const poll = jest
      .spyOn(harness.service, "pollClaim")
      .mockRejectedValueOnce(new Error("synthetic release failure"))
      .mockResolvedValueOnce();

    await expect(harness.service.pollDueSources(NOW)).resolves.toBeUndefined();

    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source-2" }),
      NOW
    );
  });

  it("writes nothing when the exact lease fence is stale", async () => {
    const harness = createHarness({ fenceCount: 0 });

    await harness.service.pollClaim(claim(), NOW);

    expect(harness.tx.discoveredEvent.findMany).not.toHaveBeenCalled();
    expect(harness.tx.discoveredEvent.createMany).not.toHaveBeenCalled();
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
    expect(harness.tx.discoveredEvent.updateMany).not.toHaveBeenCalled();
  });

  it("requires the lease to remain unexpired at the mutation fence", async () => {
    const harness = createHarness({ fenceCount: 0 });
    const expired = new Date(NOW.getTime() - 1);

    await harness.service.pollClaim(claim({ leaseUntil: expired }), NOW);

    expect(harness.tx.eventSource.updateMany).toHaveBeenCalledWith({
      where: {
        id: "source-1",
        ownerId: "owner-1",
        status: "active",
        leaseUntil: { equals: expired, gt: NOW },
      },
      data: { leaseUntil: expired },
    });
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("reuses the existing event ID as encryption AAD before upsert", async () => {
    const harness = createHarness();

    await harness.service.pollClaim(claim(), NOW);

    expect(harness.cipher.encrypt).toHaveBeenCalledWith(
      "discovered-event-provider-event-id",
      "owner-1",
      "existing-event",
      "uid-1:2026-07-17T18:00:00.000Z"
    );
    expect(harness.tx.discoveredEvent.findMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-1",
        sourceId: "source-1",
        providerEventIdMac: {
          in: [
            "discovered-event-provider-event-id:uid-1:2026-07-17T18:00:00.000Z",
          ],
        },
      },
      select: { id: true, providerEventIdMac: true },
    });
    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.tx.discoveredEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerId: "owner-1",
        sourceId: "source-1",
        endAt: { lte: NOW },
        status: { not: "expired" },
      }),
      data: { status: "expired" },
    });
  });

  it("persists a high-cardinality feed in bounded set-based chunks", async () => {
    const events = Array.from({ length: 1_000 }, (_value, index) => ({
      ...normalizedEvent(),
      providerEventId: `uid-${index}:2026-07-17T18:00:00.000Z`,
      canonicalIdentity: `uid-${index}:2026-07-17T18:00:00.000Z`,
    }));
    let nextId = 0;
    const harness = createHarness({
      events,
      existingRows: [],
      idGenerator: () => `new-event-${nextId++}`,
    });

    await harness.service.pollClaim(claim(), NOW);

    expect(harness.tx.discoveredEvent.findMany).toHaveBeenCalledTimes(1);
    expect(harness.tx.discoveredEvent.createMany).toHaveBeenCalledTimes(5);
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
    expect(
      harness.tx.discoveredEvent.createMany.mock.calls[0][0].data
    ).toHaveLength(200);
  });

  it("preserves prior events and records only a fixed error after parse failure", async () => {
    const harness = createHarness({ parseError: true });

    await harness.service.pollClaim(claim(), NOW);

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.prisma.eventSource.updateMany).toHaveBeenCalledWith({
      where: {
        id: "source-1",
        ownerId: "owner-1",
        status: "active",
        leaseUntil: { equals: LEASE, gt: NOW },
      },
      data: expect.objectContaining({
        status: "error",
        errorCode: "event_feed_failed",
        leaseUntil: null,
      }),
    });
    expect(
      JSON.stringify(harness.prisma.eventSource.updateMany.mock.calls)
    ).not.toContain("private parser detail");
  });
});
