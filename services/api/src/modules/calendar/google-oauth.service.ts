import { createHash, randomBytes } from "node:crypto";
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export const GOOGLE_OAUTH_CLIENT_FACTORY = Symbol(
  "GOOGLE_OAUTH_CLIENT_FACTORY"
);
export const CALENDAR_ID_GENERATOR = Symbol("CALENDAR_ID_GENERATOR");

export type CalendarIdGenerator = () => string;

type ExpectedConnection = {
  id: string;
  updatedAt: Date;
  status: string;
};

type PersistedExpectedConnection = Omit<ExpectedConnection, "updatedAt"> & {
  updatedAt: string;
};

type PkceSnapshot = {
  codeVerifier: string;
  expectedConnection: PersistedExpectedConnection | null;
};

export type ConsumedGoogleOAuthAttempt = {
  attemptId: string;
  ownerId: string;
  codeVerifier: string;
  expectedConnection: ExpectedConnection | null;
};

export type VerifiedGoogleGrant = {
  refreshToken: string;
  grantedScopes: typeof GOOGLE_CALENDAR_SCOPES;
};

export type GoogleOAuthClient = {
  generateAuthUrl(options: {
    access_type: "offline";
    prompt: "consent";
    scope: readonly string[];
    state: string;
    code_challenge: string;
    code_challenge_method: "S256";
  }): string;
  getToken(options: {
    code: string;
    codeVerifier: string;
    redirect_uri: string;
  }): Promise<{
    tokens: { access_token?: string | null; refresh_token?: string | null };
  }>;
  getTokenInfo(accessToken: string): Promise<{ scopes?: unknown }>;
};

export type GoogleOAuthClientFactory = (configuration: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) => GoogleOAuthClient;

const STATE_PURPOSE = "google-oauth-state";
const PKCE_PURPOSE = "google-oauth-pkce";
const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const STATE_PATTERN = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})$/;
const CALLBACK_ERROR = "Invalid OAuth callback";
const PROVIDER_ERROR = "Google Calendar authorization failed";

export class GoogleOAuthExchangeError extends Error {
  constructor(
    readonly code:
      | "google_invalid_grant"
      | "google_oauth_grant_invalid"
      | "google_oauth_provider_error"
  ) {
    super(PROVIDER_ERROR);
    this.name = "GoogleOAuthExchangeError";
  }
}

