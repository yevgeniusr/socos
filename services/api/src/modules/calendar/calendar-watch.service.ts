import { randomBytes, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  CALENDAR_SYNC_ID_GENERATOR,
  GOOGLE_CALENDAR_PROVIDER,
  type GoogleCalendarProvider,
} from "./calendar-sync.service.js";

export const CALENDAR_WATCH_TOKEN_GENERATOR = Symbol(
  "CALENDAR_WATCH_TOKEN_GENERATOR"
);

const REFRESH_TOKEN_PURPOSE = "google-calendar-refresh-token";
const SOURCE_ID_PURPOSE = "google-calendar-source-id";
const WATCH_RESOURCE_PURPOSE = "google-calendar-watch-resource";
const WATCH_TOKEN_PURPOSE = "google-calendar-watch-token";
const MAX_MESSAGE_NUMBER = 9_223_372_036_854_775_807n;

export type CalendarWatchTargetType = "calendar_list" | "events";
export type ParsedWebhook = {
  channelId: string;
  token: string;
  resourceId: string;
  resourceState: "sync" | "exists" | "not_exists";
  messageNumber: bigint;
};

export type PreparedWatchStop = {
  id: string;
  ownerId: string;
  connectionId: string;
  channelId: string;
  resourceId: string;
  expiresAt: Date;
  accessToken: string | null;
  refreshToken: string | null;
};

