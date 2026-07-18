import type { PrismaService } from "../prisma/prisma.service.js";
import type { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import type { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import {
  CalendarConnectionService,
  type CalendarIdGenerator,
} from "./calendar-connection.service.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleOAuthExchangeError,
  type GoogleOAuthService,
} from "./google-oauth.service.js";
import type { CalendarWatchService } from "./calendar-watch.service.js";

const OWNER_ID = "owner-synthetic";
const OTHER_OWNER_ID = "owner-other";
const CONNECTION_ID = `c${"b".repeat(24)}`;
const SECOND_CONNECTION_ID = `c${"c".repeat(24)}`;
const ATTEMPT_ID = `c${"a".repeat(24)}`;
const EXPECTED_UPDATED_AT = new Date("2026-07-16T11:00:00.000Z");
const REFRESH_ENVELOPE = {
  ciphertext: Buffer.from("refresh-ciphertext"),
  iv: Buffer.alloc(12, 3),
  tag: Buffer.alloc(16, 4),
  keyVersion: 2,
};

function harness() {
  const prisma = {
    googleCalendarConnection: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    calendarSource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    calendarWatch: { count: jest.fn() },
  };
  const cipher = { encrypt: jest.fn().mockReturnValue(REFRESH_ENVELOPE) };
  const config = { requireEnabled: jest.fn() };
  const oauth = {
    createAuthorizationUrl: jest
      .fn()
      .mockResolvedValue("https://accounts.google.test/auth"),
    consumeAttempt: jest.fn().mockResolvedValue({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: null,
    }),
    exchangeCode: jest.fn().mockResolvedValue({
      refreshToken: "synthetic-refresh-token",
      grantedScopes: GOOGLE_CALENDAR_SCOPES,
    }),
    settingsResultUrl: jest
      .fn()
      .mockReturnValue("https://socos.example.test/settings"),
  };
  const idGenerator = jest.fn().mockReturnValue(CONNECTION_ID);
  const watches = {
    prepareOwnerStops: jest.fn().mockResolvedValue([]),
    prepareSourceStops: jest.fn().mockResolvedValue([]),
    transitionPreparedStops: jest.fn().mockResolvedValue(undefined),
    removeDisconnectedCalendarStays: jest.fn().mockResolvedValue(undefined),
    finalizeDisconnectedOwner: jest.fn().mockResolvedValue(true),
    stopPreparedBestEffort: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CalendarConnectionService(
    prisma as unknown as PrismaService,
    cipher as unknown as PersonalDataCipherService,
    config as unknown as PersonalDataConfigService,
    oauth as unknown as GoogleOAuthService,
    idGenerator as CalendarIdGenerator,
    watches as unknown as CalendarWatchService
  );
  return { service, prisma, cipher, config, oauth, idGenerator, watches };
}

describe("CalendarConnectionService", () => {
  it("starts an enabled owner-scoped connection without authority input", async () => {
    const { service, config, oauth } = harness();

    await expect(service.connect(OWNER_ID)).resolves.toEqual({
      authorizationUrl: "https://accounts.google.test/auth",
    });
    expect(config.requireEnabled).toHaveBeenCalledWith("calendarSync");
    expect(oauth.createAuthorizationUrl).toHaveBeenCalledWith(OWNER_ID);
  });

  it("creates a new connection with its generated ID as refresh-token AAD", async () => {
    const { service, prisma, cipher, idGenerator } = harness();
    prisma.googleCalendarConnection.create.mockResolvedValue({
      id: CONNECTION_ID,
    });

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("connected");

    expect(idGenerator).toHaveBeenCalledTimes(1);
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "google-calendar-refresh-token",
      OWNER_ID,
      CONNECTION_ID,
      "synthetic-refresh-token"
    );
    expect(prisma.googleCalendarConnection.create).toHaveBeenCalledWith({
      data: {
        id: CONNECTION_ID,
        ownerId: OWNER_ID,
        refreshTokenCiphertext: REFRESH_ENVELOPE.ciphertext,
        refreshTokenIv: REFRESH_ENVELOPE.iv,
        refreshTokenTag: REFRESH_ENVELOPE.tag,
        refreshTokenKeyVersion: 2,
        grantedScopes: GOOGLE_CALENDAR_SCOPES,
        status: "active",
        errorCode: null,
        calendarListPendingAt: expect.any(Date),
      },
      select: { id: true },
    });
    const persisted = prisma.googleCalendarConnection.create.mock.calls[0][0];
    expect(JSON.stringify(persisted)).not.toContain("synthetic-refresh-token");
  });

  it("returns a fixed error when concurrent initial creation loses the owner unique race", async () => {
    const { service, prisma } = harness();
    prisma.googleCalendarConnection.create.mockRejectedValue({ code: "P2002" });

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("error");
  });

  it("reconnects with an owner, ID, timestamp, and status CAS and replaces the full envelope", async () => {
    const { service, prisma, cipher, oauth, idGenerator } = harness();
    oauth.consumeAttempt.mockResolvedValue({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: {
        id: CONNECTION_ID,
        updatedAt: EXPECTED_UPDATED_AT,
        status: "needs_reauth",
      },
    });
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("connected");

    expect(idGenerator).not.toHaveBeenCalled();
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "google-calendar-refresh-token",
      OWNER_ID,
      CONNECTION_ID,
      "synthetic-refresh-token"
    );
    expect(prisma.googleCalendarConnection.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        ownerId: OWNER_ID,
        updatedAt: EXPECTED_UPDATED_AT,
        status: "needs_reauth",
      },
      data: {
        refreshTokenCiphertext: REFRESH_ENVELOPE.ciphertext,
        refreshTokenIv: REFRESH_ENVELOPE.iv,
        refreshTokenTag: REFRESH_ENVELOPE.tag,
        refreshTokenKeyVersion: 2,
        grantedScopes: GOOGLE_CALENDAR_SCOPES,
        status: "active",
        errorCode: null,
        calendarListPendingAt: expect.any(Date),
        calendarListLeaseUntil: null,
      },
    });
  });

  it("does not overwrite a newer reconnect when the snapshot CAS loses", async () => {
    const { service, prisma, oauth } = harness();
    oauth.consumeAttempt.mockResolvedValue({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: {
        id: CONNECTION_ID,
        updatedAt: EXPECTED_UPDATED_AT,
        status: "active",
      },
    });
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("error");
  });

  it("consumes provider denial without exchange or persistence", async () => {
    const { service, oauth, prisma } = harness();

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        error: "access_denied",
      })
    ).resolves.toBe("error");

    expect(oauth.consumeAttempt).toHaveBeenCalledWith("synthetic-state");
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(prisma.googleCalendarConnection.create).not.toHaveBeenCalled();
  });

  it("marks only the exact stale snapshot needs_reauth on invalid_grant", async () => {
    const { service, prisma, oauth } = harness();
    oauth.consumeAttempt.mockResolvedValue({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: {
        id: CONNECTION_ID,
        updatedAt: EXPECTED_UPDATED_AT,
        status: "active",
      },
    });
    oauth.exchangeCode.mockRejectedValue(
      new GoogleOAuthExchangeError("google_invalid_grant")
    );
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("error");

    expect(prisma.googleCalendarConnection.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONNECTION_ID,
        ownerId: OWNER_ID,
        updatedAt: EXPECTED_UPDATED_AT,
        status: "active",
      },
      data: {
        status: "needs_reauth",
        errorCode: "google_invalid_grant",
        calendarListLeaseUntil: null,
      },
    });
    expect(prisma.calendarSource.updateMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID, connectionId: CONNECTION_ID },
      data: { syncLeaseUntil: null, errorCode: "google_invalid_grant" },
    });
  });

  it("does not demote any connection for a stale initial attempt or non-invalid-grant failure", async () => {
    const { service, prisma, oauth } = harness();
    oauth.exchangeCode.mockRejectedValue(
      new GoogleOAuthExchangeError("google_oauth_provider_error")
    );

    await expect(
      service.handleCallback({
        state: "synthetic-state",
        code: "synthetic-code",
      })
    ).resolves.toBe("error");
    expect(prisma.googleCalendarConnection.updateMany).not.toHaveBeenCalled();
  });

  it("returns every safe owner-scoped connection summary in stable order", async () => {
    const { service, prisma } = harness();
    prisma.googleCalendarConnection.findMany.mockResolvedValue([
      {
        id: CONNECTION_ID,
        status: "active",
        grantedScopes: GOOGLE_CALENDAR_SCOPES,
        lastSyncedAt: null,
        errorCode: null,
        createdAt: new Date("2026-07-16T10:00:00.000Z"),
        updatedAt: EXPECTED_UPDATED_AT,
      },
      {
        id: SECOND_CONNECTION_ID,
        status: "needs_reauth",
        grantedScopes: GOOGLE_CALENDAR_SCOPES,
        lastSyncedAt: new Date("2026-07-16T10:30:00.000Z"),
        errorCode: "google_invalid_grant",
        createdAt: new Date("2026-07-16T10:05:00.000Z"),
        updatedAt: new Date("2026-07-16T11:05:00.000Z"),
      },
    ]);

    const summary = await service.summary(OWNER_ID);

    expect(prisma.googleCalendarConnection.findMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        grantedScopes: true,
        lastSyncedAt: true,
        errorCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(summary.map(({ id }) => id)).toEqual([
      CONNECTION_ID,
      SECOND_CONNECTION_ID,
    ]);
    expect(JSON.stringify(summary)).not.toContain("refreshTokenCiphertext");
  });

  it("disconnects, stops prepared watches, and deletes only after no watch remains", async () => {
    const { service, prisma, watches } = harness();
    prisma.googleCalendarConnection.updateMany.mockResolvedValue({ count: 1 });
    prisma.calendarWatch.count.mockResolvedValue(0);

    await expect(service.disconnect(OWNER_ID)).resolves.toBeUndefined();

    expect(prisma.googleCalendarConnection.updateMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID, status: { not: "disconnected" } },
      data: { status: "disconnected", calendarListLeaseUntil: null },
    });
    expect(watches.prepareOwnerStops).toHaveBeenCalledWith(OWNER_ID);
    expect(watches.transitionPreparedStops).toHaveBeenCalledWith([]);
    expect(watches.removeDisconnectedCalendarStays).toHaveBeenCalledWith(
      OWNER_ID
    );
    expect(watches.stopPreparedBestEffort).toHaveBeenCalledWith([]);
    expect(watches.finalizeDisconnectedOwner).toHaveBeenCalledWith(OWNER_ID);
    expect(prisma.googleCalendarConnection.deleteMany).not.toHaveBeenCalled();
    expect(
      JSON.stringify(prisma.googleCalendarConnection.updateMany.mock.calls)
    ).not.toContain(OTHER_OWNER_ID);
  });

  it("durably deselects a source before preparing and stopping its watch", async () => {
    const { service, prisma, watches } = harness();
    prisma.calendarSource.findFirst.mockResolvedValue({ id: "source" });
    prisma.calendarSource.updateMany.mockResolvedValue({ count: 1 });
    const prepared = [{ id: "watch" }];
    watches.prepareSourceStops.mockResolvedValue(prepared);

    await service.updateSource(OWNER_ID, "source", { selected: false });

    expect(prisma.calendarSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          selected: false,
          fullSyncRequired: false,
          pendingSyncAt: null,
          syncLeaseUntil: null,
        },
      })
    );
    expect(watches.prepareSourceStops).toHaveBeenCalledWith(OWNER_ID, "source");
    expect(watches.transitionPreparedStops).toHaveBeenCalledWith(prepared);
    expect(watches.stopPreparedBestEffort).toHaveBeenCalledWith(prepared);
  });
});
