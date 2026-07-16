import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PersonalContextDeletionService } from "./personal-context-deletion.service.js";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const VALID_BODY = { confirmation: "DELETE_PERSONAL_CONTEXT" };
const VALID_KEY = "Delete-Key:1234";

function audit(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    ownerMac: "mac:deletion-audit-owner:owner-1:personal-context",
    idempotencyKeyMac:
      "mac:deletion-audit-idempotency-key:owner-1:Delete-Key:1234",
    requestMac:
      'mac:deletion-audit-request:owner-1:{"confirmation":"DELETE_PERSONAL_CONTEXT"}',
    categories: ["calendar", "location", "event"],
    calendarRowCount: 7,
    locationRowCount: 3,
    eventRowCount: 5,
    deletedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function harness() {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: "owner-1" }),
    },
    personalDataDeletionAudit: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => {
        calls.push("audit");
        return audit({
          ownerMac: data.ownerMac,
          idempotencyKeyMac: data.idempotencyKeyMac,
          requestMac: data.requestMac,
          categories: data.categories,
          calendarRowCount: data.calendarRowCount,
          locationRowCount: data.locationRowCount,
          eventRowCount: data.eventRowCount,
          deletedAt: data.deletedAt,
        });
      }),
    },
    calendarEvent: {
      deleteMany: jest.fn(async () => {
        calls.push("calendarEvent");
        return { count: 1 };
      }),
    },
    cityStay: {
      deleteMany: jest.fn(async () => {
        calls.push("cityStay");
        return { count: 1 };
      }),
    },
    calendarWatch: {
      deleteMany: jest.fn(async () => {
        calls.push("calendarWatch");
        return { count: 1 };
      }),
    },
    calendarSource: {
      deleteMany: jest.fn(async () => {
        calls.push("calendarSource");
        return { count: 1 };
      }),
    },
    googleCalendarConnection: {
      deleteMany: jest.fn(async () => {
        calls.push("googleCalendarConnection");
        return { count: 1 };
      }),
    },
    googleOAuthAttempt: {
      deleteMany: jest.fn(async () => {
        calls.push("googleOAuthAttempt");
        return { count: 1 };
      }),
    },
    locationSample: {
      deleteMany: jest.fn(async () => {
        calls.push("locationSample");
        return { count: 1 };
      }),
    },
    derivedVisit: {
      deleteMany: jest.fn(async () => {
        calls.push("derivedVisit");
        return { count: 1 };
      }),
    },
    locationAlias: {
      deleteMany: jest.fn(async () => {
        calls.push("locationAlias");
        return { count: 1 };
      }),
    },
    locationDevice: {
      deleteMany: jest.fn(async () => {
        calls.push("locationDevice");
        return { count: 1 };
      }),
    },
    briefFeedback: {
      deleteMany: jest.fn(async () => {
        calls.push("briefFeedback");
        return { count: 1 };
      }),
    },
    briefItem: {
      deleteMany: jest.fn(async () => {
        calls.push("briefItem");
        return { count: 1 };
      }),
    },
    discoveredEvent: {
      deleteMany: jest.fn(async () => {
        calls.push("discoveredEvent");
        return { count: 1 };
      }),
    },
    eventSource: {
      deleteMany: jest.fn(async () => {
        calls.push("eventSource");
        return { count: 1 };
      }),
    },
    eventPreference: {
      deleteMany: jest.fn(async () => {
        calls.push("eventPreference");
        return { count: 1 };
      }),
    },
    contact: { deleteMany: jest.fn() },
    interaction: { deleteMany: jest.fn() },
    reminder: { deleteMany: jest.fn() },
    quest: { deleteMany: jest.fn() },
    xpTransaction: { deleteMany: jest.fn() },
    agentClient: { deleteMany: jest.fn() },
  };
  const prisma = {
    personalDataDeletionAudit: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    ),
  };
  const index = {
    mac: jest.fn((purpose: string, ownerId: string, value: string) =>
      ["mac", purpose, ownerId, value].join(":")
    ),
    verify: jest.fn(
      (mac: string, purpose: string, ownerId: string, value: string) =>
        mac === ["mac", purpose, ownerId, value].join(":")
    ),
  };
  const watches = {
    prepareOwnerStops: jest.fn().mockResolvedValue([{ id: "watch-1" }]),
    stopPreparedBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PersonalContextDeletionService(
    prisma as never,
    index as never,
    watches as never,
    () => NOW
  );
  return { service, prisma, tx, index, watches, calls };
}

