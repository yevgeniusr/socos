import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { google } from "googleapis";
import { LocationAliasService } from "../location/location-alias.service.js";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const GOOGLE_CALENDAR_PROVIDER = Symbol("GOOGLE_CALENDAR_PROVIDER");
export const CALENDAR_SYNC_ID_GENERATOR = Symbol("CALENDAR_SYNC_ID_GENERATOR");

const LEASE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_PURPOSE = "google-calendar-refresh-token";
const LIST_TOKEN_PURPOSE = "google-calendar-list-sync-token";
const SOURCE_ID_PURPOSE = "google-calendar-source-id";
const SOURCE_NAME_PURPOSE = "google-calendar-source-name";
const EVENT_ID_PURPOSE = "google-calendar-event-id";
const EVENT_DETAILS_PURPOSE = "calendar-event-details";
const RECURRING_ID_PURPOSE = "google-calendar-recurring-event-id";
const TRANSIENT_ERROR = "google_calendar_temporarily_unavailable";

export type GoogleCalendarListParams = {
  showDeleted: true;
  showHidden: true;
  maxResults: 250;
  syncToken?: string;
  pageToken?: string;
};

export type GoogleEventListParams = {
  singleEvents: true;
  showDeleted: true;
  maxResults: 2500;
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
};

export type ProviderCalendar = {
  id?: string | null;
  summary?: string | null;
  timeZone?: string | null;
  primary?: boolean | null;
  selected?: boolean | null;
  deleted?: boolean | null;
};

export type ProviderEvent = {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  location?: string | null;
  transparency?: string | null;
  attendees?: Array<{
    self?: boolean | null;
    responseStatus?: string | null;
  }> | null;
  start?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  end?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  recurringEventId?: string | null;
  originalStartTime?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  } | null;
  updated?: string | null;
};

