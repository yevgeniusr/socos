import type { PrismaService } from "../prisma/prisma.service.js";
import type { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import type { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import type { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import type { LocationAliasService } from "../location/location-alias.service.js";
import {
  CalendarSyncService,
  GOOGLE_CALENDAR_PROVIDER,
  normalizeProviderEvent,
  type GoogleCalendarProvider,
} from "./calendar-sync.service.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const OWNER = "owner-synthetic";
const CONNECTION = "connection-synthetic";
const SOURCE = "source-synthetic";
const LEASE = new Date("2026-07-16T12:05:00.000Z");
const envelope = {
  ciphertext: Buffer.from("cipher"),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
  keyVersion: 1,
};

function provider(): jest.Mocked<GoogleCalendarProvider> {
  return {
    authorize: jest.fn().mockResolvedValue({ accessToken: "access" }),
    listCalendars: jest.fn(),
    listEvents: jest.fn(),
    watchCalendarList: jest.fn(),
    watchEvents: jest.fn(),
    stopChannel: jest.fn(),
  };
}

function harness() {
  const transaction = {
    calendarSource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    cityStay: { deleteMany: jest.fn() },
    googleCalendarConnection: { updateMany: jest.fn() },
  };
  const prisma = {
    calendarSource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    googleCalendarConnection: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(
      async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)
    ),
  };
  const cipher = {
    decrypt: jest.fn((purpose: string) =>
      purpose === "google-calendar-refresh-token" ? "refresh" : "token"
    ),
    encrypt: jest.fn().mockReturnValue(envelope),
  };
  const index = { mac: jest.fn((_p, _o, value) => `mac:${value}`) };
  const config = { requireEnabled: jest.fn() };
  const aliases = { rebuildCalendarStays: jest.fn() };
  const google = provider();
  const ids = jest
    .fn()
    .mockReturnValueOnce("event-one")
    .mockReturnValue("event-two");
  const service = new CalendarSyncService(
    prisma as unknown as PrismaService,
    cipher as unknown as PersonalDataCipherService,
    index as unknown as PersonalDataIndexService,
    config as unknown as PersonalDataConfigService,
    aliases as unknown as LocationAliasService,
    google,
    ids
  );
  return { service, prisma, transaction, cipher, aliases, google };
}

describe("CalendarSyncService", () => {
  it("keeps exact full-sync bounds and base parameters on every page", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      ownerId: OWNER,
      connectionId: CONNECTION,
      pendingSyncAt: NOW,
      syncLeaseUntil: null,
      fullSyncRequired: true,
      syncTokenCiphertext: null,
      externalIdCiphertext: Buffer.from("x"),
      externalIdIv: envelope.iv,
      externalIdTag: envelope.tag,
      externalIdKeyVersion: 1,
      connection: {
        status: "active",
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    google.listEvents
      .mockResolvedValueOnce({ items: [], nextPageToken: "page-2" })
      .mockResolvedValueOnce({ items: [], nextSyncToken: "terminal" });
    transaction.calendarSource.updateMany.mockResolvedValue({ count: 1 });

    await service.runNextSource(NOW);

    const base = {
      singleEvents: true,
      showDeleted: true,
      maxResults: 2500,
      timeMin: "2026-01-17T12:00:00.000Z",
      timeMax: "2027-07-16T12:00:00.000Z",
    };
    expect(google.listEvents).toHaveBeenNthCalledWith(
      1,
      "access",
      "token",
      base
    );
    expect(google.listEvents).toHaveBeenNthCalledWith(2, "access", "token", {
      ...base,
      pageToken: "page-2",
    });
    expect(transaction.calendarEvent.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, sourceId: SOURCE },
    });
    expect(transaction.calendarSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SOURCE,
          ownerId: OWNER,
          syncLeaseUntil: LEASE,
          pendingSyncAt: NOW,
        }),
        data: expect.objectContaining({
          fullSyncRequired: false,
          pendingSyncAt: null,
          syncLeaseUntil: null,
        }),
      })
    );
  });

  it("uses only stable parameters plus the original token for every incremental page", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      ownerId: OWNER,
      connectionId: CONNECTION,
      pendingSyncAt: NOW,
      syncLeaseUntil: null,
      fullSyncRequired: false,
      syncTokenCiphertext: Buffer.from("s"),
      syncTokenIv: envelope.iv,
      syncTokenTag: envelope.tag,
      syncTokenKeyVersion: 1,
      externalIdCiphertext: Buffer.from("x"),
      externalIdIv: envelope.iv,
      externalIdTag: envelope.tag,
      externalIdKeyVersion: 1,
      connection: {
        status: "active",
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    google.listEvents
      .mockResolvedValueOnce({ items: [], nextPageToken: "next" })
      .mockResolvedValueOnce({ items: [], nextSyncToken: "terminal" });
    transaction.calendarSource.updateMany.mockResolvedValue({ count: 1 });

    await service.runNextSource(NOW);

    expect(google.listEvents.mock.calls.map((call) => call[2])).toEqual([
      {
        singleEvents: true,
        showDeleted: true,
        maxResults: 2500,
        syncToken: "token",
      },
      {
        singleEvents: true,
        showDeleted: true,
        maxResults: 2500,
        syncToken: "token",
        pageToken: "next",
      },
    ]);
  });

  it("atomically fail-closes a 410 without retrying in the same call", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      ownerId: OWNER,
      connectionId: CONNECTION,
      pendingSyncAt: NOW,
      syncLeaseUntil: null,
      fullSyncRequired: false,
      syncTokenCiphertext: Buffer.from("s"),
      syncTokenIv: envelope.iv,
      syncTokenTag: envelope.tag,
      syncTokenKeyVersion: 1,
      externalIdCiphertext: Buffer.from("x"),
      externalIdIv: envelope.iv,
      externalIdTag: envelope.tag,
      externalIdKeyVersion: 1,
      connection: {
        status: "active",
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    google.listEvents.mockRejectedValue({ code: 410 });
    transaction.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    transaction.calendarEvent.findMany.mockResolvedValue([
      { id: "event-from-failed-source" },
    ]);

    await service.runNextSource(NOW);

    expect(google.listEvents).toHaveBeenCalledTimes(1);
    expect(transaction.calendarEvent.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, sourceId: SOURCE },
    });
    expect(transaction.cityStay.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerId: OWNER,
        source: "calendar",
        sourceId: { in: ["event-from-failed-source"] },
      },
    });
    expect(transaction.calendarSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullSyncRequired: true,
          pendingSyncAt: new Date(NOW.getTime() + 1),
          syncLeaseUntil: null,
          syncTokenCiphertext: null,
          syncTokenIv: null,
          syncTokenTag: null,
          syncTokenKeyVersion: null,
        }),
      })
    );
  });

  it("does not commit pages after the exact lease fence is lost", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      ownerId: OWNER,
      connectionId: CONNECTION,
      pendingSyncAt: NOW,
      syncLeaseUntil: null,
      fullSyncRequired: true,
      syncTokenCiphertext: null,
      externalIdCiphertext: Buffer.from("x"),
      externalIdIv: envelope.iv,
      externalIdTag: envelope.tag,
      externalIdKeyVersion: 1,
      connection: {
        status: "active",
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    google.listEvents.mockResolvedValue({
      items: [],
      nextSyncToken: "terminal",
    });
    transaction.calendarSource.updateMany.mockResolvedValue({ count: 0 });

    await service.runNextSource(NOW);

    expect(transaction.calendarEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("releases a lease without overwriting a newer pending generation on failure", async () => {
    const { service, prisma, google } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      ownerId: OWNER,
      connectionId: CONNECTION,
      pendingSyncAt: NOW,
      syncLeaseUntil: null,
      fullSyncRequired: true,
      syncTokenCiphertext: null,
      externalIdCiphertext: Buffer.from("x"),
      externalIdIv: envelope.iv,
      externalIdTag: envelope.tag,
      externalIdKeyVersion: 1,
      connection: {
        status: "active",
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    google.listEvents.mockRejectedValue({ code: 503 });

    await service.runNextSource(NOW);

    expect(prisma.calendarSource.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: SOURCE,
          ownerId: OWNER,
          syncLeaseUntil: LEASE,
          pendingSyncAt: NOW,
        }),
      })
    );
    expect(prisma.calendarSource.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: SOURCE, ownerId: OWNER, syncLeaseUntil: LEASE },
      data: {
        syncLeaseUntil: null,
        errorCode: "google_calendar_temporarily_unavailable",
      },
    });
  });

  it("marks daily full reconciliation without overwriting future backoff", async () => {
    const { service, prisma } = harness();
    const future = new Date("2026-07-16T12:10:00.000Z");
    prisma.calendarSource.findMany.mockResolvedValue([
      { id: SOURCE, ownerId: OWNER, pendingSyncAt: future },
    ]);
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    const { createHash } = await import("node:crypto");
    const slot =
      createHash("sha256").update(SOURCE).digest().readUInt32BE(0) % 96;

    await service.markDailyReconciliation(NOW, slot);

    expect(prisma.calendarSource.updateMany).toHaveBeenCalledWith({
      where: { id: SOURCE, ownerId: OWNER, selected: true },
      data: { fullSyncRequired: true },
    });
  });
});

