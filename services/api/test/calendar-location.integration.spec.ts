import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { LocationIngestService } from "../src/modules/location/location-ingest.service.js";
import { CalendarWatchService } from "../src/modules/calendar/calendar-watch.service.js";
import { EventDiscoveryService } from "../src/modules/events/event-discovery.service.js";
import { EventRecommendationService } from "../src/modules/events/event-recommendation.service.js";
import { IcsEventDiscoveryAdapter } from "../src/modules/events/ics-event-discovery.adapter.js";
import { BriefGeneratorService } from "../src/modules/briefs/brief-generator.service.js";
import { PersonalContextDeletionService } from "../src/modules/personal-data/personal-context-deletion.service.js";
import type { EncryptedValue } from "../src/modules/personal-data/personal-data-cipher.service.js";

jest.setTimeout(45_000);

function requireDisposableDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^socos_calendar_location_test_[a-z0-9_]*_test$/.test(databaseName)) {
    throw new Error(
      "Calendar/location integration tests require a disposable test database"
    );
  }
}

requireDisposableDatabase();

const prisma = new PrismaService();
const namespace = `calendar-location-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2)}`;
const owners = {
  alpha: `${namespace}-alpha`,
  beta: `${namespace}-beta`,
};

const enabledConfig = {
  requireEnabled: jest.fn(),
  isEnabled: jest.fn().mockReturnValue(true),
};

const cipher = {
  encrypt(
    purpose: string,
    ownerId: string,
    recordId: string,
    value: unknown
  ): EncryptedValue {
    return envelope(
      2,
      JSON.stringify({ purpose, ownerId, recordId, value })
    );
  },
  decrypt<T>(
    _purpose: string,
    _ownerId: string,
    _recordId: string,
    value: EncryptedValue
  ): T {
    return JSON.parse(value.ciphertext.toString("utf8")).value as T;
  },
};