export type GoogleCalendarProvider = {
  authorize(refreshToken: string): Promise<{ accessToken: string }>;
  listCalendars(
    accessToken: string,
    params: GoogleCalendarListParams
  ): Promise<{
    items?: ProviderCalendar[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }>;
  listEvents(
    accessToken: string,
    calendarId: string,
    params: GoogleEventListParams
  ): Promise<{
    items?: ProviderEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }>;
  watchCalendarList(
    accessToken: string,
    input: { channelId: string; token: string; address: string }
  ): Promise<{ resourceId: string; expiresAt: Date }>;
  watchEvents(
    accessToken: string,
    calendarId: string,
    input: { channelId: string; token: string; address: string }
  ): Promise<{ resourceId: string; expiresAt: Date }>;
  stopChannel(
    accessToken: string,
    input: { channelId: string; resourceId: string }
  ): Promise<void>;
};

@Injectable()
export class GoogleApisCalendarProvider implements GoogleCalendarProvider {
  constructor(private readonly config: ConfigService) {}

  async authorize(refreshToken: string): Promise<{ accessToken: string }> {
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    const result = await client.getAccessToken();
    if (!result.token) throw new Error("google_calendar_authorization_failed");
    return { accessToken: result.token };
  }

  async listCalendars(accessToken: string, params: GoogleCalendarListParams) {
    const response = await google
      .calendar({ version: "v3", auth: this.accessClient(accessToken) })
      .calendarList.list(params);
    return response.data as {
      items?: ProviderCalendar[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
  }

  async listEvents(
    accessToken: string,
    calendarId: string,
    params: GoogleEventListParams
  ) {
    const response = await google
      .calendar({ version: "v3", auth: this.accessClient(accessToken) })
      .events.list({ calendarId, ...params });
    return response.data as {
      items?: ProviderEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
  }

  async watchCalendarList(
    accessToken: string,
    input: { channelId: string; token: string; address: string }
  ) {
    const response = await google
      .calendar({ version: "v3", auth: this.accessClient(accessToken) })
      .calendarList.watch({
        requestBody: {
          id: input.channelId,
          token: input.token,
          address: input.address,
          type: "web_hook",
        },
      });
    return watchResult(response.data.resourceId, response.data.expiration);
  }

  async watchEvents(
    accessToken: string,
    calendarId: string,
    input: { channelId: string; token: string; address: string }
  ) {
    const response = await google
      .calendar({ version: "v3", auth: this.accessClient(accessToken) })
      .events.watch({
        calendarId,
        requestBody: {
          id: input.channelId,
          token: input.token,
          address: input.address,
          type: "web_hook",
        },
      });
    return watchResult(response.data.resourceId, response.data.expiration);
  }

  async stopChannel(
    accessToken: string,
    input: { channelId: string; resourceId: string }
  ): Promise<void> {
    await google
      .calendar({ version: "v3", auth: this.accessClient(accessToken) })
      .channels.stop({
        requestBody: { id: input.channelId, resourceId: input.resourceId },
      });
  }

  private client() {
    return new google.auth.OAuth2(
      configured(this.config.get("GOOGLE_CALENDAR_CLIENT_ID")),
      configured(this.config.get("GOOGLE_CALENDAR_CLIENT_SECRET")),
      configured(this.config.get("GOOGLE_CALENDAR_REDIRECT_URI"))
    );
  }

  private accessClient(accessToken: string) {
    const client = this.client();
    client.setCredentials({ access_token: accessToken });
    return client;
  }
}

type EnvelopeRow = EncryptedValue;

type SourceClaim = {
  id: string;
  ownerId: string;
  connectionId: string;
  pendingSyncAt: Date;
  lease: Date;
  fullSyncRequired: boolean;
  syncToken: string | null;
  calendarId: string;
  timeZone: string | null;
  accessToken: string;
  connectionUpdatedAt: Date;
};

export type NormalizedProviderEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  startAt: Date | null;
  endAt: Date | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  timeZone: string | null;
  transparency: "opaque" | "transparent";
  recurringEventId: string | null;
  originalStartAt: Date | null;
  details: {
    summary: string;
    locationText: string | null;
    selfResponseStatus:
      | "accepted"
      | "declined"
      | "tentative"
      | "needsAction"
      | null;
  } | null;
  sourceUpdatedAt: Date | null;
};

@Injectable()
export class CalendarSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly config: PersonalDataConfigService,
    private readonly aliases: LocationAliasService,
    @Inject(GOOGLE_CALENDAR_PROVIDER)
    private readonly provider: GoogleCalendarProvider,
    @Inject(CALENDAR_SYNC_ID_GENERATOR)
    private readonly ids: () => string = randomUUID
  ) {}

  async runNextSource(runNow = new Date()): Promise<boolean> {
    if (!this.config.isEnabled?.("calendarSync")) {
      this.config.requireEnabled("calendarSync");
    }
    const claim = await this.claimSource(runNow);
    if (!claim) return false;

    const full = claim.fullSyncRequired || claim.syncToken === null;
    const base: GoogleEventListParams = full
      ? {
          singleEvents: true,
          showDeleted: true,
          maxResults: 2500,
          timeMin: new Date(runNow.getTime() - 180 * DAY_MS).toISOString(),
          timeMax: new Date(runNow.getTime() + 365 * DAY_MS).toISOString(),
        }
      : {
          singleEvents: true,
          showDeleted: true,
          maxResults: 2500,
          syncToken: claim.syncToken!,
        };

    const items: ProviderEvent[] = [];
    let pageToken: string | undefined;
    let terminalToken: string | undefined;
    try {
      do {
        const page = await this.provider.listEvents(
          claim.accessToken,
          claim.calendarId,
          pageToken ? { ...base, pageToken } : base
        );
        items.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        terminalToken = page.nextSyncToken;
        if (!(await this.fenceSource(claim))) return true;
      } while (pageToken);
      if (!terminalToken)
        throw new Error("google_calendar_missing_terminal_token");
    } catch (error) {
      if (isGone(error)) {
        await this.failCloseGone(claim, runNow);
        return true;
      }
      if (isInvalidGrant(error)) {
        await this.markNeedsReauth(claim, runNow);
        return true;
      }
      await this.releaseSourceWithBackoff(claim, runNow);
      return true;
    }

    const normalizedById = new Map<string, NormalizedProviderEvent>();
    for (const item of items) {
      const normalized = normalizeProviderEvent(
        item,
        claim.timeZone ?? "UTC",
        runNow
      );
      if (normalized) normalizedById.set(normalized.id, normalized);
    }
    const committed = await this.commitEvents(
      claim,
      [...normalizedById.values()],
      terminalToken,
      full,
      runNow
    );
    return committed || true;
  }

  async runNextCalendarList(runNow = new Date()): Promise<boolean> {
    const row = await this.prisma.googleCalendarConnection.findFirst({
      where: {
        status: "active",
        calendarListPendingAt: { lte: runNow },
        OR: [
          { calendarListLeaseUntil: null },
          { calendarListLeaseUntil: { lt: runNow } },
        ],
      },
      orderBy: [{ calendarListPendingAt: "asc" }, { id: "asc" }],
    });
    if (!row || !row.calendarListPendingAt) return false;
    const lease = new Date(runNow.getTime() + LEASE_MS);
    const connectionGeneration = new Date(
      Math.max(runNow.getTime(), row.updatedAt.getTime() + 1)
    );
    const claimed = await this.prisma.googleCalendarConnection.updateMany({
      where: {
        id: row.id,
        ownerId: row.ownerId,
        status: "active",
        calendarListPendingAt: row.calendarListPendingAt,
        OR: [
          { calendarListLeaseUntil: null },
          { calendarListLeaseUntil: { lt: runNow } },
        ],
      },
      data: {
        calendarListLeaseUntil: lease,
        updatedAt: connectionGeneration,
      },
    });
    if (claimed.count !== 1) return false;
    const refreshToken = this.decryptRefresh(row);
    let accessToken: string;
    try {
      accessToken = (await this.provider.authorize(refreshToken)).accessToken;
    } catch (error) {
      if (isInvalidGrant(error)) {
        await this.markCalendarListNeedsReauth(
          row,
          lease,
          connectionGeneration
        );
      } else {
        await this.releaseCalendarListWithBackoff(row, lease, runNow);
      }
      return true;
    }

    const syncToken = nullableEnvelope(row, "calendarListSyncToken")
      ? this.cipher.decrypt<string>(
          LIST_TOKEN_PURPOSE,
          row.ownerId,
          row.id,
          nullableEnvelope(row, "calendarListSyncToken")!
        )
      : null;
    const base: GoogleCalendarListParams = {
      showDeleted: true,
      showHidden: true,
      maxResults: 250,
      ...(syncToken ? { syncToken } : {}),
    };
    const calendars: ProviderCalendar[] = [];
    let pageToken: string | undefined;
    let terminal: string | undefined;
    try {
      do {
        const page = await this.provider.listCalendars(
          accessToken,
          pageToken ? { ...base, pageToken } : base
        );
        calendars.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        terminal = page.nextSyncToken;
        const fenced = await this.prisma.googleCalendarConnection.updateMany({
          where: {
            id: row.id,
            ownerId: row.ownerId,
            status: "active",
            updatedAt: connectionGeneration,
            calendarListPendingAt: row.calendarListPendingAt,
            calendarListLeaseUntil: lease,
          },
          data: {
            calendarListLeaseUntil: lease,
            updatedAt: connectionGeneration,
          },
        });
        if (fenced.count !== 1) return true;
      } while (pageToken);
      if (!terminal) throw new Error("google_calendar_missing_terminal_token");
    } catch (error) {
      if (isGone(error)) {
        await this.resetCalendarListGone(
          row,
          lease,
          runNow,
          connectionGeneration
        );
      } else if (isInvalidGrant(error)) {
        await this.markCalendarListNeedsReauth(
          row,
          lease,
          connectionGeneration
        );
      } else {
        await this.releaseCalendarListWithBackoff(row, lease, runNow);
      }
      return true;
    }

    await this.commitCalendarList(
      row,
      lease,
      calendars,
      terminal,
      syncToken === null,
      runNow,
      connectionGeneration
    );
    return true;
  }

  async markDueForCatchUp(now: Date): Promise<void> {
    const stale = new Date(now.getTime() - 15 * 60 * 1000);
    await this.prisma.googleCalendarConnection.updateMany({
      where: {
        status: "active",
        calendarListPendingAt: null,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: stale } }],
      },
      data: { calendarListPendingAt: now },
    });
    await this.prisma.calendarSource.updateMany({
      where: {
        selected: true,
        pendingSyncAt: null,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: stale } }],
        connection: { status: "active" },
      },
      data: { pendingSyncAt: now },
    });
  }

  async markDailyReconciliation(now: Date, _slot: number): Promise<void> {
    let cursor: string | undefined;
    while (true) {
      const sources = await this.prisma.calendarSource.findMany({
        where: { selected: true, connection: { status: "active" } },
        orderBy: { id: "asc" },
        take: 500,
        select: {
          id: true,
          ownerId: true,
          pendingSyncAt: true,
          lastFullReconciledAt: true,
        },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const source of sources) {
        if (
          !reconciliationDue(
            source.lastFullReconciledAt,
            now,
            sourceBucket(source.ownerId)
          )
        ) {
          continue;
        }
        await this.markSourceFullRequired(source, now);
      }
      if (sources.length < 500) return;
      cursor = sources.at(-1)!.id;
    }
  }

  private async markSourceFullRequired(
    initial: {
      id: string;
      ownerId: string;
      pendingSyncAt: Date | null;
      lastFullReconciledAt: Date | null;
    },
    now: Date
  ): Promise<void> {
    let source = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const updated = await this.prisma.calendarSource.updateMany({
        where: {
          id: source.id,
          ownerId: source.ownerId,
          selected: true,
          pendingSyncAt: source.pendingSyncAt,
          lastFullReconciledAt: source.lastFullReconciledAt,
        },
        data: {
          fullSyncRequired: true,
          pendingSyncAt: advancePending(source.pendingSyncAt, now),
        },
      });
      if (updated.count === 1) return;
      const current = await this.prisma.calendarSource.findFirst({
        where: {
          id: source.id,
          ownerId: source.ownerId,
          selected: true,
          connection: { status: "active" },
        },
        select: {
          id: true,
          ownerId: true,
          pendingSyncAt: true,
          lastFullReconciledAt: true,
        },
      });
      if (!current) return;
      source = current;
    }
  }

  private async claimSource(runNow: Date): Promise<SourceClaim | null> {
    const row = await this.prisma.calendarSource.findFirst({
      where: {
        selected: true,
        pendingSyncAt: { lte: runNow },
        connection: { status: "active" },
        OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: runNow } }],
      },
      orderBy: [{ pendingSyncAt: "asc" }, { id: "asc" }],
      include: { connection: true },
    });
    if (!row || !row.pendingSyncAt) return null;
    const lease = new Date(runNow.getTime() + LEASE_MS);
    const claimed = await this.prisma.calendarSource.updateMany({
      where: {
        id: row.id,
        ownerId: row.ownerId,
        connectionId: row.connectionId,
        selected: true,
        pendingSyncAt: row.pendingSyncAt,
        OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: runNow } }],
        connection: { status: "active" },
      },
      data: { syncLeaseUntil: lease },
    });
    if (claimed.count !== 1) return null;
    try {
      const accessToken = (
        await this.provider.authorize(this.decryptRefresh(row.connection))
      ).accessToken;
      return {
        id: row.id,
        ownerId: row.ownerId,
        connectionId: row.connectionId,
        pendingSyncAt: row.pendingSyncAt,
        lease,
        fullSyncRequired: row.fullSyncRequired,
        syncToken: nullableEnvelope(row, "syncToken")
          ? this.cipher.decrypt<string>(
              "google-calendar-event-sync-token",
              row.ownerId,
              row.id,
              nullableEnvelope(row, "syncToken")!
            )
          : null,
        calendarId: this.cipher.decrypt<string>(
          SOURCE_ID_PURPOSE,
          row.ownerId,
          row.id,
          requiredEnvelope(row, "externalId")
        ),
        timeZone: row.timeZone,
        accessToken,
        connectionUpdatedAt: row.connection.updatedAt,
      };
    } catch (error) {
      if (isInvalidGrant(error))
        await this.markNeedsReauth(
          {
            id: row.id,
            ownerId: row.ownerId,
            connectionId: row.connectionId,
            pendingSyncAt: row.pendingSyncAt,
            lease,
            connectionUpdatedAt: row.connection.updatedAt,
          } as SourceClaim,
          runNow
        );
      else
        await this.releaseSourceWithBackoff(
          {
            id: row.id,
            ownerId: row.ownerId,
            pendingSyncAt: row.pendingSyncAt,
            lease,
          },
          runNow
        );
      return null;
    }
  }

  private async fenceSource(claim: SourceClaim): Promise<boolean> {
    const fenced = await this.prisma.calendarSource.updateMany({
      where: {
        id: claim.id,
        ownerId: claim.ownerId,
        connectionId: claim.connectionId,
        selected: true,
        pendingSyncAt: claim.pendingSyncAt,
        syncLeaseUntil: claim.lease,
        connection: { status: "active" },
      },
      data: { syncLeaseUntil: claim.lease },
    });
    return fenced.count === 1;
  }

  private async commitEvents(
    claim: SourceClaim,
    events: NormalizedProviderEvent[],
    terminalToken: string,
    full: boolean,
    runNow: Date
  ): Promise<boolean> {
    const token = this.cipher.encrypt(
      "google-calendar-event-sync-token",
      claim.ownerId,
      claim.id,
      terminalToken
    );
    return this.prisma.$transaction(async (tx) => {
      const fenced = await tx.calendarSource.updateMany({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          connectionId: claim.connectionId,
          selected: true,
          pendingSyncAt: claim.pendingSyncAt,
          syncLeaseUntil: claim.lease,
          connection: { status: "active" },
        },
        data: { syncLeaseUntil: claim.lease },
      });
      if (fenced.count !== 1) return false;
      if (full)
        await tx.calendarEvent.deleteMany({
          where: { ownerId: claim.ownerId, sourceId: claim.id },
        });
      const existing = full
        ? []
        : await tx.calendarEvent.findMany({
            where: { ownerId: claim.ownerId, sourceId: claim.id },
            select: eventSelect,
          });
      const byMac = new Map(
        existing.map((event) => [event.externalEventIdMac, event])
      );
      for (const event of events) {
        const mac = this.index.mac(EVENT_ID_PURPOSE, claim.ownerId, event.id);
        const prior = byMac.get(mac);
        if (prior) {
          await this.updateEvent(tx, claim, prior, event);
        } else {
          await this.createEvent(tx, claim, event, mac);
        }
      }
      await this.aliases.rebuildCalendarStays(claim.ownerId, tx);
      const completed = await tx.calendarSource.updateMany({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          pendingSyncAt: claim.pendingSyncAt,
          syncLeaseUntil: claim.lease,
        },
        data: {
          ...tokenColumns("syncToken", token),
          fullSyncRequired: false,
          pendingSyncAt: null,
          syncLeaseUntil: null,
          lastSyncedAt: runNow,
          ...(full ? { lastFullReconciledAt: runNow } : {}),
          errorCode: null,
        },
      });
      if (completed.count !== 1) throw new Error("calendar_sync_fence_lost");
      return true;
    });
  }

  private async createEvent(
    tx: Prisma.TransactionClient,
    claim: SourceClaim,
    event: NormalizedProviderEvent,
    mac: string
  ): Promise<void> {
    const id = this.ids();
    const external = this.cipher.encrypt(
      EVENT_ID_PURPOSE,
      claim.ownerId,
      id,
      event.id
    );
    await tx.calendarEvent.create({
      data: this.eventData(
        claim,
        id,
        event,
        mac,
        external
      ) as Prisma.CalendarEventUncheckedCreateInput,
    });
  }

  private async updateEvent(
    tx: Prisma.TransactionClient,
    claim: SourceClaim,
    prior: Record<string, any>,
    event: NormalizedProviderEvent
  ): Promise<void> {
    const sparse = event.status === "cancelled" && event.startAt === null;
    const data = this.eventMutableData(claim.ownerId, prior.id, event);
    if (sparse) {
      delete data.startAt;
      delete data.endAt;
      delete data.startDate;
      delete data.endDate;
      delete data.allDay;
      delete data.timeZone;
      delete data.detailsCiphertext;
      delete data.detailsIv;
      delete data.detailsTag;
      delete data.detailsKeyVersion;
      if (!event.recurringEventId) {
        delete data.recurringEventIdMac;
        delete data.recurringEventIdCiphertext;
        delete data.recurringEventIdIv;
        delete data.recurringEventIdTag;
        delete data.recurringEventIdKeyVersion;
      }
      if (!event.originalStartAt) delete data.originalStartAt;
    }
    await tx.calendarEvent.updateMany({
      where: { id: prior.id, ownerId: claim.ownerId, sourceId: claim.id },
      data,
    });
  }

  private eventData(
    claim: SourceClaim,
    id: string,
    event: NormalizedProviderEvent,
    mac: string,
    external: EncryptedValue
  ) {
    return {
      id,
      ownerId: claim.ownerId,
      sourceId: claim.id,
      externalEventIdMac: mac,
      ...tokenColumns("externalEventId", external),
      ...this.eventMutableData(claim.ownerId, id, event),
    };
  }

  private eventMutableData(
    ownerId: string,
    id: string,
    event: NormalizedProviderEvent
  ): Record<string, any> {
    const details = event.details
      ? this.cipher.encrypt(EVENT_DETAILS_PURPOSE, ownerId, id, event.details)
      : null;
    const recurring = event.recurringEventId
      ? this.cipher.encrypt(
          RECURRING_ID_PURPOSE,
          ownerId,
          id,
          event.recurringEventId
        )
      : null;
    return {
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      startDate: event.startDate
        ? new Date(`${event.startDate}T00:00:00.000Z`)
        : null,
      endDate: event.endDate
        ? new Date(`${event.endDate}T00:00:00.000Z`)
        : null,
      allDay: event.allDay,
      timeZone: event.timeZone,
      transparency: event.transparency,
      ...(recurring
        ? tokenColumns("recurringEventId", recurring)
        : {
            recurringEventIdMac: null,
            recurringEventIdCiphertext: null,
            recurringEventIdIv: null,
            recurringEventIdTag: null,
            recurringEventIdKeyVersion: null,
          }),
      recurringEventIdMac: event.recurringEventId
        ? this.index.mac(RECURRING_ID_PURPOSE, ownerId, event.recurringEventId)
        : null,
      originalStartAt: event.originalStartAt,
      ...(details
        ? tokenColumns("details", details)
        : {
            detailsCiphertext: null,
            detailsIv: null,
            detailsTag: null,
            detailsKeyVersion: null,
          }),
      sourceUpdatedAt: event.sourceUpdatedAt,
    };
  }

  private async failCloseGone(claim: SourceClaim, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const fenced = await tx.calendarSource.updateMany({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          syncLeaseUntil: claim.lease,
        },
        data: { syncLeaseUntil: claim.lease },
      });
      if (fenced.count !== 1) return;
      const current = await tx.calendarSource.findFirst({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          syncLeaseUntil: claim.lease,
        },
        select: { pendingSyncAt: true },
      });
      const failedEvents = await tx.calendarEvent.findMany({
        where: { ownerId: claim.ownerId, sourceId: claim.id },
        select: { id: true },
      });
      await tx.calendarEvent.deleteMany({
        where: { ownerId: claim.ownerId, sourceId: claim.id },
      });
      if (failedEvents.length > 0) {
        await tx.cityStay.deleteMany({
          where: {
            ownerId: claim.ownerId,
            source: "calendar",
            sourceId: { in: failedEvents.map((event) => event.id) },
          },
        });
      }
      await tx.calendarSource.updateMany({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          syncLeaseUntil: claim.lease,
        },
        data: {
          syncTokenCiphertext: null,
          syncTokenIv: null,
          syncTokenTag: null,
          syncTokenKeyVersion: null,
          fullSyncRequired: true,
          pendingSyncAt: advancePending(
            current?.pendingSyncAt ?? claim.pendingSyncAt,
            now
          ),
          syncLeaseUntil: null,
          errorCode: null,
        },
      });
    });
  }

  private async markNeedsReauth(
    claim: Pick<
      SourceClaim,
      | "id"
      | "ownerId"
      | "connectionId"
      | "pendingSyncAt"
      | "lease"
      | "connectionUpdatedAt"
    >,
    _now: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const demoted = await tx.googleCalendarConnection.updateMany({
        where: {
          id: claim.connectionId,
          ownerId: claim.ownerId,
          status: "active",
          updatedAt: claim.connectionUpdatedAt,
          sources: {
            some: {
              id: claim.id,
              ownerId: claim.ownerId,
              pendingSyncAt: claim.pendingSyncAt,
              syncLeaseUntil: claim.lease,
            },
          },
        },
        data: {
          status: "needs_reauth",
          errorCode: "google_invalid_grant",
          calendarListLeaseUntil: null,
        },
      });
      if (demoted.count !== 1) return;
      await tx.calendarSource.updateMany({
        where: { ownerId: claim.ownerId, connectionId: claim.connectionId },
        data: { syncLeaseUntil: null, errorCode: "google_invalid_grant" },
      });
    });
  }

  private async releaseSourceWithBackoff(
    claim: Pick<SourceClaim, "id" | "ownerId" | "pendingSyncAt" | "lease">,
    now: Date
  ): Promise<void> {
    const released = await this.prisma.calendarSource.updateMany({
      where: {
        id: claim.id,
        ownerId: claim.ownerId,
        syncLeaseUntil: claim.lease,
        pendingSyncAt: claim.pendingSyncAt,
      },
      data: {
        syncLeaseUntil: null,
        pendingSyncAt: jittered(now),
        errorCode: TRANSIENT_ERROR,
      },
    });
    if (released.count === 0) {
      await this.prisma.calendarSource.updateMany({
        where: {
          id: claim.id,
          ownerId: claim.ownerId,
          syncLeaseUntil: claim.lease,
        },
        data: {
          syncLeaseUntil: null,
          errorCode: TRANSIENT_ERROR,
        },
      });
    }
  }

  private async releaseCalendarListWithBackoff(
    row: { id: string; ownerId: string; calendarListPendingAt: Date },
    lease: Date,
    now: Date
  ): Promise<void> {
    const released = await this.prisma.googleCalendarConnection.updateMany({
      where: {
        id: row.id,
        ownerId: row.ownerId,
        calendarListLeaseUntil: lease,
        calendarListPendingAt: row.calendarListPendingAt,
      },
      data: {
        errorCode: TRANSIENT_ERROR,
        calendarListLeaseUntil: null,
        calendarListPendingAt: jittered(now),
      },
    });
    if (released.count === 0) {
      await this.prisma.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          calendarListLeaseUntil: lease,
        },
        data: {
          errorCode: TRANSIENT_ERROR,
          calendarListLeaseUntil: null,
        },
      });
    }
  }

  private async markCalendarListNeedsReauth(
    row: {
      id: string;
      ownerId: string;
      calendarListPendingAt: Date;
    },
    lease: Date,
    connectionGeneration: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const demoted = await tx.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          status: "active",
          updatedAt: connectionGeneration,
          calendarListLeaseUntil: lease,
          calendarListPendingAt: row.calendarListPendingAt,
        },
        data: {
          status: "needs_reauth",
          errorCode: "google_invalid_grant",
          calendarListLeaseUntil: null,
        },
      });
      if (demoted.count !== 1) return;
      await tx.calendarSource.updateMany({
        where: { ownerId: row.ownerId, connectionId: row.id },
        data: { syncLeaseUntil: null, errorCode: "google_invalid_grant" },
      });
    });
  }

  private async resetCalendarListGone(
    row: { id: string; ownerId: string; calendarListPendingAt: Date },
    lease: Date,
    now: Date,
    connectionGeneration: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const fenced = await tx.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          status: "active",
          updatedAt: connectionGeneration,
          calendarListLeaseUntil: lease,
        },
        data: {
          calendarListLeaseUntil: lease,
          updatedAt: connectionGeneration,
        },
      });
      if (fenced.count !== 1) return;
      const current = await tx.googleCalendarConnection.findFirst({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          status: "active",
          updatedAt: connectionGeneration,
          calendarListLeaseUntil: lease,
        },
        select: { calendarListPendingAt: true },
      });
      await tx.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          status: "active",
          updatedAt: connectionGeneration,
          calendarListLeaseUntil: lease,
        },
        data: {
          calendarListSyncTokenCiphertext: null,
          calendarListSyncTokenIv: null,
          calendarListSyncTokenTag: null,
          calendarListSyncTokenKeyVersion: null,
          calendarListPendingAt: advancePending(
            current?.calendarListPendingAt ?? row.calendarListPendingAt,
            now
          ),
          calendarListLeaseUntil: null,
          updatedAt: connectionGeneration,
        },
      });
    });
  }

  private async commitCalendarList(
    row: any,
    lease: Date,
    calendars: ProviderCalendar[],
    terminal: string,
    full: boolean,
    now: Date,
    connectionGeneration: Date
  ): Promise<void> {
    const token = this.cipher.encrypt(
      LIST_TOKEN_PURPOSE,
      row.ownerId,
      row.id,
      terminal
    );
    await this.prisma.$transaction(async (tx) => {
      const fenced = await tx.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          status: "active",
          updatedAt: connectionGeneration,
          calendarListPendingAt: row.calendarListPendingAt,
          calendarListLeaseUntil: lease,
        },
        data: {
          calendarListLeaseUntil: lease,
          updatedAt: connectionGeneration,
        },
      });
      if (fenced.count !== 1) return;
      const incoming = new Set<string>();
      for (const calendar of calendars) {
        if (!calendar.id) continue;
        const mac = this.index.mac(SOURCE_ID_PURPOSE, row.ownerId, calendar.id);
        incoming.add(mac);
        if (calendar.deleted) {
          const removed = await tx.calendarSource.findFirst({
            where: {
              connectionId: row.id,
              ownerId: row.ownerId,
              externalIdMac: mac,
            },
            select: { id: true },
          });
          if (removed) {
            await tx.calendarWatch.updateMany({
              where: {
                ownerId: row.ownerId,
                connectionId: row.id,
                targetType: "events",
                targetKey: removed.id,
                status: "active",
              },
              data: { status: "stopping" },
            });
          }
          await tx.calendarSource.deleteMany({
            where: {
              connectionId: row.id,
              ownerId: row.ownerId,
              externalIdMac: mac,
            },
          });
          continue;
        }
        const prior = await tx.calendarSource.findFirst({
          where: {
            connectionId: row.id,
            ownerId: row.ownerId,
            externalIdMac: mac,
          },
          select: { id: true },
        });
        if (prior) {
          const name = this.cipher.encrypt(
            SOURCE_NAME_PURPOSE,
            row.ownerId,
            prior.id,
            calendar.summary ?? ""
          );
          await tx.calendarSource.updateMany({
            where: { id: prior.id, ownerId: row.ownerId, connectionId: row.id },
            data: {
              ...tokenColumns("name", name),
              timeZone: calendar.timeZone ?? null,
              isPrimary: calendar.primary === true,
            },
          });
        } else {
          const id = this.ids();
          const external = this.cipher.encrypt(
            SOURCE_ID_PURPOSE,
            row.ownerId,
            id,
            calendar.id
          );
          const name = this.cipher.encrypt(
            SOURCE_NAME_PURPOSE,
            row.ownerId,
            id,
            calendar.summary ?? ""
          );
          await tx.calendarSource.create({
            data: {
              id,
              ownerId: row.ownerId,
              connectionId: row.id,
              externalIdMac: mac,
              ...tokenColumns("externalId", external),
              ...tokenColumns("name", name),
              timeZone: calendar.timeZone ?? null,
              selected: calendar.selected === true,
              isPrimary: calendar.primary === true,
              fullSyncRequired: true,
              pendingSyncAt: calendar.selected === true ? now : null,
            } as Prisma.CalendarSourceUncheckedCreateInput,
          });
        }
      }
      if (full) {
        const removed = await tx.calendarSource.findMany({
          where: {
            connectionId: row.id,
            ownerId: row.ownerId,
            externalIdMac: { notIn: [...incoming] },
          },
          select: { id: true },
        });
        if (removed.length > 0) {
          await tx.calendarWatch.updateMany({
            where: {
              ownerId: row.ownerId,
              connectionId: row.id,
              targetType: "events",
              targetKey: { in: removed.map((source) => source.id) },
              status: "active",
            },
            data: { status: "stopping" },
          });
        }
        await tx.calendarSource.deleteMany({
          where: {
            connectionId: row.id,
            ownerId: row.ownerId,
            externalIdMac: { notIn: [...incoming] },
          },
        });
      }
      await this.aliases.rebuildCalendarStays(row.ownerId, tx);
      await tx.googleCalendarConnection.updateMany({
        where: {
          id: row.id,
          ownerId: row.ownerId,
          calendarListPendingAt: row.calendarListPendingAt,
          calendarListLeaseUntil: lease,
          updatedAt: connectionGeneration,
        },
        data: {
          ...tokenColumns("calendarListSyncToken", token),
          calendarListPendingAt: null,
          calendarListLeaseUntil: null,
          lastSyncedAt: now,
          errorCode: null,
          updatedAt: connectionGeneration,
        },
      });
    });
  }

  private decryptRefresh(row: any): string {
    return this.cipher.decrypt<string>(
      REFRESH_TOKEN_PURPOSE,
      row.ownerId,
      row.id,
      requiredEnvelope(row, "refreshToken")
    );
  }
}