describe("normalizeProviderEvent", () => {
  it("maps all-day exclusive dates through local midnight across DST", () => {
    const normalized = normalizeProviderEvent(
      {
        id: "event",
        status: "confirmed",
        start: { date: "2026-03-08" },
        end: { date: "2026-03-10" },
      },
      "America/New_York",
      NOW
    );
    expect(normalized?.startAt.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(normalized?.endAt.toISOString()).toBe("2026-03-10T04:00:00.000Z");
    expect(normalized).toMatchObject({
      allDay: true,
      startDate: "2026-03-08",
      endDate: "2026-03-10",
    });
  });

  it("rejects floating or inverted timed events and preserves sparse cancellations", () => {
    expect(
      normalizeProviderEvent(
        {
          id: "bad",
          start: { dateTime: "2026-07-16T10:00:00" },
          end: { dateTime: "2026-07-16T11:00:00Z" },
        },
        "UTC",
        NOW
      )
    ).toBeNull();
    expect(
      normalizeProviderEvent(
        {
          id: "bad",
          start: { dateTime: "2026-07-16T12:00:00Z" },
          end: { dateTime: "2026-07-16T11:00:00Z" },
        },
        "UTC",
        NOW
      )
    ).toBeNull();
    expect(
      normalizeProviderEvent({ id: "gone", status: "cancelled" }, "UTC", NOW)
    ).toMatchObject({
      id: "gone",
      status: "cancelled",
      startAt: null,
      endAt: null,
    });
  });
});

expect(GOOGLE_CALENDAR_PROVIDER).toBeDefined();
