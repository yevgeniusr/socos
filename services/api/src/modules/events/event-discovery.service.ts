import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DnsPinnedFetchService } from "./dns-pinned-fetch.service.js";
import { EventSourceService } from "./event-source.service.js";
import {
  EVENT_CANONICAL_PURPOSE,
  EVENT_PROVIDER_ID_PURPOSE,
  type NormalizedDiscoveredEvent,
} from "./events.types.js";
import { IcsEventDiscoveryAdapter } from "./ics-event-discovery.adapter.js";

export const DISCOVERED_EVENT_ID_GENERATOR = Symbol(
  "DISCOVERED_EVENT_ID_GENERATOR"
);
export const EVENT_DISCOVERY_CLOCK = Symbol("EVENT_DISCOVERY_CLOCK");
export type DiscoveredEventIdGenerator = () => string;

const CLAIM_LIMIT = 12;
const POLL_CONCURRENCY = 3;
const LEASE_MS = 5 * 60 * 1000;
const DEADLINE_MS = 10_000;
const FAILURE_CODE = "event_feed_failed";
const WRITE_CHUNK_SIZE = 200;

export type EventSourceClaim = {
  id: string;
  ownerId: string;
  provider: string;
  allowedHost: string;
  feedUrlCiphertext: Uint8Array;
  feedUrlIv: Uint8Array;
  feedUrlTag: Uint8Array;
  feedUrlKeyVersion: number;
  status: string;
  pollIntervalMinutes: number;
  leaseUntil: Date;
};