export function normalizeProviderEvent(
  event: ProviderEvent,
  sourceTimeZone: string,
  _runNow: Date
): NormalizedProviderEvent | null {
  if (!event.id) return null;
  const status =
    event.status === "cancelled"
      ? "cancelled"
      : event.status === "tentative"
        ? "tentative"
        : "confirmed";
  const allDay =
    typeof event.start?.date === "string" ||
    typeof event.end?.date === "string";
  let startAt: Date | null = null;
  let endAt: Date | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  let timeZone: string | null =
    event.start?.timeZone ?? event.end?.timeZone ?? sourceTimeZone;
  if (allDay) {
    if (
      !validDateOnly(event.start?.date) ||
      !validDateOnly(event.end?.date) ||
      event.end!.date! <= event.start!.date!
    )
      return status === "cancelled" ? tombstone(event.id) : null;
    startDate = event.start!.date!;
    endDate = event.end!.date!;
    try {
      startAt = zonedMidnightUtc(startDate, timeZone);
      endAt = zonedMidnightUtc(endDate, timeZone);
    } catch {
      return null;
    }
  } else if (event.start?.dateTime || event.end?.dateTime) {
    if (
      !offsetDateTime(event.start?.dateTime) ||
      !offsetDateTime(event.end?.dateTime)
    )
      return status === "cancelled" ? tombstone(event.id) : null;
    startAt = new Date(event.start!.dateTime!);
    endAt = new Date(event.end!.dateTime!);
    if (endAt <= startAt)
      return status === "cancelled" ? tombstone(event.id) : null;
  } else if (status !== "cancelled") return null;
  const self = event.attendees?.find(
    (attendee) => attendee.self === true
  )?.responseStatus;
  const response = (
    ["accepted", "declined", "tentative", "needsAction"] as const
  ).includes(self as never)
    ? (self as NormalizedProviderEvent["details"]["selfResponseStatus"])
    : null;
  let originalStartAt: Date | null = null;
  if (offsetDateTime(event.originalStartTime?.dateTime)) {
    originalStartAt = new Date(event.originalStartTime!.dateTime!);
  } else if (validDateOnly(event.originalStartTime?.date)) {
    try {
      originalStartAt = zonedMidnightUtc(
        event.originalStartTime!.date!,
        event.originalStartTime?.timeZone ?? timeZone
      );
    } catch {
      originalStartAt = null;
    }
  }
  return {
    id: event.id,
    status,
    startAt,
    endAt,
    startDate,
    endDate,
    allDay,
    timeZone,
    transparency:
      event.transparency === "transparent" ? "transparent" : "opaque",
    recurringEventId: event.recurringEventId ?? null,
    originalStartAt,
    details:
      status === "cancelled" && !startAt && !event.summary && !event.location
        ? null
        : {
            summary: event.summary ?? "",
            locationText: event.location ?? null,
            selfResponseStatus: response,
          },
    sourceUpdatedAt: offsetDateTime(event.updated)
      ? new Date(event.updated!)
      : null,
  };
}

