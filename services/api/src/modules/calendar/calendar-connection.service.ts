import { Inject, Injectable } from "@nestjs/common";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { GoogleOAuthCallbackInput } from "./calendar.dto.js";
import {
  CALENDAR_ID_GENERATOR,
  type CalendarIdGenerator,
  type ConsumedGoogleOAuthAttempt,
  GoogleOAuthExchangeError,
  GoogleOAuthService,
} from "./google-oauth.service.js";

export type { CalendarIdGenerator } from "./google-oauth.service.js";

const REFRESH_TOKEN_PURPOSE = "google-calendar-refresh-token";

@Injectable()
export class CalendarConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly config: PersonalDataConfigService,
    private readonly oauth: GoogleOAuthService,
    @Inject(CALENDAR_ID_GENERATOR)
    private readonly idGenerator: CalendarIdGenerator
  ) {}

  async connect(ownerId: string): Promise<{ authorizationUrl: string }> {
    this.config.requireEnabled("calendarSync");
    return {
      authorizationUrl: await this.oauth.createAuthorizationUrl(ownerId),
    };
  }

  async handleCallback(
    input: GoogleOAuthCallbackInput
  ): Promise<"connected" | "error"> {
    let attempt: ConsumedGoogleOAuthAttempt;
    try {
      attempt = await this.oauth.consumeAttempt(input.state);
    } catch {
      return "error";
    }
    if ("error" in input) return "error";

    try {
      const grant = await this.oauth.exchangeCode(
        input.code,
        attempt.codeVerifier
      );
      if (attempt.expectedConnection) {
        return (await this.reconnect(
          attempt,
          grant.refreshToken,
          grant.grantedScopes
        ))
          ? "connected"
          : "error";
      }
      return (await this.create(
        attempt.ownerId,
        grant.refreshToken,
        grant.grantedScopes
      ))
        ? "connected"
        : "error";
    } catch (error) {
      if (
        error instanceof GoogleOAuthExchangeError &&
        error.code === "google_invalid_grant" &&
        attempt.expectedConnection
      ) {
        await this.markNeedsReauth(attempt);
      }
      return "error";
    }
  }

  summary(ownerId: string) {
    this.config.requireEnabled("calendarSync");
    return this.prisma.googleCalendarConnection.findUnique({
      where: { ownerId },
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
  }

  async disconnect(ownerId: string): Promise<void> {
    this.config.requireEnabled("calendarSync");
    await this.prisma.googleCalendarConnection.updateMany({
      where: { ownerId, status: { not: "disconnected" } },
      data: { status: "disconnected" },
    });
  }

  callbackResultUrl(): string {
    return this.oauth.settingsResultUrl();
  }

  private async create(
    ownerId: string,
    refreshToken: string,
    grantedScopes: readonly string[]
  ): Promise<boolean> {
    const connectionId = this.idGenerator();
    const encrypted = this.cipher.encrypt(
      REFRESH_TOKEN_PURPOSE,
      ownerId,
      connectionId,
      refreshToken
    );
    try {
      await this.prisma.googleCalendarConnection.create({
        data: {
          id: connectionId,
          ownerId,
          ...refreshTokenColumns(encrypted),
          grantedScopes: [...grantedScopes],
          status: "active",
          errorCode: null,
        },
        select: { id: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async reconnect(
    attempt: ConsumedGoogleOAuthAttempt,
    refreshToken: string,
    grantedScopes: readonly string[]
  ): Promise<boolean> {
    const expected = attempt.expectedConnection!;
    const encrypted = this.cipher.encrypt(
      REFRESH_TOKEN_PURPOSE,
      attempt.ownerId,
      expected.id,
      refreshToken
    );
    const result = await this.prisma.googleCalendarConnection.updateMany({
      where: {
        id: expected.id,
        ownerId: attempt.ownerId,
        updatedAt: expected.updatedAt,
        status: expected.status,
      },
      data: {
        ...refreshTokenColumns(encrypted),
        grantedScopes: [...grantedScopes],
        status: "active",
        errorCode: null,
      },
    });
    return result.count === 1;
  }

  private async markNeedsReauth(
    attempt: ConsumedGoogleOAuthAttempt
  ): Promise<void> {
    const expected = attempt.expectedConnection!;
    await this.prisma.googleCalendarConnection.updateMany({
      where: {
        id: expected.id,
        ownerId: attempt.ownerId,
        updatedAt: expected.updatedAt,
        status: expected.status,
      },
      data: {
        status: "needs_reauth",
        errorCode: "google_invalid_grant",
      },
    });
  }
}

function refreshTokenColumns(encrypted: EncryptedValue) {
  return {
    refreshTokenCiphertext: encrypted.ciphertext as Uint8Array<ArrayBuffer>,
    refreshTokenIv: encrypted.iv as Uint8Array<ArrayBuffer>,
    refreshTokenTag: encrypted.tag as Uint8Array<ArrayBuffer>,
    refreshTokenKeyVersion: encrypted.keyVersion,
  };
}