@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly config: ConfigService,
    @Inject(GOOGLE_OAUTH_CLIENT_FACTORY)
    private readonly clientFactory: GoogleOAuthClientFactory,
    @Inject(CALENDAR_ID_GENERATOR)
    private readonly idGenerator: CalendarIdGenerator
  ) {}

  async createAuthorizationUrl(ownerId: string): Promise<string> {
    const provider = this.providerConfiguration();
    const expected = await this.prisma.googleCalendarConnection.findUnique({
      where: { ownerId },
      select: { id: true, updatedAt: true, status: true },
    });
    const attemptId = this.idGenerator();
    const state = `${attemptId}.${randomBytes(32).toString("base64url")}`;
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier, "ascii")
      .digest("base64url");
    const stateMac = this.index.mac(STATE_PURPOSE, ownerId, state);
    const expectedConnection = expected
      ? {
          id: expected.id,
          updatedAt: expected.updatedAt.toISOString(),
          status: expected.status,
        }
      : null;
    const encrypted = this.cipher.encrypt<PkceSnapshot>(
      PKCE_PURPOSE,
      ownerId,
      attemptId,
      { codeVerifier, expectedConnection }
    );

    await this.prisma.googleOAuthAttempt.create({
      data: {
        id: attemptId,
        ownerId,
        stateMac,
        ...pkceColumns(encrypted),
        expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
      },
      select: { id: true },
    });

    return this.clientFactory(provider).generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_CALENDAR_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  }

  async consumeAttempt(state: string): Promise<ConsumedGoogleOAuthAttempt> {
    const match = STATE_PATTERN.exec(state);
    if (!match) throw callbackError();
    const attemptId = match[1];
    const attempt = await this.prisma.googleOAuthAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        ownerId: true,
        stateMac: true,
        pkceCiphertext: true,
        pkceIv: true,
        pkceTag: true,
        pkceKeyVersion: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (
      !attempt ||
      !this.index.verify(
        attempt.stateMac,
        STATE_PURPOSE,
        attempt.ownerId,
        state
      )
    ) {
      throw callbackError();
    }

    const now = new Date();
    const consumed = await this.prisma.googleOAuthAttempt.updateMany({
      where: {
        id: attempt.id,
        ownerId: attempt.ownerId,
        stateMac: attempt.stateMac,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw callbackError();

    const snapshot = this.cipher.decrypt<PkceSnapshot>(
      PKCE_PURPOSE,
      attempt.ownerId,
      attempt.id,
      {
        ciphertext: Buffer.from(attempt.pkceCiphertext),
        iv: Buffer.from(attempt.pkceIv),
        tag: Buffer.from(attempt.pkceTag),
        keyVersion: attempt.pkceKeyVersion,
      }
    );
    return validateSnapshot(attempt.id, attempt.ownerId, snapshot);
  }

  async exchangeCode(
    code: string,
    codeVerifier: string
  ): Promise<VerifiedGoogleGrant> {
    try {
      const provider = this.providerConfiguration();
      const client = this.clientFactory(provider);
      const result = await client.getToken({
        code,
        codeVerifier,
        redirect_uri: provider.redirectUri,
      });
      const accessToken = result.tokens.access_token;
      const refreshToken = result.tokens.refresh_token;
      if (!accessToken || !refreshToken) throw invalidGrantSet();

      const metadata = await client.getTokenInfo(accessToken);
      if (!hasExactScopes(metadata.scopes)) throw invalidGrantSet();

      return { refreshToken, grantedScopes: GOOGLE_CALENDAR_SCOPES };
    } catch (error) {
      if (error instanceof GoogleOAuthExchangeError) throw error;
      throw new GoogleOAuthExchangeError(
        isInvalidGrant(error)
          ? "google_invalid_grant"
          : "google_oauth_provider_error"
      );
    }
  }

  settingsResultUrl(): string {
    return configuredUrl(
      this.config.get("GOOGLE_CALENDAR_SETTINGS_RESULT_URL")
    );
  }

  private providerConfiguration(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    return {
      clientId: configuredString(this.config.get("GOOGLE_CALENDAR_CLIENT_ID")),
      clientSecret: configuredString(
        this.config.get("GOOGLE_CALENDAR_CLIENT_SECRET")
      ),
      redirectUri: configuredUrl(
        this.config.get("GOOGLE_CALENDAR_REDIRECT_URI")
      ),
    };
  }
}

function pkceColumns(encrypted: EncryptedValue) {
  return {
    pkceCiphertext: encrypted.ciphertext as Uint8Array<ArrayBuffer>,
    pkceIv: encrypted.iv as Uint8Array<ArrayBuffer>,
    pkceTag: encrypted.tag as Uint8Array<ArrayBuffer>,
    pkceKeyVersion: encrypted.keyVersion,
  };
}

function validateSnapshot(
  attemptId: string,
  ownerId: string,
  value: unknown
): ConsumedGoogleOAuthAttempt {
  if (!isPlainRecord(value) || Object.keys(value).length !== 2) {
    throw callbackError();
  }
  const codeVerifier = value.codeVerifier;
  const expected = value.expectedConnection;
  if (
    typeof codeVerifier !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeVerifier)
  ) {
    throw callbackError();
  }
  if (expected === null) {
    return { attemptId, ownerId, codeVerifier, expectedConnection: null };
  }
  if (
    !isPlainRecord(expected) ||
    Object.keys(expected).length !== 3 ||
    typeof expected.id !== "string" ||
    typeof expected.status !== "string" ||
    typeof expected.updatedAt !== "string"
  ) {
    throw callbackError();
  }
  const updatedAt = new Date(expected.updatedAt);
  if (!Number.isFinite(updatedAt.getTime())) throw callbackError();
  return {
    attemptId,
    ownerId,
    codeVerifier,
    expectedConnection: {
      id: expected.id,
      status: expected.status,
      updatedAt,
    },
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactScopes(scopes: unknown): boolean {
  if (
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === "string")
  ) {
    return false;
  }
  if (new Set(scopes).size !== scopes.length) return false;
  if (scopes.length !== GOOGLE_CALENDAR_SCOPES.length) return false;
  return GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope));
}

function isInvalidGrant(error: unknown): boolean {
  if (!isPlainRecord(error)) return false;
  if (error.code === "invalid_grant") return true;
  const response = error.response;
  if (!isPlainRecord(response)) return false;
  const data = response.data;
  return isPlainRecord(data) && data.error === "invalid_grant";
}

function invalidGrantSet(): GoogleOAuthExchangeError {
  return new GoogleOAuthExchangeError("google_oauth_grant_invalid");
}

function callbackError(): Error {
  return new Error(CALLBACK_ERROR);
}

function configuredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw integrationUnavailable();
  }
  return value;
}

function configuredUrl(value: unknown): string {
  const configured = configuredString(value);
  try {
    return new URL(configured).toString();
  } catch {
    throw integrationUnavailable();
  }
}

function integrationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: "integration_not_configured",
    message: "Integration is not configured",
  });
}