function tombstone(id: string): NormalizedProviderEvent {
  return {
    id,
    status: "cancelled",
    startAt: null,
    endAt: null,
    startDate: null,
    endDate: null,
    allDay: false,
    timeZone: null,
    transparency: "opaque",
    recurringEventId: null,
    originalStartAt: null,
    details: null,
    sourceUpdatedAt: null,
  };
}

function zonedMidnightUtc(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  let candidate = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const wanted = Date.UTC(year, month - 1, day);
    const difference = represented - wanted;
    if (difference === 0) return new Date(candidate);
    candidate -= difference;
  }
  const result = new Date(candidate);
  if (!Number.isFinite(result.getTime())) throw new Error("invalid_time_zone");
  const verified = Object.fromEntries(
    formatter
      .formatToParts(result)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== 0 ||
    verified.minute !== 0 ||
    verified.second !== 0
  ) {
    throw new Error("invalid_local_midnight");
  }
  return result;
}

function validDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function offsetDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function requiredEnvelope(row: any, prefix: string): EnvelopeRow {
  return {
    ciphertext: Buffer.from(row[`${prefix}Ciphertext`]),
    iv: Buffer.from(row[`${prefix}Iv`]),
    tag: Buffer.from(row[`${prefix}Tag`]),
    keyVersion: row[`${prefix}KeyVersion`],
  };
}

