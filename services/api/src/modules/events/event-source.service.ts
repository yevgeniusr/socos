import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  EVENT_FEED_URL_PURPOSE,
  type CertifiedFeedUrl,
  type EventSourceInput,
  type EventSourcePatch,
} from "./events.types.js";
import {
  certifyEventFeedUrl,
  parseAllowedEventHosts,
} from "./event-source-policy.js";

export {
  certifyEventFeedUrl,
  parseAllowedEventHosts,
} from "./event-source-policy.js";

export const EVENT_SOURCE_ID_GENERATOR = Symbol("EVENT_SOURCE_ID_GENERATOR");
export const EVENT_EXTERNAL_SOURCE_ID_GENERATOR = Symbol(
  "EVENT_EXTERNAL_SOURCE_ID_GENERATOR"
);
export type EventSourceIdGenerator = () => string;

const URL_ERROR = "Invalid event source URL";
const EVENT_DELETE_PAGE_SIZE = 500;
const SERIALIZATION_RETRY_LIMIT = 2;

@Injectable()
export class EventSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly personalDataConfig: PersonalDataConfigService,
    private readonly config: ConfigService,
    @Inject(EVENT_SOURCE_ID_GENERATOR)
    private readonly idGenerator: EventSourceIdGenerator = randomUUID,
    @Inject(EVENT_EXTERNAL_SOURCE_ID_GENERATOR)
    private readonly externalIdGenerator: EventSourceIdGenerator = randomUUID
  ) {}

  async create(ownerId: string, input: EventSourceInput) {
    this.personalDataConfig.requireEnabled("eventDiscovery");
    const feed = this.certify(input.feedUrl);
    const id = this.idGenerator();
    const encrypted = this.cipher.encrypt(
      EVENT_FEED_URL_PURPOSE,
      ownerId,
      id,
      feed.href
    );
    const pollIntervalMinutes = boundedInteger(
      input.pollIntervalMinutes,
      15,
      1_440,
      60
    );
    const row = await this.prisma.eventSource.create({
      data: {
        id,
        ownerId,
        provider: "ics",
        externalSourceId: this.externalIdGenerator(),
        name: normalizeRequiredName(input.name),
        feedUrlMac: this.index.mac("event-source-feed-url", ownerId, feed.href),
        ...feedUrlColumns(encrypted),
        allowedHost: feed.hostname,
        city: normalizeOptional(input.city, 500),
        countryCode: normalizeCountryCode(input.countryCode),
        socialWeight: boundedInteger(input.socialWeight, 0, 10, 5),
        pollIntervalMinutes,
        status: "active",
        nextPollAt: new Date(
          Date.now() +
            Math.floor(
              Math.random() *
                Math.min(5 * 60 * 1000, pollIntervalMinutes * 60 * 1000)
            )
        ),
      },
      select: publicSourceSelect,
    });
    return row;
  }

  list(ownerId: string) {
    this.personalDataConfig.requireEnabled("eventDiscovery");
    return this.prisma.eventSource.findMany({
      where: { ownerId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: publicSourceSelect,
    });
  }

  async update(ownerId: string, id: string, input: EventSourcePatch) {
    this.personalDataConfig.requireEnabled("eventDiscovery");
    if (
      input.status !== undefined &&
      input.status !== "active" &&
      input.status !== "disabled"
    ) {
      throw new BadRequestException("Invalid event source");
    }
    const current = await this.prisma.eventSource.findFirst({
      where: { id, ownerId },
      select: { id: true, allowedHost: true },
    });
    if (!current) throw sourceNotFound();

    const feed =
      input.feedUrl === undefined ? undefined : this.certify(input.feedUrl);
    const encrypted = feed
      ? this.cipher.encrypt(EVENT_FEED_URL_PURPOSE, ownerId, id, feed.href)
      : undefined;
    const updated = await this.prisma.eventSource.updateMany({
      where: { id, ownerId },
      data: {
        ...(input.name === undefined
          ? {}
          : { name: normalizeRequiredName(input.name) }),
        ...(feed && encrypted
          ? {
              feedUrlMac: this.index.mac(
                "event-source-feed-url",
                ownerId,
                feed.href
              ),
              ...feedUrlColumns(encrypted),
              allowedHost: feed.hostname,
            }
          : {}),
        ...(input.city === undefined
          ? {}
          : { city: normalizeOptional(input.city, 500) }),
        ...(input.countryCode === undefined
          ? {}
          : { countryCode: normalizeCountryCode(input.countryCode) }),
        ...(input.socialWeight === undefined
          ? {}
          : { socialWeight: boundedInteger(input.socialWeight, 0, 10, 5) }),
        ...(input.pollIntervalMinutes === undefined
          ? {}
          : {
              pollIntervalMinutes: boundedInteger(
                input.pollIntervalMinutes,
                15,
                1_440,
                60
              ),
            }),
        ...(input.status === undefined ? {} : { status: input.status }),
        leaseUntil: null,
        nextPollAt: new Date(),
        errorCode: null,
      },
    });
    if (updated.count !== 1) throw sourceNotFound();
    return this.prisma.eventSource.findFirstOrThrow({
      where: { id, ownerId },
      select: publicSourceSelect,
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    this.personalDataConfig.requireEnabled("eventDiscovery");
    let retryCount = 0;
    while (true) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            let cursor: string | undefined;
            while (true) {
              const page = await tx.discoveredEvent.findMany({
                where: { ownerId, sourceId: id },
                select: { id: true },
                orderBy: { id: "asc" },
                take: EVENT_DELETE_PAGE_SIZE,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              });
              const eventIds = page.map((event) => event.id);
              if (eventIds.length > 0) {
                await tx.briefFeedback.deleteMany({
                  where: {
                    ownerId,
                    briefItem: {
                      kind: "event",
                      sourceType: "discovered_event",
                      sourceId: { in: eventIds },
                    },
                  },
                });
                await tx.briefItem.deleteMany({
                  where: {
                    ownerId,
                    kind: "event",
                    sourceType: "discovered_event",
                    sourceId: { in: eventIds },
                  },
                });
              }
              if (page.length < EVENT_DELETE_PAGE_SIZE) break;
              cursor = page.at(-1)!.id;
            }

            const deleted = await tx.eventSource.deleteMany({
              where: { id, ownerId },
            });
            if (deleted.count !== 1) throw sourceNotFound();
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        return;
      } catch (error) {
        if (!isSerializationConflict(error) || retryCount >= SERIALIZATION_RETRY_LIMIT) {
          throw error;
        }
        retryCount += 1;
      }
    }
  }

  decryptAndRecertify(row: {
    id: string;
    ownerId: string;
    allowedHost: string;
    feedUrlCiphertext: Uint8Array;
    feedUrlIv: Uint8Array;
    feedUrlTag: Uint8Array;
    feedUrlKeyVersion: number;
  }): CertifiedFeedUrl {
    const plaintext = this.cipher.decrypt<string>(
      EVENT_FEED_URL_PURPOSE,
      row.ownerId,
      row.id,
      {
        ciphertext: Buffer.from(row.feedUrlCiphertext),
        iv: Buffer.from(row.feedUrlIv),
        tag: Buffer.from(row.feedUrlTag),
        keyVersion: row.feedUrlKeyVersion,
      }
    );
    const certified = this.certify(plaintext);
    if (certified.hostname !== row.allowedHost) throw new Error(URL_ERROR);
    return certified;
  }

  private certify(raw: unknown): CertifiedFeedUrl {
    try {
      return certifyEventFeedUrl(
        raw,
        parseAllowedEventHosts(
          this.config.get<string>("EVENT_SOURCE_ALLOWED_HOSTS")
        )
      );
    } catch {
      throw new BadRequestException({
        statusCode: 400,
        code: "invalid_event_source",
        message: "Invalid event source",
      });
    }
  }
}

