import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationAliasService } from "../location/location-alias.service.js";
import type {
  GoogleOAuthCallbackInput,
  UpdateCalendarSourceDto,
} from "./calendar.dto.js";
import { CalendarWatchService } from "./calendar-watch.service.js";
import {
  CALENDAR_ID_GENERATOR,
  type CalendarIdGenerator,
  type ConsumedGoogleOAuthAttempt,
  GoogleOAuthExchangeError,
  GoogleOAuthService,
} from "./google-oauth.service.js";

export type { CalendarIdGenerator } from "./google-oauth.service.js";

const REFRESH_TOKEN_PURPOSE = "google-calendar-refresh-token";
const SOURCE_NAME_PURPOSE = "google-calendar-source-name";

@Injectable()
export class CalendarConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly config: PersonalDataConfigService,
    private readonly oauth: GoogleOAuthService,
    @Inject(CALENDAR_ID_GENERATOR)
    private readonly idGenerator: CalendarIdGenerator,
    @Optional() private readonly watches?: CalendarWatchService,
    @Optional() private readonly aliases?: LocationAliasService
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
      data: { status: "disconnected", calendarListLeaseUntil: null },
    });
    const prepared = (await this.watches?.prepareOwnerStops(ownerId)) ?? [];
    await this.watches?.stopPreparedBestEffort(prepared);
    await this.prisma.googleCalendarConnection.deleteMany({
      where: {
        ownerId,
        status: "disconnected",
        watches: { none: {} },
      },
    });
  }

  async listSources(ownerId: string) {
    this.config.requireEnabled("calendarSync");
    const rows = await this.prisma.calendarSource.findMany({
      where: { ownerId, connection: { status: { not: "disconnected" } } },
      orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
      select: {
        id: true,
        ownerId: true,
        nameCiphertext: true,
        nameIv: true,
        nameTag: true,
        nameKeyVersion: true,
        timeZone: true,
        selected: true,
        isPrimary: true,
        fullSyncRequired: true,
        lastSyncedAt: true,
        errorCode: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: this.cipher.decrypt<string>(SOURCE_NAME_PURPOSE, ownerId, row.id, {
        ciphertext: Buffer.from(row.nameCiphertext),
        iv: Buffer.from(row.nameIv),
        tag: Buffer.from(row.nameTag),
        keyVersion: row.nameKeyVersion,
      }),
      timeZone: row.timeZone,
      selected: row.selected,
      isPrimary: row.isPrimary,
      fullSyncRequired: row.fullSyncRequired,
      lastSyncedAt: row.lastSyncedAt,
      errorCode: row.errorCode,
    }));
  }

  async updateSource(
    ownerId: string,
    sourceId: string,
    input: UpdateCalendarSourceDto
  ): Promise<void> {
    this.config.requireEnabled("calendarSync");
    const updated = await this.prisma.calendarSource.updateMany({
      where: {
        id: sourceId,
        ownerId,
        connection: { status: "active" },
      },
      data: {
        selected: input.selected,
        fullSyncRequired: input.selected,
        pendingSyncAt: input.selected ? new Date() : null,
        syncLeaseUntil: null,
      },
    });
    if (updated.count !== 1) {
      throw new NotFoundException({
        statusCode: 404,
        code: "calendar_source_not_found",
        message: "Calendar source not found",
      });
    }
    await this.aliases?.rebuildCalendarStays(ownerId);
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
          calendarListPendingAt: new Date(),
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
        calendarListPendingAt: new Date(),
      },
    });
    if (result.count === 1) {
      await this.prisma.calendarSource.updateMany({
        where: {
          ownerId: attempt.ownerId,
          connectionId: expected.id,
          selected: true,
        },
        data: {
          fullSyncRequired: true,
          pendingSyncAt: new Date(),
          syncLeaseUntil: null,
          errorCode: null,
        },
      });
    }
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
        calendarListLeaseUntil: null,
      },
    });
    await this.prisma.calendarSource.updateMany({
      where: {
        ownerId: attempt.ownerId,
        connectionId: expected.id,
      },
      data: {
        syncLeaseUntil: null,
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