function nullableEnvelope(row: any, prefix: string): EnvelopeRow | null {
  return row[`${prefix}Ciphertext`] &&
    row[`${prefix}Iv`] &&
    row[`${prefix}Tag`] &&
    row[`${prefix}KeyVersion`]
    ? requiredEnvelope(row, prefix)
    : null;
}

function tokenColumns(
  prefix: string,
  value: EncryptedValue
): Record<string, unknown> {
  return {
    [`${prefix}Ciphertext`]: value.ciphertext as Uint8Array<ArrayBuffer>,
    [`${prefix}Iv`]: value.iv as Uint8Array<ArrayBuffer>,
    [`${prefix}Tag`]: value.tag as Uint8Array<ArrayBuffer>,
    [`${prefix}KeyVersion`]: value.keyVersion,
  };
}

function isGone(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 410
  );
}

function isInvalidGrant(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    code?: unknown;
    response?: { data?: { error?: unknown } };
  };
  return (
    value.code === "invalid_grant" ||
    value.response?.data?.error === "invalid_grant"
  );
}

function jittered(now: Date): Date {
  return new Date(now.getTime() + Math.floor(Math.random() * 15 * 60 * 1000));
}

function advancePending(current: Date | null, now: Date): Date {
  return current && current >= now ? new Date(current.getTime() + 1) : now;
}

