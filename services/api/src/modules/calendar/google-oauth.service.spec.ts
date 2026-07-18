import { createHash } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import type { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleOAuthExchangeError,
  GoogleOAuthService,
  type CalendarIdGenerator,
  type GoogleOAuthClientFactory,
} from "./google-oauth.service.js";

const OWNER_ID = "owner-synthetic-a";
const ATTEMPT_ID = `c${"a".repeat(24)}`;
const STATE_SECRET = "s".repeat(43);
const STATE = `${ATTEMPT_ID}.${STATE_SECRET}`;
const CONNECTION_ID = `c${"b".repeat(24)}`;
const NOW = new Date("2026-07-16T12:00:00.000Z");
const ENVELOPE = {
  ciphertext: Buffer.from("ciphertext"),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
  keyVersion: 1,
};

function configuration(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    GOOGLE_CALENDAR_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI:
      "https://socos.example.test/api/integrations/google-calendar/callback",
    GOOGLE_CALENDAR_SETTINGS_RESULT_URL:
      "https://socos.example.test/settings/integrations?keep=1",
    ...overrides,
  };
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

function harness(configurationOverrides: Record<string, string> = {}) {
  const prisma = {
    googleCalendarConnection: { findUnique: jest.fn() },
    googleOAuthAttempt: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const cipher = {
    encrypt: jest.fn().mockReturnValue(ENVELOPE),
    decrypt: jest.fn().mockReturnValue({
      codeVerifier: "v".repeat(43),
      expectedConnection: null,
    }),
  };
  const index = {
    mac: jest.fn((_purpose: string, ownerId: string, value: string) =>
      createHash("sha256").update(`${ownerId}:${value}`).digest("hex")
    ),
    verify: jest.fn().mockReturnValue(true),
  };
  const client = {
    generateAuthUrl: jest
      .fn()
      .mockReturnValue("https://accounts.google.test/auth"),
    getToken: jest.fn(),
    getTokenInfo: jest.fn(),
  };
  const clientFactory = jest.fn().mockReturnValue(client);
  const idGenerator = jest.fn().mockReturnValue(ATTEMPT_ID);
  const service = new GoogleOAuthService(
    prisma as unknown as PrismaService,
    cipher as unknown as PersonalDataCipherService,
    index as unknown as PersonalDataIndexService,
    configuration(configurationOverrides),
    clientFactory as GoogleOAuthClientFactory,
    idGenerator as CalendarIdGenerator
  );
  return { service, prisma, cipher, index, client, clientFactory, idGenerator };
}

function storedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    ownerId: OWNER_ID,
    stateMac: "a".repeat(64),
    pkceCiphertext: ENVELOPE.ciphertext,
    pkceIv: ENVELOPE.iv,
    pkceTag: ENVELOPE.tag,
    pkceKeyVersion: ENVELOPE.keyVersion,
    expiresAt: new Date(NOW.getTime() + 60_000),
    consumedAt: null,
    ...overrides,
  };
}