@Injectable()
export class CalendarWatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly config: PersonalDataConfigService,
    @Inject(GOOGLE_CALENDAR_PROVIDER)
    private readonly provider: GoogleCalendarProvider,
    private readonly environment: ConfigService,
    @Inject(CALENDAR_SYNC_ID_GENERATOR)
    private readonly ids: () => string = randomUUID,
    @Inject(CALENDAR_WATCH_TOKEN_GENERATOR)
    private readonly tokens: () => string = () =>
      randomBytes(32).toString("base64url")
  ) {}

  async createOrRenew(
    ownerId: string,
    connectionId: string,
    targetType: CalendarWatchTargetType,
    targetKey: string,
    now = new Date()
  ): Promise<void> {
    this.config.requireEnabled("calendarSync");
    const connection = await this.prisma.googleCalendarConnection.findFirst({
      where: { id: connectionId, ownerId, status: "active" },
    });
    if (!connection) return;
    const accessToken = await this.authorize(connection);
    let calendarId: string | undefined;
    if (targetType === "events") {
      const source = await this.prisma.calendarSource.findFirst({
        where: {
          id: targetKey,
          ownerId,
          connectionId,
          selected: true,
        },
      });
      if (!source) return;
      calendarId = this.cipher.decrypt<string>(
        SOURCE_ID_PURPOSE,
        ownerId,
        source.id,
        envelope(source, "externalId")
      );
    }

    const watchId = this.ids();
    const channelId = this.ids();
    const token = this.tokens();
    const address = configuredUrl(
      this.environment.get("GOOGLE_CALENDAR_WEBHOOK_URL")
    );
    const result =
      targetType === "calendar_list"
        ? await this.provider.watchCalendarList(accessToken, {
            channelId,
            token,
            address,
          })
        : await this.provider.watchEvents(accessToken, calendarId!, {
            channelId,
            token,
            address,
          });
    if (!(result.expiresAt > now)) throw new Error("calendar_watch_invalid");
    const resource = this.cipher.encrypt(
      WATCH_RESOURCE_PURPOSE,
      ownerId,
      watchId,
      result.resourceId
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const activeConnection = await tx.googleCalendarConnection.updateMany({
          where: { id: connectionId, ownerId, status: "active" },
          data: { status: "active" },
        });
        if (activeConnection.count !== 1) {
          throw new Error("calendar_watch_target_stale");
        }
        let targetPending: Date | null = null;
        if (targetType === "events") {
          const selectedSource = await tx.calendarSource.updateMany({
            where: {
              id: targetKey,
              ownerId,
              connectionId,
              selected: true,
            },
            data: { selected: true },
          });
          if (selectedSource.count !== 1) {
            throw new Error("calendar_watch_target_stale");
          }
          const target = await tx.calendarSource.findFirst({
            where: {
              id: targetKey,
              ownerId,
              connectionId,
              selected: true,
            },
            select: { pendingSyncAt: true },
          });
          if (!target) throw new Error("calendar_watch_target_stale");
          targetPending = target.pendingSyncAt;
        } else {
          const target = await tx.googleCalendarConnection.findFirst({
            where: { id: connectionId, ownerId, status: "active" },
            select: { calendarListPendingAt: true },
          });
          if (!target) throw new Error("calendar_watch_target_stale");
          targetPending = target.calendarListPendingAt;
        }
        await tx.calendarWatch.create({
          data: {
            id: watchId,
            ownerId,
            connectionId,
            targetType,
            targetKey,
            channelId,
            resourceIdMac: this.index.mac(
              WATCH_RESOURCE_PURPOSE,
              ownerId,
              result.resourceId
            ),
            ...columns("resourceId", resource),
            tokenMac: this.index.mac(WATCH_TOKEN_PURPOSE, ownerId, token),
            status: "active",
            expiresAt: result.expiresAt,
          } as Prisma.CalendarWatchUncheckedCreateInput,
          select: { id: true },
        });

        if (targetType === "calendar_list") {
          await tx.googleCalendarConnection.updateMany({
            where: { id: connectionId, ownerId, status: "active" },
            data: {
              calendarListPendingAt: advancePending(targetPending, now),
            },
          });
        } else {
          await tx.calendarSource.updateMany({
            where: {
              id: targetKey,
              ownerId,
              connectionId,
              selected: true,
            },
            data: { pendingSyncAt: advancePending(targetPending, now) },
          });
        }
      });
    } catch (error) {
      try {
        await this.provider.stopChannel(accessToken, {
          channelId,
          resourceId: result.resourceId,
        });
      } catch {
        // The provider may already have discarded the uncommitted channel.
      }
      throw error;
    }

    await this.electReplacement(
      ownerId,
      connectionId,
      targetType,
      targetKey,
      watchId,
      now
    );

    await this.stopPreparedBestEffort(
      await this.prepareTargetStops(
        ownerId,
        connectionId,
        targetType,
        targetKey,
        "",
        accessToken
      ),
      now
    );
  }

  async handleWebhook(
    input: ParsedWebhook,
    now = new Date()
  ): Promise<"accepted" | "duplicate"> {
    this.config.requireEnabled("calendarSync");
    const watch = await this.prisma.calendarWatch.findUnique({
      where: { channelId: input.channelId },
    });
    if (
      !watch ||
      !["active", "stopping"].includes(watch.status) ||
      watch.expiresAt <= now ||
      !this.index.verify(
        watch.tokenMac,
        WATCH_TOKEN_PURPOSE,
        watch.ownerId,
        input.token
      ) ||
      !this.index.verify(
        watch.resourceIdMac,
        WATCH_RESOURCE_PURPOSE,
        watch.ownerId,
        input.resourceId
      )
    ) {
      throw opaqueWebhookError();
    }

    return this.prisma.$transaction(async (tx) => {
      const advanced = await tx.calendarWatch.updateMany({
        where: {
          id: watch.id,
          ownerId: watch.ownerId,
          channelId: input.channelId,
          status: { in: ["active", "stopping"] },
          expiresAt: { gt: now },
          OR: [
            { lastMessageNumber: null },
            { lastMessageNumber: { lt: input.messageNumber } },
          ],
        },
        data: { lastMessageNumber: input.messageNumber },
      });
      if (advanced.count !== 1) return "duplicate";

      if (!(await this.enqueueWebhookTarget(tx, watch, now))) {
        throw webhookUnavailable();
      }
      return "accepted";
    });
  }

  async prepareOwnerStops(
    ownerId: string,
    now = new Date()
  ): Promise<PreparedWatchStop[]> {
    const connections = await this.prisma.googleCalendarConnection.findMany({
      where: { ownerId },
      orderBy: { id: "asc" },
    });
    const prepared: PreparedWatchStop[] = [];
    for (const connection of connections) {
      const watches = await this.prisma.calendarWatch.findMany({
        where: {
          ownerId,
          connectionId: connection.id,
          status: "active",
          expiresAt: { gt: now },
        },
        orderBy: { id: "asc" },
      });
      if (watches.length === 0) continue;
      const refreshToken = this.decryptRefreshToken(connection);
      prepared.push(
        ...watches.map((watch) => ({
          id: watch.id,
          ownerId,
          connectionId: connection.id,
          channelId: watch.channelId,
          resourceId: this.cipher.decrypt<string>(
            WATCH_RESOURCE_PURPOSE,
            ownerId,
            watch.id,
            envelope(watch, "resourceId")
          ),
          expiresAt: watch.expiresAt,
          accessToken: null,
          refreshToken,
        }))
      );
    }
    return prepared;
  }

  async transitionPreparedStops(
    prepared: readonly PreparedWatchStop[]
  ): Promise<void> {
    for (const watch of prepared) {
      await this.prisma.calendarWatch.updateMany({
        where: {
          id: watch.id,
          ownerId: watch.ownerId,
          connectionId: watch.connectionId,
          status: "active",
        },
        data: { status: "stopping" },
      });
    }
  }

  async prepareSourceStops(
    ownerId: string,
    sourceId: string
  ): Promise<PreparedWatchStop[]> {
    const source = await this.prisma.calendarSource.findFirst({
      where: { id: sourceId, ownerId },
      select: { connectionId: true },
    });
    if (!source) return [];
    const connection = await this.prisma.googleCalendarConnection.findFirst({
      where: { id: source.connectionId, ownerId, status: "active" },
    });
    let accessToken: string | null = null;
    if (connection) {
      try {
        accessToken = await this.authorize(connection);
      } catch {
        accessToken = null;
      }
    }
    return this.prepareTargetStops(
      ownerId,
      source.connectionId,
      "events",
      sourceId,
      "",
      accessToken,
      ["active", "stopping"]
    );
  }

  async removeDisconnectedCalendarStays(ownerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const connection = await tx.googleCalendarConnection.findFirst({
        where: { ownerId, status: "disconnected" },
        select: { id: true },
      });
      if (!connection) return;
      const events = await tx.calendarEvent.findMany({
        where: {
          ownerId,
          source: { connectionId: connection.id, ownerId },
        },
        select: { id: true },
      });
      if (events.length > 0) {
        await tx.cityStay.deleteMany({
          where: {
            ownerId,
            source: "calendar",
            sourceId: { in: events.map((event) => event.id) },
          },
        });
      }
    });
  }

  async finalizeDisconnectedOwner(ownerId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.googleCalendarConnection.findFirst({
        where: { ownerId, status: "disconnected" },
        select: { id: true },
      });
      if (!connection) return false;
      const watch = await tx.calendarWatch.findFirst({
        where: { ownerId, connectionId: connection.id },
        select: { id: true },
      });
      if (watch) return false;
      const deleted = await tx.googleCalendarConnection.deleteMany({
        where: {
          id: connection.id,
          ownerId,
          status: "disconnected",
          watches: { none: {} },
        },
      });
      return deleted.count === 1;
    });
  }

  private async electReplacement(
    ownerId: string,
    connectionId: string,
    targetType: CalendarWatchTargetType,
    targetKey: string,
    watchId: string,
    now: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const lockKey = `${ownerId}:${connectionId}:${targetType}:${targetKey}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const own = await tx.calendarWatch.findFirst({
        where: {
          id: watchId,
          ownerId,
          connectionId,
          targetType,
          targetKey,
          status: "active",
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!own) return;
      await tx.calendarWatch.updateMany({
        where: {
          ownerId,
          connectionId,
          targetType,
          targetKey,
          status: "active",
          id: { not: watchId },
        },
        data: { status: "stopping" },
      });
    });
  }

  private async enqueueWebhookTarget(
    tx: any,
    watch: {
      ownerId: string;
      connectionId: string;
      targetType: string;
      targetKey: string;
    },
    now: Date
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (watch.targetType === "calendar_list") {
        const target = await tx.googleCalendarConnection.findFirst({
          where: {
            id: watch.targetKey,
            ownerId: watch.ownerId,
            status: "active",
          },
          select: { calendarListPendingAt: true },
        });
        if (!target) return false;
        const updated = await tx.googleCalendarConnection.updateMany({
          where: {
            id: watch.targetKey,
            ownerId: watch.ownerId,
            status: "active",
            calendarListPendingAt: target.calendarListPendingAt,
          },
          data: {
            calendarListPendingAt: advancePending(
              target.calendarListPendingAt,
              now
            ),
          },
        });
        if (updated.count === 1) return true;
      } else {
        const target = await tx.calendarSource.findFirst({
          where: {
            id: watch.targetKey,
            ownerId: watch.ownerId,
            connectionId: watch.connectionId,
            selected: true,
          },
          select: { pendingSyncAt: true },
        });
        if (!target) return false;
        const updated = await tx.calendarSource.updateMany({
          where: {
            id: watch.targetKey,
            ownerId: watch.ownerId,
            connectionId: watch.connectionId,
            selected: true,
            pendingSyncAt: target.pendingSyncAt,
          },
          data: { pendingSyncAt: advancePending(target.pendingSyncAt, now) },
        });
        if (updated.count === 1) return true;
      }
    }
    return false;
  }

  async stopPreparedBestEffort(
    prepared: PreparedWatchStop[],
    now = new Date()
  ): Promise<void> {
    for (const watch of prepared) {
      let stopped = watch.expiresAt <= now;
      let accessToken = watch.accessToken;
      if (!stopped && !accessToken && watch.refreshToken) {
        try {
          accessToken = (await this.provider.authorize(watch.refreshToken))
            .accessToken;
        } catch {
          accessToken = null;
        }
      }
      if (!stopped && accessToken) {
        try {
          await this.provider.stopChannel(accessToken, {
            channelId: watch.channelId,
            resourceId: watch.resourceId,
          });
          stopped = true;
        } catch (error) {
          stopped = providerChannelGone(error);
        }
      }
      if (stopped) {
        await this.prisma.calendarWatch.deleteMany({
          where: {
            id: watch.id,
            ownerId: watch.ownerId,
            connectionId: watch.connectionId,
            status: "stopping",
          },
        });
      }
    }
  }

  async maintain(now = new Date()): Promise<void> {
    let watchAfter: string | undefined;
    const renewBefore = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    while (true) {
      const stopping = await this.prisma.calendarWatch.findMany({
        where: {
          OR: [
            { status: "stopping" },
            { expiresAt: { lte: renewBefore } },
            {
              status: "active",
              connection: { status: "disconnected" },
            },
            { status: "active", targetType: "events" },
          ],
          ...(watchAfter ? { id: { gt: watchAfter } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
      });
      for (const watch of stopping) {
        await this.maintainWatch(watch, now);
      }
      if (stopping.length < 100) break;
      watchAfter = stopping.at(-1)!.id;
    }
    await this.repairMissing(now);
    await this.finalizeDisconnectedConnections();
  }

  private async maintainWatch(watch: any, now: Date): Promise<void> {
    const connection = await this.prisma.googleCalendarConnection.findFirst({
      where: {
        id: watch.connectionId,
        ownerId: watch.ownerId,
        status: { in: ["active", "disconnected"] },
      },
    });
    let eligible =
      watch.status === "active" &&
      connection?.status === "active" &&
      watch.targetType === "calendar_list" &&
      watch.targetKey === connection.id;
    if (
      watch.status === "active" &&
      connection?.status === "active" &&
      watch.targetType === "events"
    ) {
      eligible = Boolean(
        await this.prisma.calendarSource.findFirst({
          where: {
            id: watch.targetKey,
            ownerId: watch.ownerId,
            connectionId: watch.connectionId,
            selected: true,
            connection: { status: "active" },
          },
          select: { id: true },
        })
      );
    }
    if (eligible && watch.expiresAt > now) {
      const renewBefore = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (watch.expiresAt <= renewBefore) {
        try {
          await this.createOrRenew(
            watch.ownerId,
            watch.connectionId,
            watch.targetType as CalendarWatchTargetType,
            watch.targetKey,
            now
          );
        } catch {
          // A later maintenance run retries without exposing provider details.
        }
      }
      return;
    }
    if (watch.status === "active") {
      await this.prisma.calendarWatch.updateMany({
        where: {
          id: watch.id,
          ownerId: watch.ownerId,
          connectionId: watch.connectionId,
          status: "active",
        },
        data: { status: "stopping" },
      });
    }
    let accessToken: string | null = null;
    if (connection) {
      try {
        accessToken = await this.authorize(connection);
      } catch {
        accessToken = null;
      }
    }
    const prepared = await this.prepareTargetStops(
      watch.ownerId,
      watch.connectionId,
      watch.targetType as CalendarWatchTargetType,
      watch.targetKey,
      "",
      accessToken
    );
    await this.stopPreparedBestEffort(prepared, now);
  }

  private async finalizeDisconnectedConnections(): Promise<void> {
    let cursor: string | undefined;
    while (true) {
      const connections = await this.prisma.googleCalendarConnection.findMany({
        where: {
          status: "disconnected",
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 100,
        select: { id: true, ownerId: true },
      });
      for (const connection of connections) {
        await this.removeDisconnectedCalendarStays(connection.ownerId);
        await this.finalizeDisconnectedOwner(connection.ownerId);
      }
      if (connections.length < 100) return;
      cursor = connections.at(-1)!.id;
    }
  }

  private async repairMissing(now: Date): Promise<void> {
    let connectionAfter: string | undefined;
    while (true) {
      const connections = await this.prisma.googleCalendarConnection.findMany({
        where: {
          status: "active",
          ...(connectionAfter ? { id: { gt: connectionAfter } } : {}),
        },
        orderBy: { id: "asc" },
        select: { id: true, ownerId: true },
        take: 100,
      });
      for (const connection of connections) {
        const listWatches = await this.prisma.calendarWatch.findMany({
          where: {
            ownerId: connection.ownerId,
            connectionId: connection.id,
            targetType: "calendar_list",
            targetKey: connection.id,
            status: "active",
            expiresAt: { gt: now },
          },
          orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
        });
        if (listWatches.length !== 1) {
          try {
            await this.createOrRenew(
              connection.ownerId,
              connection.id,
              "calendar_list",
              connection.id,
              now
            );
          } catch {
            // A later maintenance run retries without exposing provider details.
          }
        }
      }
      if (connections.length < 100) break;
      connectionAfter = connections.at(-1)!.id;
    }

    let sourceAfter: string | undefined;
    while (true) {
      const sources = await this.prisma.calendarSource.findMany({
        where: {
          selected: true,
          connection: { status: "active" },
          ...(sourceAfter ? { id: { gt: sourceAfter } } : {}),
        },
        orderBy: { id: "asc" },
        select: { id: true, ownerId: true, connectionId: true },
        take: 100,
      });
      for (const source of sources) {
        const activeWatches = await this.prisma.calendarWatch.findMany({
          where: {
            ownerId: source.ownerId,
            connectionId: source.connectionId,
            targetType: "events",
            targetKey: source.id,
            status: "active",
            expiresAt: { gt: now },
          },
          orderBy: [{ expiresAt: "desc" }, { id: "desc" }],
        });
        if (activeWatches.length !== 1) {
          try {
            await this.createOrRenew(
              source.ownerId,
              source.connectionId,
              "events",
              source.id,
              now
            );
          } catch {
            // A later maintenance run retries without exposing provider details.
          }
        }
      }
      if (sources.length < 100) break;
      sourceAfter = sources.at(-1)!.id;
    }
  }

  private async prepareTargetStops(
    ownerId: string,
    connectionId: string,
    targetType: CalendarWatchTargetType,
    targetKey: string,
    exceptId: string,
    accessToken: string | null,
    statuses: readonly ("active" | "stopping")[] = ["stopping"]
  ): Promise<PreparedWatchStop[]> {
    const rows = await this.prisma.calendarWatch.findMany({
      where: {
        ownerId,
        connectionId,
        targetType,
        targetKey,
        status: { in: [...statuses] },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: { id: "asc" },
    });
    return rows.map((watch) => ({
      id: watch.id,
      ownerId,
      connectionId,
      channelId: watch.channelId,
      resourceId: this.cipher.decrypt<string>(
        WATCH_RESOURCE_PURPOSE,
        ownerId,
        watch.id,
        envelope(watch, "resourceId")
      ),
      expiresAt: watch.expiresAt,
      accessToken,
      refreshToken: null,
    }));
  }

  private async authorize(connection: any): Promise<string> {
    return (await this.provider.authorize(this.decryptRefreshToken(connection)))
      .accessToken;
  }

  private decryptRefreshToken(connection: any): string {
    return this.cipher.decrypt<string>(
      REFRESH_TOKEN_PURPOSE,
      connection.ownerId,
      connection.id,
      envelope(connection, "refreshToken")
    );
  }
}

export function parseWebhookHeaders(
  headers: Record<string, string | string[] | undefined>
): ParsedWebhook {
  const channelId = one(headers["x-goog-channel-id"]);
  const token = one(headers["x-goog-channel-token"]);
  const resourceId = one(headers["x-goog-resource-id"]);
  const resourceState = one(headers["x-goog-resource-state"]);
  const rawMessage = one(headers["x-goog-message-number"]);
  if (
    !channelId ||
    !token ||
    !resourceId ||
    !["sync", "exists", "not_exists"].includes(resourceState) ||
    !/^[1-9][0-9]*$/.test(rawMessage)
  ) {
    throw opaqueWebhookError();
  }
  const messageNumber = BigInt(rawMessage);
  if (messageNumber > MAX_MESSAGE_NUMBER) throw opaqueWebhookError();
  return {
    channelId,
    token,
    resourceId,
    resourceState: resourceState as ParsedWebhook["resourceState"],
    messageNumber,
  };
}

function advancePending(current: Date | null, now: Date): Date {
  return current && current >= now ? new Date(current.getTime() + 1) : now;
}

function one(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.includes(",")) {
    throw opaqueWebhookError();
  }
  return value;
}

function opaqueWebhookError(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: "calendar_webhook_not_found",
    message: "Not found",
  });
}

function webhookUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: "calendar_webhook_unavailable",
    message: "Calendar webhook unavailable",
  });
}

function configuredUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("calendar_not_configured");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("calendar_not_configured");
  return url.toString();
}

function envelope(row: any, prefix: string): EncryptedValue {
  return {
    ciphertext: Buffer.from(row[`${prefix}Ciphertext`]),
    iv: Buffer.from(row[`${prefix}Iv`]),
    tag: Buffer.from(row[`${prefix}Tag`]),
    keyVersion: row[`${prefix}KeyVersion`],
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

function providerChannelGone(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === 410;
}