const index = {
  mac(purpose: string, ownerId: string, value: string): string {
    return createHash("sha256")
      .update(`${purpose}:${ownerId}:${value}`)
      .digest("hex");
  },
  verify(mac: string, purpose: string, ownerId: string, value: string): boolean {
    return mac === this.mac(purpose, ownerId, value);
  },
};
const syntheticCredentialHash =
  "scrypt$32768$8$1$abcdefghijklmnopqrstuv$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(owners) } } });
  for (const ownerId of Object.values(owners)) {
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.invalid`,
        name: "Synthetic Calendar Location Owner",
        timeZone: "UTC",
      },
    });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(owners) } } });
  await prisma.$disconnect();
});

it("isolates owners while concurrent OwnTracks samples dedupe per device", async () => {
  const service = new LocationIngestService(
    prisma,
    enabledConfig as never,
    cipher as never,
    index as never,
    { recomputeForSample: jest.fn().mockResolvedValue(undefined) } as never
  );
  const alphaDevice = await seedDevice(owners.alpha, "alpha-phone");
  const betaDevice = await seedDevice(owners.beta, "beta-phone");
  const payload = {
    _type: "location" as const,
    tst: 1_783_958_400,
    lat: 25.2048,
    lon: 55.2708,
    acc: 12,
    batt: 77,
    t: "u",
  };

  await Promise.all(
    Array.from({ length: 10 }, () =>
      service.ingest(alphaDevice, payload, new Date("2026-07-16T10:00:00Z"))
    )
  );
  await service.ingest(betaDevice, payload, new Date("2026-07-16T10:00:01Z"));
  await seedCalendarEvent(owners.alpha, "alpha-calendar-event");
  await seedDiscoveredEvent(owners.alpha, "alpha-discovered-event");

  await expect(
    prisma.locationSample.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(1);
  await expect(
    prisma.locationSample.count({ where: { ownerId: owners.beta } })
  ).resolves.toBe(1);
  await expect(
    prisma.calendarEvent.count({ where: { ownerId: owners.beta } })
  ).resolves.toBe(0);
  await expect(
    prisma.discoveredEvent.count({ where: { ownerId: owners.beta } })
  ).resolves.toBe(0);
});

it("accepts only monotonic calendar webhook message numbers under concurrency", async () => {
  const now = new Date("2026-07-16T11:00:00Z");
  const connection = await seedConnection(owners.alpha, "webhook-connection");
  await prisma.calendarWatch.create({
    data: {
      id: `${namespace}-watch`,
      ownerId: owners.alpha,
      connectionId: connection.id,
      targetType: "calendar_list",
      targetKey: connection.id,
      channelId: `${namespace}-channel`,
      resourceIdMac: index.mac(
        "google-calendar-watch-resource",
        owners.alpha,
        "resource-1"
      ),
      ...columns("resourceId", envelope(2, "resource-1")),
      tokenMac: index.mac(
        "google-calendar-watch-token",
        owners.alpha,
        "token-1"
      ),
      expiresAt: new Date("2026-07-17T00:00:00Z"),
    } as Prisma.CalendarWatchUncheckedCreateInput,
  });
  const service = new CalendarWatchService(
    prisma,
    cipher as never,
    index as never,
    enabledConfig as never,
    {} as never,
    { get: () => "https://calendar-location.test.invalid/webhook" } as never
  );
  const input = {
    channelId: `${namespace}-channel`,
    token: "token-1",
    resourceId: "resource-1",
    resourceState: "exists" as const,
    messageNumber: 7n,
  };

  const results = await Promise.all(
    Array.from({ length: 8 }, () => service.handleWebhook(input, now))
  );
  const firstPending =
    (await prisma.googleCalendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    })).calendarListPendingAt;
  const duplicate = await service.handleWebhook(
    { ...input, messageNumber: 6n },
    now
  );
  const later = await service.handleWebhook({ ...input, messageNumber: 8n }, now);
  const finalWatch = await prisma.calendarWatch.findUniqueOrThrow({
    where: { channelId: `${namespace}-channel` },
  });
  const finalConnection =
    await prisma.googleCalendarConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });

  expect(results.filter((value) => value === "accepted")).toHaveLength(1);
  expect(results.filter((value) => value === "duplicate")).toHaveLength(7);
  expect(duplicate).toBe("duplicate");
  expect(later).toBe("accepted");
  expect(finalWatch.lastMessageNumber).toBe(8n);
  expect(firstPending).toEqual(now);
  expect(finalConnection.calendarListPendingAt).toEqual(
    new Date(now.getTime() + 1)
  );
});

it("fences stale event-source workers and commits only the exact claimed lease", async () => {
  const runNow = new Date("2026-07-16T12:00:00Z");
  const staleLease = new Date("2026-07-16T12:05:00Z");
  const currentLease = new Date("2026-07-16T12:06:00Z");
  const source = await seedEventSource(owners.alpha, "lease-source", staleLease);
  const service = new EventDiscoveryService(
    prisma,
    cipher as never,
    index as never,
    enabledConfig as never,
    { decryptAndRecertify: () => new URL("https://events.test.invalid/feed.ics") } as never,
    { fetchText: jest.fn().mockResolvedValue("BEGIN:VCALENDAR\nEND:VCALENDAR") } as never,
    {
      parse: jest.fn().mockReturnValue([
        {
          providerEventId: "synthetic-event-1",
          canonicalIdentity: "synthetic-event-1@2026-07-20",
          title: "Synthetic Event",
          descriptionExcerpt: null,
          url: "https://events.test.invalid/event/1",
          startAt: new Date("2026-07-20T15:00:00Z"),
          endAt: new Date("2026-07-20T16:00:00Z"),
          timeZone: "UTC",
          venueName: "Synthetic Hall",
          address: null,
          city: "Dubai",
          countryCode: "AE",
          latitude: null,
          longitude: null,
          category: "community",
          tags: ["synthetic"],
          status: "scheduled",
          sourceUpdatedAt: null,
          expiresAt: new Date("2026-08-01T00:00:00Z"),
        },
      ]),
    } as never,
    () => `${namespace}-discovered-${Math.random().toString(36).slice(2)}`,
    () => runNow
  );

  await prisma.eventSource.update({
    where: { id: source.id },
    data: { leaseUntil: currentLease },
  });
  await service.pollClaim({ ...source, leaseUntil: staleLease }, runNow);
  await expect(
    prisma.discoveredEvent.count({ where: { sourceId: source.id } })
  ).resolves.toBe(0);

  const current = await prisma.eventSource.findUniqueOrThrow({
    where: { id: source.id },
  });
  await service.pollClaim({ ...source, leaseUntil: current.leaseUntil! }, runNow);

  await expect(
    prisma.discoveredEvent.count({ where: { sourceId: source.id } })
  ).resolves.toBe(1);
  await expect(
    prisma.eventSource.findUniqueOrThrow({ where: { id: source.id } })
  ).resolves.toEqual(
    expect.objectContaining({
      status: "active",
      leaseUntil: null,
      lastPolledAt: runNow,
    })
  );
});

it("fails closed for event ranking while selected calendars require full rebuild", async () => {
  const now = new Date("2026-07-16T12:30:00Z");
  const connection = await seedConnection(owners.alpha, "ranking-connection");
  const source = await seedCalendarSource(
    owners.alpha,
    connection.id,
    "ranking-calendar",
    { fullSyncRequired: true, selected: true }
  );
  await seedDiscoveredEvent(owners.alpha, "ranking-event", {
    city: "Dubai",
    countryCode: "AE",
    category: "community",
    tags: ["networking"],
  });
  const service = new EventRecommendationService(
    prisma,
    cipher as never,
    {
      resolveForEvent: jest.fn().mockResolvedValue({
        source: "calendar",
        freshness: "planned",
        city: "Dubai",
        countryCode: "AE",
        timeZone: "Asia/Dubai",
        distanceCapability: false,
        lastSeenAt: null,
        origin: null,
      }),
    } as never
  );

  await expect(service.recommend(owners.alpha, now)).resolves.toEqual([]);

  await prisma.calendarSource.update({
    where: { id: source.id },
    data: { fullSyncRequired: false },
  });

  const ranked = await service.recommend(owners.alpha, now);
  expect(ranked).toHaveLength(1);
  expect(ranked[0]).toEqual(
    expect.objectContaining({
      kind: "event",
      sourceType: "discovered_event",
      title: "ranking-event title",
      city: "Dubai",
    })
  );
});

it("parses synthetic ICS fixtures without network or provider data", () => {
  const adapter = new IcsEventDiscoveryAdapter();
  const events = adapter.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:synthetic-ics-event",
      "DTSTART:20260720T150000Z",
      "DTEND:20260720T160000Z",
      "SUMMARY:Synthetic ICS Meetup",
      "LOCATION:Synthetic Venue",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n"),
    new Date("2026-07-16T00:00:00Z")
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toEqual(
    expect.objectContaining({
      providerEventId: "synthetic-ics-event:2026-07-20T15:00:00.000Z",
      title: "Synthetic ICS Meetup",
      venueName: "Synthetic Venue",
      status: "scheduled",
    })
  );
});

it("keeps aggregate deletion audits immutable while owner cascades remove private rows", async () => {
  await seedCalendarEvent(owners.alpha, "cascade-calendar-event");
  const device = await seedDevice(owners.alpha, "cascade-phone");
  await prisma.locationSample.create({
    data: {
      id: `${namespace}-cascade-sample`,
      ownerId: owners.alpha,
      deviceId: device.id,
      recordedAt: new Date("2026-07-16T13:00:00Z"),
      receivedAt: new Date("2026-07-16T13:00:01Z"),
      ...columns("coordinates", envelope(2, { lat: 25.2, lon: 55.2 })),
      payloadMac: index.mac("owntracks-payload", owners.alpha, "cascade"),
    } as Prisma.LocationSampleUncheckedCreateInput,
  });
  await seedDiscoveredEvent(owners.alpha, "cascade-discovered-event");
  await prisma.personalDataDeletionAudit.create({
    data: {
      id: `${namespace}-audit`,
      ownerMac: index.mac("owner", owners.alpha, owners.alpha),
      idempotencyKeyMac: index.mac("delete", owners.alpha, "intent"),
      requestMac: index.mac("delete-request", owners.alpha, "calendar-location-event"),
      categories: ["calendar", "location", "event"],
      calendarRowCount: 1,
      locationRowCount: 2,
      eventRowCount: 2,
      deletedAt: new Date("2026-07-16T13:30:00Z"),
    },
  });

  await prisma.user.delete({ where: { id: owners.alpha } });

  await expect(
    prisma.calendarEvent.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.locationSample.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.eventSource.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.personalDataDeletionAudit.count({ where: { id: `${namespace}-audit` } })
  ).resolves.toBe(1);
});

it("keeps one deletion audit when concurrent requests race and provider stop fails after commit", async () => {
  const now = new Date("2026-07-16T13:45:00Z");
  const connection = await seedConnection(owners.alpha, "delete-connection");
  const source = await seedCalendarSource(
    owners.alpha,
    connection.id,
    "delete-calendar",
    { fullSyncRequired: false, selected: true }
  );
  await prisma.calendarWatch.create({
    data: {
      id: `${namespace}-delete-watch`,
      ownerId: owners.alpha,
      connectionId: connection.id,
      targetType: "events",
      targetKey: source.id,
      channelId: `${namespace}-delete-channel`,
      resourceIdMac: index.mac(
        "google-calendar-watch-resource",
        owners.alpha,
        "delete-resource"
      ),
      ...columns("resourceId", envelope(2, "delete-resource")),
      tokenMac: index.mac(
        "google-calendar-watch-token",
        owners.alpha,
        "delete-token"
      ),
      expiresAt: new Date("2026-07-17T00:00:00Z"),
    } as Prisma.CalendarWatchUncheckedCreateInput,
  });
  await prisma.calendarEvent.create({
    data: {
      id: `${namespace}-delete-calendar-event`,
      ownerId: owners.alpha,
      sourceId: source.id,
      externalEventIdMac: index.mac(
        "google-calendar-event-id",
        owners.alpha,
        "delete-calendar-event"
      ),
      ...columns("externalEventId", envelope(2, "delete-calendar-event")),
      startAt: new Date("2026-07-20T10:00:00Z"),
      endAt: new Date("2026-07-20T11:00:00Z"),
      ...columns("details", envelope(2, { selfResponseStatus: "accepted" })),
    } as Prisma.CalendarEventUncheckedCreateInput,
  });
  const device = await seedDevice(owners.alpha, "delete-phone");
  await prisma.locationSample.create({
    data: {
      id: `${namespace}-delete-sample`,
      ownerId: owners.alpha,
      deviceId: device.id,
      recordedAt: now,
      receivedAt: now,
      ...columns("coordinates", envelope(2, { lat: 25.2, lon: 55.2 })),
      payloadMac: index.mac("owntracks-payload", owners.alpha, "delete"),
    } as Prisma.LocationSampleUncheckedCreateInput,
  });
  await seedDiscoveredEvent(owners.alpha, "delete-discovered-event");
  let preparedCalls = 0;
  let releaseBarrier: (() => void) | undefined;
  const bothPrepared = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const watches = {
    prepareOwnerStops: jest.fn(async () => {
      preparedCalls += 1;
      if (preparedCalls === 2) releaseBarrier?.();
      await bothPrepared;
      return [
        {
          id: `${namespace}-delete-watch`,
          ownerId: owners.alpha,
          connectionId: connection.id,
          channelId: `${namespace}-delete-channel`,
          resourceId: "delete-resource",
          expiresAt: new Date("2026-07-17T00:00:00Z"),
          accessToken: null,
          refreshToken: "synthetic-refresh-token",
        },
      ];
    }),
    stopPreparedBestEffort: jest
      .fn()
      .mockRejectedValue(new Error("synthetic provider stop failure")),
  };
  const service = new PersonalContextDeletionService(
    prisma,
    index as never,
    watches as never,
    () => now
  );

  const [first, second] = await Promise.all([
    service.deletePersonalContext(owners.alpha, "delete-intent-1", {
      confirmation: "DELETE_PERSONAL_CONTEXT",
    }),
    service.deletePersonalContext(owners.alpha, "delete-intent-1", {
      confirmation: "DELETE_PERSONAL_CONTEXT",
    }),
  ]);

  expect(first).toEqual(second);
  expect(first.rowCounts.calendar).toBeGreaterThanOrEqual(4);
  expect(first.rowCounts.location).toBe(2);
  expect(first.rowCounts.event).toBe(2);
  expect(watches.stopPreparedBestEffort).toHaveBeenCalledTimes(1);
  await expect(
    prisma.personalDataDeletionAudit.count({
      where: {
        idempotencyKeyMac: index.mac(
          "deletion-audit-idempotency-key",
          owners.alpha,
          "delete-intent-1"
        ),
      },
    })
  ).resolves.toBe(1);
  await expect(
    prisma.calendarWatch.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.calendarEvent.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.locationSample.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
  await expect(
    prisma.discoveredEvent.count({ where: { ownerId: owners.alpha } })
  ).resolves.toBe(0);
});

it("writes V1 briefs without event calls and retries V1.1 event recommendations inside transactions without quests", async () => {
  const now = new Date("2026-07-16T08:00:00Z");
  const vault = await seedVault(owners.alpha, "brief-vault");
  await seedContact(owners.alpha, vault.id, "brief-contact");
  const disabledRecommendations = { recommend: jest.fn() };
  const disabledService = new BriefGeneratorService(
    prisma,
    { collect: jest.fn().mockResolvedValue([]) } as never,
    disabledRecommendations as never,
    {
      isEnabled: (feature: string) => feature === "eventBrief" && false,
    } as never
  );

  const v1 = await disabledService.generateForOwner(owners.alpha, now);

  expect(v1.schemaVersion).toBe("1.0");
  expect(disabledRecommendations.recommend).not.toHaveBeenCalled();
  expect(v1.quests).toHaveLength(1);

  await prisma.briefBatch.deleteMany({ where: { ownerId: owners.alpha } });
  await prisma.contact.deleteMany({ where: { ownerId: owners.alpha } });
  const event = await seedDiscoveredEvent(owners.alpha, "brief-event", {
    city: "Dubai",
    countryCode: "AE",
    category: "community",
    tags: ["networking"],
  });
  const recommendationCalls: Array<unknown> = [];
  const enabledRecommendations = {
    recommend: jest.fn(async (ownerId: string, calledAt: Date, tx: any) => {
      recommendationCalls.push(tx);
      await tx.discoveredEvent.count({ where: { ownerId } });
      if (recommendationCalls.length === 1) {
        throw { code: "P2034", message: "synthetic serialization conflict" };
      }
      return [
        {
          kind: "event",
          contactId: null,
          sourceType: "discovered_event",
          sourceId: event.id,
          rank: 1,
          score: 88,
          title: event.title,
          reason: "Matches networking",
          startAt: event.startAt,
          endAt: event.endAt,
          city: event.city,
          evidence: {
            components: {
              time: 20,
              distance: 15,
              interests: 5,
              social: 10,
              contact: 0,
              novelty: 10,
              feedback: 0,
            },
            distanceBand: "2-10",
            conflict: "clear",
            context: { source: "calendar", freshness: "planned" },
            matchedTags: ["networking"],
            category: "community",
            plannedCity: "Dubai",
          },
        },
      ];
    }),
  };
  const enabledService = new BriefGeneratorService(
    prisma,
    { collect: jest.fn().mockResolvedValue([]) } as never,
    enabledRecommendations as never,
    {
      isEnabled: (feature: string) => feature === "eventBrief",
    } as never
  );

  const v11 = await enabledService.generateForOwner(owners.alpha, now);
  const batch = await prisma.briefBatch.findFirstOrThrow({
    where: { ownerId: owners.alpha },
    include: { items: true, quests: true },
  });

  expect(v11.schemaVersion).toBe("1.1");
  if (v11.schemaVersion !== "1.1") {
    throw new Error("Expected V1.1 event brief");
  }
  expect(v11.events).toHaveLength(1);
  expect(v11.quests).toHaveLength(0);
  expect(enabledRecommendations.recommend).toHaveBeenCalledTimes(2);
  expect(recommendationCalls).toHaveLength(2);
  expect(recommendationCalls.every((tx) => tx && tx !== prisma)).toBe(true);
  expect(batch.schemaVersion).toBe("1.1");
  expect(batch.items).toEqual([
    expect.objectContaining({
      kind: "event",
      sourceType: "discovered_event",
      sourceId: event.id,
    }),
  ]);
  expect(batch.quests).toHaveLength(0);
});

it("repairs missing calendar-list and event watches without real Google calls", async () => {
  const now = new Date("2026-07-16T14:30:00Z");
  const connection = await seedConnection(owners.alpha, "repair-connection");
  const source = await seedCalendarSource(
    owners.alpha,
    connection.id,
    "repair-calendar",
    { fullSyncRequired: false, selected: true }
  );
  const provider = {
    authorize: jest.fn().mockResolvedValue({ accessToken: "access-token" }),
    watchCalendarList: jest.fn().mockResolvedValue({
      resourceId: "list-resource",
      expiresAt: new Date("2026-07-20T00:00:00Z"),
    }),
    watchEvents: jest.fn().mockResolvedValue({
      resourceId: "events-resource",
      expiresAt: new Date("2026-07-20T00:00:00Z"),
    }),
    stopChannel: jest.fn().mockResolvedValue(undefined),
  };
  const ids = [
    `${namespace}-repair-list-watch`,
    `${namespace}-repair-list-channel`,
    `${namespace}-repair-events-watch`,
    `${namespace}-repair-events-channel`,
  ];
  const service = new CalendarWatchService(
    prisma,
    cipher as never,
    index as never,
    enabledConfig as never,
    provider as never,
    { get: () => "https://calendar-location.test.invalid/webhook" } as never,
    () => ids.shift() ?? `${namespace}-repair-extra-id`,
    () => "repair-token"
  );

  await service.maintain(now);

  expect(provider.watchCalendarList).toHaveBeenCalledTimes(1);
  expect(provider.watchEvents).toHaveBeenCalledWith(
    "access-token",
    "repair-calendar-calendar-id",
    expect.objectContaining({
      address: "https://calendar-location.test.invalid/webhook",
    })
  );
  const watches = await prisma.calendarWatch.findMany({
    where: { ownerId: owners.alpha },
    orderBy: { targetType: "asc" },
  });
  expect(watches).toEqual([
    expect.objectContaining({
      targetType: "calendar_list",
      targetKey: connection.id,
      status: "active",
    }),
    expect.objectContaining({
      targetType: "events",
      targetKey: source.id,
      status: "active",
    }),
  ]);
});

it("reads old and new key-version envelopes and resumes event-envelope rekeying", async () => {
  const source = await seedEventSource(owners.alpha, "rekey-source", null);
  const oldEvent = await seedDiscoveredEvent(owners.alpha, "rekey-old-event", {
    sourceId: source.id,
    providerEnvelope: envelope(1, "old-provider-event"),
  });
  const newEvent = await seedDiscoveredEvent(owners.alpha, "rekey-new-event", {
    sourceId: source.id,
    providerEnvelope: envelope(2, "new-provider-event"),
  });

  const rows = await prisma.discoveredEvent.findMany({
    where: { id: { in: [oldEvent.id, newEvent.id] } },
    orderBy: { id: "asc" },
  });
  expect(rows.map((row) => row.providerEventIdKeyVersion).sort()).toEqual([
    1, 2,
  ]);
  expect(
    rows.map((row) =>
      cipher.decrypt("discovered-event-provider-event-id", owners.alpha, row.id, {
        ciphertext: Buffer.from(row.providerEventIdCiphertext),
        iv: Buffer.from(row.providerEventIdIv),
        tag: Buffer.from(row.providerEventIdTag),
        keyVersion: row.providerEventIdKeyVersion,
      })
    )
  ).toEqual(expect.arrayContaining(["old-provider-event", "new-provider-event"]));

  await prisma.discoveredEvent.update({
    where: { id: oldEvent.id },
    data: {
      ...columns("providerEventId", envelope(2, "old-provider-event")),
    },
  });
  const remainingOld = await prisma.discoveredEvent.count({
    where: { ownerId: owners.alpha, providerEventIdKeyVersion: 1 },
  });
  expect(remainingOld).toBe(0);
});

async function seedDevice(ownerId: string, label: string) {
  const id = `${namespace}-${label}`;
  const username = createHash("sha256")
    .update(`${namespace}:${label}`)
    .digest("hex")
    .slice(0, 32);
  await prisma.locationDevice.create({
    data: {
      id,
      ownerId,
      nameMac: index.mac("location-device-name", ownerId, label),
      ...columns("name", envelope(2, label)),
      username,
      credentialHash: syntheticCredentialHash,
      externalDeviceIdMac: index.mac("location-device-external", ownerId, label),
      ...columns("externalDeviceId", envelope(2, `${label}-external`)),
    } as Prisma.LocationDeviceUncheckedCreateInput,
  });
  return {
    id,
    ownerId,
    username,
  };
}

async function seedConnection(ownerId: string, label: string) {
  return prisma.googleCalendarConnection.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      ...columns("refreshToken", envelope(2, `${label}-refresh-token`)),
      grantedScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      status: "active",
    } as Prisma.GoogleCalendarConnectionUncheckedCreateInput,
  });
}

async function seedCalendarSource(
  ownerId: string,
  connectionId: string,
  label: string,
  options: { selected?: boolean; fullSyncRequired?: boolean } = {}
) {
  return prisma.calendarSource.create({
    data: {
      id: `${namespace}-${label}-source`,
      connectionId,
      ownerId,
      externalIdMac: index.mac("google-calendar-source-id", ownerId, label),
      ...columns("externalId", envelope(2, `${label}-calendar-id`)),
      ...columns("name", envelope(2, `${label} Calendar`)),
      selected: options.selected ?? true,
      fullSyncRequired: options.fullSyncRequired ?? false,
    } as Prisma.CalendarSourceUncheckedCreateInput,
  });
}

async function seedCalendarEvent(ownerId: string, label: string) {
  const connection = await seedConnection(ownerId, `${label}-connection`);
  const source = await seedCalendarSource(ownerId, connection.id, label, {
    selected: true,
  });
  return prisma.calendarEvent.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      sourceId: source.id,
      externalEventIdMac: index.mac(
        "google-calendar-event-id",
        ownerId,
        label
      ),
      ...columns("externalEventId", envelope(2, `${label}-external-event`)),
      startAt: new Date("2026-07-20T10:00:00Z"),
      endAt: new Date("2026-07-20T11:00:00Z"),
      ...columns("details", envelope(2, { summary: label })),
    } as Prisma.CalendarEventUncheckedCreateInput,
  });
}

async function seedEventSource(
  ownerId: string,
  label: string,
  leaseUntil: Date | null
) {
  return prisma.eventSource.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      provider: "ics",
      externalSourceId: `${label}-external`,
      name: `${label} Events`,
      feedUrlMac: index.mac(
        "event-source-feed-url",
        ownerId,
        "https://events.test.invalid/feed.ics"
      ),
      ...columns(
        "feedUrl",
        envelope(2, "https://events.test.invalid/feed.ics")
      ),
      allowedHost: "events.test.invalid",
      nextPollAt: new Date("2026-07-16T00:00:00Z"),
      leaseUntil,
    } as Prisma.EventSourceUncheckedCreateInput,
  });
}

async function seedDiscoveredEvent(
  ownerId: string,
  label: string,
  options: {
    sourceId?: string;
    providerEnvelope?: EncryptedValue;
    city?: string | null;
    countryCode?: string | null;
    category?: string | null;
    tags?: string[];
  } = {}
) {
  const sourceId =
    options.sourceId ?? (await seedEventSource(ownerId, `${label}-source`, null)).id;
  const providerEnvelope = options.providerEnvelope ?? envelope(2, label);
  return prisma.discoveredEvent.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      sourceId,
      providerEventIdMac: index.mac(
        "discovered-event-provider-event-id",
        ownerId,
        label
      ),
      ...columns("providerEventId", providerEnvelope),
      canonicalMac: index.mac("canonical-event", ownerId, `${label}-canonical`),
      title: `${label} title`,
      startAt: new Date("2026-07-20T15:00:00Z"),
      endAt: new Date("2026-07-20T16:00:00Z"),
      city: options.city,
      countryCode: options.countryCode,
      category: options.category,
      tags: options.tags ?? [],
      status: "scheduled",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    } as Prisma.DiscoveredEventUncheckedCreateInput,
  });
}

async function seedVault(ownerId: string, label: string) {
  return prisma.vault.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      name: `${label} Vault`,
    },
  });
}

async function seedContact(ownerId: string, vaultId: string, label: string) {
  return prisma.contact.create({
    data: {
      id: `${namespace}-${label}`,
      ownerId,
      vaultId,
      firstName: "Synthetic",
      lastName: label,
      importance: 4,
      preferredCadenceDays: 30,
      lastContactedAt: new Date("2026-05-01T00:00:00Z"),
    },
  });
}

function envelope(version: number, value: unknown): EncryptedValue {
  return {
    ciphertext: Buffer.from(JSON.stringify({ value })),
    iv: Buffer.from(`iv-${version}`.padEnd(12, "0")),
    tag: Buffer.from(`tag-${version}`.padEnd(16, "0")),
    keyVersion: version,
  };
}

function columns(prefix: string, value: EncryptedValue) {
  return {
    [`${prefix}Ciphertext`]: value.ciphertext as Uint8Array<ArrayBuffer>,
    [`${prefix}Iv`]: value.iv as Uint8Array<ArrayBuffer>,
    [`${prefix}Tag`]: value.tag as Uint8Array<ArrayBuffer>,
    [`${prefix}KeyVersion`]: value.keyVersion,
  };
}