describe("GoogleOAuthService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates an account-add attempt without inferring an existing reconnect target", async () => {
    const { service, prisma, cipher, index, client, clientFactory } = harness();
    prisma.googleCalendarConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      updatedAt: new Date("2026-07-16T11:00:00.000Z"),
      status: "active",
    });
    prisma.googleOAuthAttempt.create.mockResolvedValue({ id: ATTEMPT_ID });

    await service.createAuthorizationUrl(OWNER_ID);

    expect(prisma.googleCalendarConnection.findUnique).not.toHaveBeenCalled();
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ]);
    expect(clientFactory).toHaveBeenCalledWith({
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      redirectUri:
        "https://socos.example.test/api/integrations/google-calendar/callback",
    });
    expect(client.generateAuthUrl).toHaveBeenCalledTimes(1);
    const authorization = client.generateAuthUrl.mock.calls[0][0];
    expect(authorization).toMatchObject({
      access_type: "offline",
      prompt: "consent",
      code_challenge_method: "S256",
      scope: GOOGLE_CALENDAR_SCOPES,
    });
    expect(authorization.state).toMatch(
      new RegExp(`^${ATTEMPT_ID}\\.[A-Za-z0-9_-]{43}$`)
    );
    const encryptedSnapshot = cipher.encrypt.mock.calls[0][3];
    expect(encryptedSnapshot.expectedConnection).toBeNull();
    expect(authorization.code_challenge).toBe(
      createHash("sha256")
        .update(encryptedSnapshot.codeVerifier)
        .digest("base64url")
    );
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "google-oauth-pkce",
      OWNER_ID,
      ATTEMPT_ID,
      encryptedSnapshot
    );
    expect(index.mac).toHaveBeenCalledWith(
      "google-oauth-state",
      OWNER_ID,
      authorization.state
    );
    expect(prisma.googleOAuthAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: ATTEMPT_ID,
        ownerId: OWNER_ID,
        expiresAt: new Date("2026-07-16T12:10:00.000Z"),
        pkceCiphertext: ENVELOPE.ciphertext,
        pkceIv: ENVELOPE.iv,
        pkceTag: ENVELOPE.tag,
        pkceKeyVersion: 1,
      }),
      select: { id: true },
    });
    const persisted = prisma.googleOAuthAttempt.create.mock.calls[0][0];
    expect(JSON.stringify(persisted)).not.toContain(
      encryptedSnapshot.codeVerifier
    );
  });

  it("resolves the opaque locator globally, verifies owner-bound state, and consumes atomically", async () => {
    const { service, prisma, cipher, index } = harness();
    prisma.googleOAuthAttempt.findUnique.mockResolvedValue(storedAttempt());
    prisma.googleOAuthAttempt.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.consumeAttempt(STATE);

    expect(prisma.googleOAuthAttempt.findUnique).toHaveBeenCalledWith({
      where: { id: ATTEMPT_ID },
      select: expect.objectContaining({ ownerId: true, stateMac: true }),
    });
    expect(index.verify).toHaveBeenCalledWith(
      "a".repeat(64),
      "google-oauth-state",
      OWNER_ID,
      STATE
    );
    expect(prisma.googleOAuthAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: ATTEMPT_ID,
        ownerId: OWNER_ID,
        stateMac: "a".repeat(64),
        consumedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { consumedAt: NOW },
    });
    expect(cipher.decrypt).toHaveBeenCalledWith(
      "google-oauth-pkce",
      OWNER_ID,
      ATTEMPT_ID,
      ENVELOPE
    );
    expect(result).toEqual({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: null,
    });
  });

  it.each([
    ["malformed", "not-a-state"],
    ["short secret", `${ATTEMPT_ID}.short`],
    ["padded secret", `${ATTEMPT_ID}.${"s".repeat(42)}=`],
  ])("rejects %s state before persistence", async (_label, state) => {
    const { service, prisma } = harness();

    await expect(service.consumeAttempt(state)).rejects.toThrow(
      "Invalid OAuth callback"
    );
    expect(prisma.googleOAuthAttempt.findUnique).not.toHaveBeenCalled();
  });

  it.each(["tampered", "swapped", "cross-owner"])(
    "rejects %s state before atomic consumption",
    async () => {
      const { service, prisma, index, cipher } = harness();
      prisma.googleOAuthAttempt.findUnique.mockResolvedValue(storedAttempt());
      index.verify.mockReturnValue(false);

      await expect(service.consumeAttempt(STATE)).rejects.toThrow(
        "Invalid OAuth callback"
      );
      expect(prisma.googleOAuthAttempt.updateMany).not.toHaveBeenCalled();
      expect(cipher.decrypt).not.toHaveBeenCalled();
    }
  );

  it.each(["expired", "replayed", "simultaneous loser"])(
    "rejects an %s attempt when the consume CAS loses",
    async () => {
      const { service, prisma, cipher } = harness();
      prisma.googleOAuthAttempt.findUnique.mockResolvedValue(storedAttempt());
      prisma.googleOAuthAttempt.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.consumeAttempt(STATE)).rejects.toThrow(
        "Invalid OAuth callback"
      );
      expect(cipher.decrypt).not.toHaveBeenCalled();
    }
  );

  it("allows only one of two simultaneous consumers to decrypt", async () => {
    const { service, prisma, cipher } = harness();
    prisma.googleOAuthAttempt.findUnique.mockResolvedValue(storedAttempt());
    prisma.googleOAuthAttempt.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const settled = await Promise.allSettled([
      service.consumeAttempt(STATE),
      service.consumeAttempt(STATE),
    ]);

    expect(settled.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(cipher.decrypt).toHaveBeenCalledTimes(1);
  });

  it("restores the exact reconnect snapshot timestamp after encrypted JSON storage", async () => {
    const { service, prisma, cipher } = harness();
    prisma.googleOAuthAttempt.findUnique.mockResolvedValue(storedAttempt());
    prisma.googleOAuthAttempt.updateMany.mockResolvedValue({ count: 1 });
    cipher.decrypt.mockReturnValue({
      codeVerifier: "v".repeat(43),
      expectedConnection: {
        id: CONNECTION_ID,
        updatedAt: "2026-07-16T11:00:00.000Z",
        status: "active",
      },
    });

    await expect(service.consumeAttempt(STATE)).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      ownerId: OWNER_ID,
      codeVerifier: "v".repeat(43),
      expectedConnection: {
        id: CONNECTION_ID,
        updatedAt: new Date("2026-07-16T11:00:00.000Z"),
        status: "active",
      },
    });
  });

  it("exchanges with the configured redirect and PKCE and verifies the exact grant set", async () => {
    const { service, client, clientFactory } = harness();
    client.getToken.mockResolvedValue({
      tokens: {
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
      },
    });
    client.getTokenInfo.mockResolvedValue({
      scopes: [...GOOGLE_CALENDAR_SCOPES].reverse(),
    });

    const grant = await service.exchangeCode("synthetic-code", "v".repeat(43));

    expect(clientFactory).toHaveBeenCalledWith({
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      redirectUri:
        "https://socos.example.test/api/integrations/google-calendar/callback",
    });
    expect(client.getToken).toHaveBeenCalledWith({
      code: "synthetic-code",
      codeVerifier: "v".repeat(43),
      redirect_uri:
        "https://socos.example.test/api/integrations/google-calendar/callback",
    });
    expect(client.getTokenInfo).toHaveBeenCalledWith("synthetic-access-token");
    expect(grant).toEqual({
      refreshToken: "synthetic-refresh-token",
      grantedScopes: GOOGLE_CALENDAR_SCOPES,
    });
  });

  it("validates but preserves the exact configured redirect string", async () => {
    const exactRedirect =
      "https://SOCOS.example.test:443/api/integrations/google-calendar/callback";
    const { service, prisma, client, clientFactory } = harness({
      GOOGLE_CALENDAR_REDIRECT_URI: exactRedirect,
    });
    prisma.googleCalendarConnection.findUnique.mockResolvedValue(null);
    prisma.googleOAuthAttempt.create.mockResolvedValue({ id: ATTEMPT_ID });
    client.getToken.mockResolvedValue({
      tokens: {
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
      },
    });
    client.getTokenInfo.mockResolvedValue({ scopes: GOOGLE_CALENDAR_SCOPES });

    await service.createAuthorizationUrl(OWNER_ID);
    await service.exchangeCode("synthetic-code", "v".repeat(43));

    expect(clientFactory).toHaveBeenNthCalledWith(1, {
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      redirectUri: exactRedirect,
    });
    expect(clientFactory).toHaveBeenNthCalledWith(2, {
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      redirectUri: exactRedirect,
    });
    expect(client.getToken).toHaveBeenCalledWith({
      code: "synthetic-code",
      codeVerifier: "v".repeat(43),
      redirect_uri: exactRedirect,
    });
  });

  it.each([
    [
      "missing access token",
      undefined,
      "synthetic-refresh-token",
      GOOGLE_CALENDAR_SCOPES,
    ],
    [
      "missing refresh token",
      "synthetic-access-token",
      undefined,
      GOOGLE_CALENDAR_SCOPES,
    ],
    [
      "partial scopes",
      "synthetic-access-token",
      "synthetic-refresh-token",
      [GOOGLE_CALENDAR_SCOPES[0]],
    ],
    [
      "extra scopes",
      "synthetic-access-token",
      "synthetic-refresh-token",
      [...GOOGLE_CALENDAR_SCOPES, "extra"],
    ],
    [
      "duplicate scopes",
      "synthetic-access-token",
      "synthetic-refresh-token",
      [...GOOGLE_CALENDAR_SCOPES, GOOGLE_CALENDAR_SCOPES[0]],
    ],
    [
      "unverifiable scopes",
      "synthetic-access-token",
      "synthetic-refresh-token",
      undefined,
    ],
  ])(
    "fails closed for %s",
    async (_label, accessToken, refreshToken, scopes) => {
      const { service, client } = harness();
      client.getToken.mockResolvedValue({
        tokens: { access_token: accessToken, refresh_token: refreshToken },
      });
      client.getTokenInfo.mockResolvedValue({ scopes });

      await expect(
        service.exchangeCode("synthetic-code", "v".repeat(43))
      ).rejects.toMatchObject({
        code: "google_oauth_grant_invalid",
        message: "Google Calendar authorization failed",
      });
    }
  );

  it("classifies invalid_grant without exposing provider data", async () => {
    const { service, client } = harness();
    client.getToken.mockRejectedValue({
      response: {
        data: {
          error: "invalid_grant",
          error_description: "synthetic-sensitive-provider-description",
        },
      },
    });

    let thrown: unknown;
    try {
      await service.exchangeCode("synthetic-sensitive-code", "v".repeat(43));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GoogleOAuthExchangeError);
    expect(thrown).toMatchObject({
      code: "google_invalid_grant",
      message: "Google Calendar authorization failed",
    });
    expect(JSON.stringify(thrown)).not.toContain("synthetic-sensitive");
  });
});