@Injectable()
export class EventDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly config: PersonalDataConfigService,
    private readonly sources: EventSourceService,
    private readonly fetcher: DnsPinnedFetchService,
    private readonly adapter: IcsEventDiscoveryAdapter,
    @Inject(DISCOVERED_EVENT_ID_GENERATOR)
    private readonly idGenerator: DiscoveredEventIdGenerator = randomUUID,
    @Inject(EVENT_DISCOVERY_CLOCK)
    private readonly clock: () => Date = () => new Date()
  ) {}

  @Cron("* * * * *")
  async pollDueSources(runNow = new Date()): Promise<void> {
    if (!this.config.isEnabled("eventDiscovery")) return;
    const claims = await this.claimDueSources(runNow);
    for (let index = 0; index < claims.length; index += POLL_CONCURRENCY) {
      const batch = claims.slice(index, index + POLL_CONCURRENCY);
      await Promise.allSettled(
        batch.map((claim) => this.pollClaim(claim, runNow))
      );
    }
  }

  async pollClaim(claim: EventSourceClaim, runNow = new Date()): Promise<void> {
    try {
      const deadlineAt = Date.now() + DEADLINE_MS;
      const adapter = claim.provider === "ics" ? this.adapter : undefined;
      if (!adapter) throw new Error(FAILURE_CODE);
      const certified = this.sources.decryptAndRecertify(claim);
      const text = await this.fetcher.fetchText(
        new URL(certified.href),
        deadlineAt
      );
      const events = adapter.parse(text, runNow, deadlineAt);
      await this.commitSuccessfulPoll(claim, events, runNow);
    } catch {
      await this.releaseFailedPoll(claim, runNow);
    }
  }

  private async claimDueSources(runNow: Date): Promise<EventSourceClaim[]> {
    const leaseUntil = new Date(runNow.getTime() + LEASE_MS);
    const rows = await this.prisma.$queryRaw<EventSourceClaim[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "EventSource"
        WHERE "status" IN ('active', 'error')
          AND "nextPollAt" <= ${runNow}
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${runNow})
        ORDER BY "nextPollAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${CLAIM_LIMIT}
      )
      UPDATE "EventSource" AS source
      SET "leaseUntil" = ${leaseUntil}
      FROM candidates
      WHERE source."id" = candidates."id"
      RETURNING source."id", source."ownerId", source."provider", source."allowedHost",
        source."feedUrlCiphertext", source."feedUrlIv", source."feedUrlTag",
        source."feedUrlKeyVersion", source."status",
        source."pollIntervalMinutes", source."leaseUntil"
    `);
    return rows;
  }

  private async commitSuccessfulPoll(
    claim: EventSourceClaim,
    events: readonly NormalizedDiscoveredEvent[],
    runNow: Date
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const fenceNow = this.clock();
        const fenced = await tx.eventSource.updateMany({
          where: {
            id: claim.id,
            ownerId: claim.ownerId,
            status: claim.status,
            leaseUntil: { equals: claim.leaseUntil, gt: fenceNow },
          },
          data: { leaseUntil: claim.leaseUntil },
        });
        if (fenced.count !== 1) return;

        const seenMacs: string[] = [];
        const dedupe = new Set<string>();
        for (const event of events) {
          const providerEventIdMac = this.index.mac(
            EVENT_PROVIDER_ID_PURPOSE,
            claim.ownerId,
            event.providerEventId
          );
          if (dedupe.has(providerEventIdMac)) throw new Error(FAILURE_CODE);
          dedupe.add(providerEventIdMac);
          seenMacs.push(providerEventIdMac);
        }

        const existingRows =
          seenMacs.length === 0
            ? []
            : await tx.discoveredEvent.findMany({
                where: {
                  ownerId: claim.ownerId,
                  sourceId: claim.id,
                  providerEventIdMac: { in: seenMacs },
                },
                select: { id: true, providerEventIdMac: true },
              });
        const existingByMac = new Map(
          existingRows.map((row) => [row.providerEventIdMac, row.id])
        );
        const prepared: PreparedEvent[] = events.map((event, index) => {
          const providerEventIdMac = seenMacs[index];
          const existingId = existingByMac.get(providerEventIdMac);
          const eventId = existingId ?? this.idGenerator();
          const encrypted = this.cipher.encrypt(
            EVENT_PROVIDER_ID_PURPOSE,
            claim.ownerId,
            eventId,
            event.providerEventId
          );
          return {
            id: eventId,
            ownerId: claim.ownerId,
            sourceId: claim.id,
            providerEventIdMac,
            existing: Boolean(existingId),
            ...eventColumns(
              event,
              encrypted,
              this.index.mac(
                EVENT_CANONICAL_PURPOSE,
                claim.ownerId,
                event.canonicalIdentity
              )
            ),
          };
        });

        for (const chunk of chunks(
          prepared.filter((event) => !event.existing),
          WRITE_CHUNK_SIZE
        )) {
          const created = await tx.discoveredEvent.createMany({
            data: chunk.map(({ existing: _existing, ...event }) => ({
              ...event,
              discoveredAt: runNow,
            })),
          });
          if (created.count !== chunk.length) throw new Error(FAILURE_CODE);
        }
        for (const chunk of chunks(
          prepared.filter((event) => event.existing),
          WRITE_CHUNK_SIZE
        )) {
          await this.updateExistingEvents(tx, claim, chunk);
        }

        await tx.discoveredEvent.updateMany({
          where: {
            ownerId: claim.ownerId,
            sourceId: claim.id,
            ...(seenMacs.length > 0
              ? { providerEventIdMac: { notIn: seenMacs } }
              : {}),
            endAt: { lte: runNow },
            status: { not: "expired" },
          },
          data: { status: "expired" },
        });

        const completed = await tx.eventSource.updateMany({
          where: {
            id: claim.id,
            ownerId: claim.ownerId,
            status: claim.status,
            leaseUntil: { equals: claim.leaseUntil, gt: this.clock() },
          },
          data: {
            status: "active",
            errorCode: null,
            lastPolledAt: runNow,
            nextPollAt: new Date(
              runNow.getTime() + claim.pollIntervalMinutes * 60 * 1000
            ),
            leaseUntil: null,
          },
        });
        if (completed.count !== 1) throw new Error(FAILURE_CODE);
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
  }

  private async updateExistingEvents(
    tx: Prisma.TransactionClient,
    claim: EventSourceClaim,
    events: readonly PreparedEvent[]
  ): Promise<void> {
    const values = events.map(
      (event) => Prisma.sql`(
      ${event.id}::text,
      ${event.providerEventIdCiphertext}::bytea,
      ${event.providerEventIdIv}::bytea,
      ${event.providerEventIdTag}::bytea,
      ${event.providerEventIdKeyVersion}::integer,
      ${event.canonicalMac}::text,
      ${event.title}::text,
      ${event.descriptionExcerpt}::text,
      ${event.url}::text,
      ${event.startAt}::timestamp,
      ${event.endAt}::timestamp,
      ${event.timeZone}::text,
      ${event.venueName}::text,
      ${event.address}::text,
      ${event.city}::text,
      ${event.countryCode}::text,
      ${event.latitude}::numeric,
      ${event.longitude}::numeric,
      ${event.category}::text,
      ${event.tags}::text[],
      ${event.status}::text,
      ${event.sourceUpdatedAt}::timestamp,
      ${event.expiresAt}::timestamp
    )`
    );
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "DiscoveredEvent" AS target
      SET
        "providerEventIdCiphertext" = incoming."providerEventIdCiphertext",
        "providerEventIdIv" = incoming."providerEventIdIv",
        "providerEventIdTag" = incoming."providerEventIdTag",
        "providerEventIdKeyVersion" = incoming."providerEventIdKeyVersion",
        "canonicalMac" = incoming."canonicalMac",
        "title" = incoming."title",
        "descriptionExcerpt" = incoming."descriptionExcerpt",
        "url" = incoming."url",
        "startAt" = incoming."startAt",
        "endAt" = incoming."endAt",
        "timeZone" = incoming."timeZone",
        "venueName" = incoming."venueName",
        "address" = incoming."address",
        "city" = incoming."city",
        "countryCode" = incoming."countryCode",
        "latitude" = incoming."latitude",
        "longitude" = incoming."longitude",
        "category" = incoming."category",
        "tags" = incoming."tags",
        "status" = incoming."status",
        "sourceUpdatedAt" = COALESCE(
          incoming."sourceUpdatedAt",
          target."sourceUpdatedAt"
        ),
        "expiresAt" = incoming."expiresAt",
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(values)}) AS incoming(
        "id",
        "providerEventIdCiphertext",
        "providerEventIdIv",
        "providerEventIdTag",
        "providerEventIdKeyVersion",
        "canonicalMac",
        "title",
        "descriptionExcerpt",
        "url",
        "startAt",
        "endAt",
        "timeZone",
        "venueName",
        "address",
        "city",
        "countryCode",
        "latitude",
        "longitude",
        "category",
        "tags",
        "status",
        "sourceUpdatedAt",
        "expiresAt"
      )
      WHERE target."id" = incoming."id"
        AND target."ownerId" = ${claim.ownerId}
        AND target."sourceId" = ${claim.id}
    `);
    if (updated !== events.length) throw new Error(FAILURE_CODE);
  }

  private async releaseFailedPoll(
    claim: EventSourceClaim,
    runNow: Date
  ): Promise<void> {
    const backoffCapMs = Math.min(
      60 * 60 * 1000,
      claim.pollIntervalMinutes * 60 * 1000
    );
    const jitterMs = Math.floor(Math.random() * backoffCapMs);
    const fenceNow = this.clock();
    await this.prisma.eventSource.updateMany({
      where: {
        id: claim.id,
        ownerId: claim.ownerId,
        status: claim.status,
        leaseUntil: { equals: claim.leaseUntil, gt: fenceNow },
      },
      data: {
        status: "error",
        errorCode: FAILURE_CODE,
        leaseUntil: null,
        nextPollAt: new Date(runNow.getTime() + jitterMs),
      },
    });
  }
}

function eventColumns(
  event: NormalizedDiscoveredEvent,
  providerId: EncryptedValue,
  canonicalMac: string
) {
  return {
    providerEventIdCiphertext: providerId.ciphertext as Uint8Array<ArrayBuffer>,
    providerEventIdIv: providerId.iv as Uint8Array<ArrayBuffer>,
    providerEventIdTag: providerId.tag as Uint8Array<ArrayBuffer>,
    providerEventIdKeyVersion: providerId.keyVersion,
    canonicalMac,
    title: event.title,
    descriptionExcerpt: event.descriptionExcerpt,
    url: event.url,
    startAt: event.startAt,
    endAt: event.endAt,
    timeZone: event.timeZone,
    venueName: event.venueName,
    address: event.address,
    city: event.city,
    countryCode: event.countryCode,
    latitude: event.latitude,
    longitude: event.longitude,
    category: event.category,
    tags: event.tags,
    status: event.status,
    sourceUpdatedAt: event.sourceUpdatedAt,
    expiresAt: event.expiresAt,
  };
}

type PreparedEvent = ReturnType<typeof eventColumns> & {
  id: string;
  ownerId: string;
  sourceId: string;
  providerEventIdMac: string;
  existing: boolean;
};

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