const publicSourceSelect = {
  id: true,
  name: true,
  provider: true,
  allowedHost: true,
  city: true,
  countryCode: true,
  socialWeight: true,
  status: true,
  pollIntervalMinutes: true,
  nextPollAt: true,
  lastPolledAt: true,
  errorCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

function feedUrlColumns(value: EncryptedValue) {
  return {
    feedUrlCiphertext: value.ciphertext as Uint8Array<ArrayBuffer>,
    feedUrlIv: value.iv as Uint8Array<ArrayBuffer>,
    feedUrlTag: value.tag as Uint8Array<ArrayBuffer>,
    feedUrlKeyVersion: value.keyVersion,
  };
}

function normalizeRequiredName(value: unknown): string {
  const normalized = normalizeOptional(value, 500);
  if (!normalized) throw new BadRequestException("Invalid event source");
  return normalized;
}

function normalizeOptional(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new BadRequestException("Invalid event source");
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length > max)
    throw new BadRequestException("Invalid event source");
  return normalized || null;
}

function isSerializationConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: string }).code === "P2034"
  );
}

function normalizeCountryCode(value: unknown): string | null {
  const normalized = normalizeOptional(value, 2);
  if (normalized === null) return null;
  if (!/^[A-Za-z]{2}$/.test(normalized)) {
    throw new BadRequestException("Invalid event source");
  }
  return normalized.toUpperCase();
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    throw new BadRequestException("Invalid event source");
  }
  return value as number;
}

function sourceNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: "event_source_not_found",
    message: "Event source not found",
  });
}
