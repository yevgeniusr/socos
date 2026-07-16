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
import { reconciliationSlot } from "./calendar-scheduler.service.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const OWNER = "owner-synthetic";
const CONNECTION = "connection-synthetic";
const SOURCE = "source-synthetic";
const LEASE = new Date("2026-07-16T12:05:00.000Z");
const CONNECTION_GENERATION = new Date("2026-07-16T11:59:00.000Z");
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
      findMany: jest.fn().mockResolvedValue([]),
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
    calendarWatch: { updateMany: jest.fn() },
    cityStay: { deleteMany: jest.fn() },
    googleCalendarConnection: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
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

  it("does not demote or clear leases when reconnect wins a source invalid_grant race", async () => {
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
        updatedAt: CONNECTION_GENERATION,
        refreshTokenCiphertext: Buffer.from("r"),
        refreshTokenIv: envelope.iv,
        refreshTokenTag: envelope.tag,
        refreshTokenKeyVersion: 1,
      },
    });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    google.listEvents.mockRejectedValue({ code: "invalid_grant" });
    transaction.googleCalendarConnection.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.runNextSource(NOW);

    expect(
      transaction.googleCalendarConnection.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: CONNECTION,
        ownerId: OWNER,
        status: "active",
        updatedAt: CONNECTION_GENERATION,
        sources: {
          some: {
            id: SOURCE,
            ownerId: OWNER,
            pendingSyncAt: NOW,
            syncLeaseUntil: LEASE,
          },
        },
      },
      data: expect.objectContaining({ status: "needs_reauth" }),
    });
    expect(transaction.calendarSource.updateMany).not.toHaveBeenCalled();
  });

  it("does not demote or clear leases when reconnect wins a list invalid_grant race", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: CONNECTION,
      ownerId: OWNER,
      status: "active",
      updatedAt: CONNECTION_GENERATION,
      calendarListPendingAt: NOW,
      calendarListLeaseUntil: null,
      calendarListSyncTokenCiphertext: null,
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    google.authorize.mockRejectedValue({ code: "invalid_grant" });
    transaction.googleCalendarConnection.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.runNextCalendarList(NOW);

    expect(
      transaction.googleCalendarConnection.updateMany
    ).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: CONNECTION,
        ownerId: OWNER,
        status: "active",
        calendarListLeaseUntil: LEASE,
        calendarListPendingAt: NOW,
      }),
      data: expect.objectContaining({ status: "needs_reauth" }),
    });
    expect(transaction.calendarSource.updateMany).not.toHaveBeenCalled();
  });

  it("uses stable source slots for two sources owned by the same person", async () => {
    const { service, prisma } = harness();
    const first = { id: "source-1", slot: reconciliationSlot("source-1") };
    const second = { id: "source-3", slot: reconciliationSlot("source-3") };
    expect(first.slot).toBeLessThan(second.slot);
    const now = new Date(Date.UTC(2026, 6, 16, 0, first.slot * 15, 0, 0));
    const priorDay = Date.UTC(2026, 6, 15, 0, 0, 0, 0);
    prisma.calendarSource.findMany.mockResolvedValue([
      {
        id: first.id,
        ownerId: OWNER,
        pendingSyncAt: null,
        lastFullReconciledAt: new Date(priorDay + first.slot * 15 * 60 * 1000),
      },
      {
        id: second.id,
        ownerId: OWNER,
        pendingSyncAt: null,
        lastFullReconciledAt: new Date(priorDay + second.slot * 15 * 60 * 1000),
      },
    ]);
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });

    await service.markDailyReconciliation(now, first.slot);

    expect(prisma.calendarSource.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.calendarSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: first.id, ownerId: OWNER }),
      })
    );
  });

  it("catches a missed source slot without overwriting future backoff", async () => {
    const { service, prisma } = harness();
    const source = Array.from({ length: 20 }, (_, index) => `missed-${index}`)
      .map((id) => ({ id, slot: reconciliationSlot(id) }))
      .find((candidate) => candidate.slot < 95)!;
    const currentSlot = source.slot + 1;
    const now = new Date(Date.UTC(2026, 6, 16, 0, currentSlot * 15, 0, 0));
    const future = new Date(now.getTime() + 10 * 60 * 1000);
    prisma.calendarSource.findMany.mockResolvedValue([
      {
        id: source.id,
        ownerId: OWNER,
        pendingSyncAt: future,
        lastFullReconciledAt: new Date(
          Date.UTC(2026, 6, 15, 0, source.slot * 15, 0, 0)
        ),
      },
    ]);
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });

    await service.markDailyReconciliation(now, currentSlot);

    expect(prisma.calendarSource.updateMany).toHaveBeenCalledWith({
      where: {
        id: source.id,
        ownerId: OWNER,
        selected: true,
        pendingSyncAt: future,
        lastFullReconciledAt: new Date(
          Date.UTC(2026, 6, 15, 0, source.slot * 15, 0, 0)
        ),
      },
      data: {
        fullSyncRequired: true,
        pendingSyncAt: new Date(future.getTime() + 1),
      },
    });
  });

  it("repeats exact calendar-list parameters and preserves local selection on commit", async () => {
    const { service, prisma, transaction, google } = harness();
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: CONNECTION,
      ownerId: OWNER,
      status: "active",
      updatedAt: CONNECTION_GENERATION,
      calendarListPendingAt: NOW,
      calendarListLeaseUntil: null,
      calendarListSyncTokenCiphertext: null,
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    google.listCalendars
      .mockResolvedValueOnce({ items: [], nextPageToken: "page-2" })
      .mockResolvedValueOnce({
        items: [
          {
            id: "provider-calendar",
            summary: "Provider name",
            selected: true,
          },
        ],
        nextSyncToken: "terminal-list-token",
      });
    transaction.googleCalendarConnection.updateMany.mockResolvedValue({
      count: 1,
    });
    transaction.calendarSource.findFirst.mockResolvedValue({
      id: SOURCE,
      selected: false,
    });

    await service.runNextCalendarList(NOW);

    const base = { showDeleted: true, showHidden: true, maxResults: 250 };
    expect(google.listCalendars).toHaveBeenNthCalledWith(1, "access", base);
    expect(google.listCalendars).toHaveBeenNthCalledWith(2, "access", {
      ...base,
      pageToken: "page-2",
    });
    const sourceUpdate = transaction.calendarSource.updateMany.mock.calls[0][0];
    expect(sourceUpdate.data).not.toHaveProperty("selected");
    expect(sourceUpdate.data).not.toHaveProperty("pendingSyncAt");
    expect(
      transaction.googleCalendarConnection.updateMany
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calendarListPendingAt: null,
          calendarListLeaseUntil: null,
        }),
      })
    );
  });

  it("resets a 410 while preserving a newer calendar-list pending generation", async () => {
    const { service, prisma, transaction, google } = harness();
    const newer = new Date(NOW.getTime() + 20);
    prisma.googleCalendarConnection.findFirst.mockResolvedValue({
      id: CONNECTION,
      ownerId: OWNER,
      status: "active",
      updatedAt: CONNECTION_GENERATION,
      calendarListPendingAt: NOW,
      calendarListLeaseUntil: null,
      calendarListSyncTokenCiphertext: Buffer.from("s"),
      calendarListSyncTokenIv: envelope.iv,
      calendarListSyncTokenTag: envelope.tag,
      calendarListSyncTokenKeyVersion: 1,
      refreshTokenCiphertext: Buffer.from("r"),
      refreshTokenIv: envelope.iv,
      refreshTokenTag: envelope.tag,
      refreshTokenKeyVersion: 1,
    });
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    google.listCalendars.mockRejectedValue({ code: 410 });
    transaction.googleCalendarConnection.updateMany.mockResolvedValue({
      count: 1,
    });
    transaction.googleCalendarConnection.findFirst.mockResolvedValue({
      calendarListPendingAt: newer,
    });

    await service.runNextCalendarList(NOW);

    expect(
      transaction.googleCalendarConnection.updateMany
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          calendarListPendingAt: new Date(newer.getTime() + 1),
          calendarListSyncTokenCiphertext: null,
        }),
      })
    );
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

  it("fails closed when a civil date has no local midnight", () => {
    expect(
      normalizeProviderEvent(
        {
          id: "skipped-date",
          start: { date: "2011-12-30" },
          end: { date: "2011-12-31" },
        },
        "Pacific/Apia",
        NOW
      )
    ).toBeNull();
  });
});

expect(GOOGLE_CALENDAR_PROVIDER).toBeDefined();