describe("PersonalContextDeletionService", () => {
  it("uses the exact required MAC inputs without normalizing the idempotency key", async () => {
    const { service, index } = harness();

    await service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY);

    expect(index.mac).toHaveBeenCalledWith(
      "deletion-audit-owner",
      "owner-1",
      "personal-context"
    );
    expect(index.mac).toHaveBeenCalledWith(
      "deletion-audit-idempotency-key",
      "owner-1",
      VALID_KEY
    );
    expect(index.mac).toHaveBeenCalledWith(
      "deletion-audit-request",
      "owner-1",
      '{"confirmation":"DELETE_PERSONAL_CONTEXT"}'
    );
  });

  it("returns a valid fast replay without preparing provider stops or mutating rows", async () => {
    const { service, prisma, watches } = harness();
    prisma.personalDataDeletionAudit.findUnique.mockResolvedValue(audit());

    const result = await service.deletePersonalContext(
      "owner-1",
      VALID_KEY,
      VALID_BODY
    );

    expect(result).toEqual({
      deletedAt: NOW,
      categories: ["calendar", "location", "event"],
      rowCounts: { calendar: 7, location: 3, event: 5 },
    });
    expect(watches.prepareOwnerStops).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a matching idempotency key with mismatched stored owner or request MAC", async () => {
    const { service, prisma } = harness();
    prisma.personalDataDeletionAudit.findUnique.mockResolvedValue(
      audit({ ownerMac: "0".repeat(64) })
    );

    await expect(
      service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY)
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("prepares provider stops before the transaction and calls Google stop only after commit", async () => {
    const { service, prisma, watches, tx } = harness();
    const order: string[] = [];
    watches.prepareOwnerStops.mockImplementation(async () => {
      order.push("prepare");
      return [{ id: "watch-1" }];
    });
    prisma.$transaction.mockImplementation(async (callback: any) => {
      order.push("transaction-start");
      const result = await callback(tx);
      order.push("commit");
      return result;
    });
    watches.stopPreparedBestEffort.mockImplementation(async () => {
      order.push("stop");
    });

    await service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY);

    expect(watches.prepareOwnerStops).toHaveBeenCalledWith("owner-1", NOW);
    expect(watches.stopPreparedBestEffort).toHaveBeenCalledWith(
      [{ id: "watch-1" }],
      NOW
    );
    expect(order).toEqual(["prepare", "transaction-start", "commit", "stop"]);
  });

  it("locks the owner row, deletes explicit owner-scoped rows in dependency order, and inserts audit last", async () => {
    const { service, tx, calls } = harness();

    await service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: "owner-1" },
      select: { id: true },
    });
    expect(calls).toEqual([
      "calendarEvent",
      "cityStay",
      "calendarWatch",
      "calendarSource",
      "googleCalendarConnection",
      "googleOAuthAttempt",
      "locationSample",
      "derivedVisit",
      "locationAlias",
      "locationDevice",
      "briefFeedback",
      "briefItem",
      "discoveredEvent",
      "eventSource",
      "eventPreference",
      "audit",
    ]);
    for (const delegate of [
      tx.calendarEvent,
      tx.cityStay,
      tx.calendarWatch,
      tx.calendarSource,
      tx.googleCalendarConnection,
      tx.googleOAuthAttempt,
      tx.locationSample,
      tx.derivedVisit,
      tx.locationAlias,
      tx.locationDevice,
      tx.eventPreference,
    ]) {
      expect(delegate.deleteMany).toHaveBeenCalledWith({
        where: { ownerId: "owner-1" },
      });
    }
    expect(tx.briefFeedback.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-1",
        briefItem: { kind: "event" },
      },
    });
    expect(tx.briefItem.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1", kind: "event" },
    });
    expect(tx.discoveredEvent.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1" },
    });
    expect(tx.eventSource.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1" },
    });
    expect(tx.contact.deleteMany).not.toHaveBeenCalled();
    expect(tx.interaction.deleteMany).not.toHaveBeenCalled();
    expect(tx.reminder.deleteMany).not.toHaveBeenCalled();
    expect(tx.quest.deleteMany).not.toHaveBeenCalled();
    expect(tx.xpTransaction.deleteMany).not.toHaveBeenCalled();
    expect(tx.agentClient.deleteMany).not.toHaveBeenCalled();
  });

  it("stores fixed categories with aggregate deleteMany counts including zero-count domains", async () => {
    const { service, tx } = harness();
    tx.calendarEvent.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.cityStay.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.calendarWatch.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.calendarSource.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.googleCalendarConnection.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.googleOAuthAttempt.deleteMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.deletePersonalContext(
      "owner-1",
      VALID_KEY,
      VALID_BODY
    );

    expect(tx.personalDataDeletionAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        categories: ["calendar", "location", "event"],
        calendarRowCount: 0,
        locationRowCount: 4,
        eventRowCount: 5,
        deletedAt: NOW,
      }),
    });
    expect(result.rowCounts).toEqual({ calendar: 0, location: 4, event: 5 });
  });

  it("rolls back without provider stop when audit insert fails", async () => {
    const { service, tx, watches } = harness();
    tx.personalDataDeletionAudit.create.mockRejectedValueOnce(
      new Error("audit failed")
    );

    await expect(
      service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY)
    ).rejects.toThrow("audit failed");
    expect(watches.stopPreparedBestEffort).not.toHaveBeenCalled();
  });

  it("converges on a winning valid audit after P2002 without stopping prepared channels", async () => {
    const { service, prisma, tx, watches } = harness();
    tx.personalDataDeletionAudit.create.mockRejectedValueOnce({ code: "P2002" });
    prisma.personalDataDeletionAudit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(audit());

    const result = await service.deletePersonalContext(
      "owner-1",
      VALID_KEY,
      VALID_BODY
    );

    expect(result.rowCounts).toEqual({ calendar: 7, location: 3, event: 5 });
    expect(watches.stopPreparedBestEffort).not.toHaveBeenCalled();
  });

  it("retries bounded P2034 serialization conflicts before converging on the committed audit", async () => {
    const { service, prisma } = harness();
    prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });
    prisma.personalDataDeletionAudit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(audit());

    const result = await service.deletePersonalContext(
      "owner-1",
      VALID_KEY,
      VALID_BODY
    );

    expect(result.rowCounts).toEqual({ calendar: 7, location: 3, event: 5 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not fail deletion when post-commit provider stop fails", async () => {
    const { service, watches } = harness();
    watches.stopPreparedBestEffort.mockRejectedValueOnce(
      new Error("provider unavailable")
    );

    await expect(
      service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY)
    ).resolves.toMatchObject({
      rowCounts: { calendar: 6, location: 4, event: 5 },
    });
  });

  it("uses serializable transactions", async () => {
    const { service, prisma } = harness();

    await service.deletePersonalContext("owner-1", VALID_KEY, VALID_BODY);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