function sourceBucket(id: string): number {
  return createHash("sha256").update(id, "utf8").digest().readUInt32BE(0) % 96;
}

function reconciliationDue(
  lastFullReconciledAt: Date | null,
  now: Date,
  ownerSlot: number
): boolean {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const scheduledToday = new Date(today + ownerSlot * 15 * 60 * 1000);
  const scheduledYesterday = new Date(scheduledToday.getTime() - DAY_MS);
  if (!lastFullReconciledAt) return now >= scheduledToday;
  if (lastFullReconciledAt < scheduledYesterday) return true;
  return now >= scheduledToday && lastFullReconciledAt < scheduledToday;
}

const eventSelect = {
  id: true,
  externalEventIdMac: true,
  status: true,
  startAt: true,
  endAt: true,
  startDate: true,
  endDate: true,
  allDay: true,
  timeZone: true,
  detailsCiphertext: true,
  detailsIv: true,
  detailsTag: true,
  detailsKeyVersion: true,
};

function watchResult(
  resourceId: string | null | undefined,
  expiration: string | null | undefined
) {
  if (!resourceId || !expiration || !/^[1-9][0-9]*$/.test(expiration)) {
    throw new Error("google_calendar_watch_invalid");
  }
  const expiresAt = new Date(Number(expiration));
  if (!Number.isFinite(expiresAt.getTime()))
    throw new Error("google_calendar_watch_invalid");
  return { resourceId, expiresAt };
}

function configured(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("google_calendar_not_configured");
  }
  return value;
}
