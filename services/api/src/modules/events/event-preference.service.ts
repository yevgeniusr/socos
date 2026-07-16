import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { EncryptedValue } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { EventPreferenceInput } from "./events.types.js";

export const EVENT_PREFERENCE_ID_GENERATOR = Symbol(
  "EVENT_PREFERENCE_ID_GENERATOR"
);
const INTEREST_TAGS_PURPOSE = "event-preference-interest-tags";

@Injectable()
export class EventPreferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly config: PersonalDataConfigService,
    @Inject(EVENT_PREFERENCE_ID_GENERATOR)
    private readonly idGenerator: () => string = randomUUID
  ) {}

  async get(ownerId: string) {
    this.config.requireEnabled("eventDiscovery");
    const row = await this.prisma.eventPreference.findUnique({
      where: { ownerId },
    });
    if (!row) return null;
    return {
      id: row.id,
      interestTags: this.cipher.decrypt<string[]>(
        INTEREST_TAGS_PURPOSE,
        ownerId,
        row.id,
        {
          ciphertext: Buffer.from(row.interestTagsCiphertext),
          iv: Buffer.from(row.interestTagsIv),
          tag: Buffer.from(row.interestTagsTag),
          keyVersion: row.interestTagsKeyVersion,
        }
      ),
      maxDistanceKm: Number(row.maxDistanceKm),
      travelSpeedKph: row.travelSpeedKph,
      travelBufferMinutes: row.travelBufferMinutes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(ownerId: string, input: EventPreferenceInput) {
    this.config.requireEnabled("eventDiscovery");
    try {
      const tags = normalizeTags(input.interestTags);
      const numeric = preferenceValues(input);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await this.prisma.eventPreference.findUnique({
          where: { ownerId },
          select: { id: true },
        });
        const id = existing?.id ?? this.idGenerator();
        const encrypted = this.cipher.encrypt(
          INTEREST_TAGS_PURPOSE,
          ownerId,
          id,
          tags
        );

        if (!existing) {
          try {
            const created = await this.prisma.eventPreference.create({
              data: {
                id,
                ownerId,
                ...interestTagColumns(encrypted),
                maxDistanceKm: input.maxDistanceKm ?? 50,
                travelSpeedKph: input.travelSpeedKph ?? 30,
                travelBufferMinutes: input.travelBufferMinutes ?? 15,
              },
              select: publicPreferenceSelect,
            });
            return presentPreference(created, tags);
          } catch (error) {
            if (isUniqueConflict(error)) continue;
            throw error;
          }
        }

        const updated = await this.prisma.eventPreference.updateMany({
          where: { id, ownerId },
          data: { ...interestTagColumns(encrypted), ...numeric },
        });
        if (updated.count !== 1) continue;
        const row = await this.prisma.eventPreference.findUnique({
          where: { ownerId },
          select: publicPreferenceSelect,
        });
        if (row?.id === id) return presentPreference(row, tags);
      }
      throw preferenceWriteFailed();
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw preferenceWriteFailed();
    }
  }

  async remove(ownerId: string): Promise<void> {
    this.config.requireEnabled("eventDiscovery");
    await this.prisma.eventPreference.deleteMany({ where: { ownerId } });
  }
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 50) throw invalidPreference();
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") throw invalidPreference();
    const tag = raw.normalize("NFC").trim();
    if (!tag || [...tag].length > 100) throw invalidPreference();
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function preferenceValues(input: EventPreferenceInput) {
  if (
    input.maxDistanceKm !== undefined &&
    (!Number.isFinite(input.maxDistanceKm) ||
      input.maxDistanceKm < 1 ||
      input.maxDistanceKm > 500)
  ) {
    throw invalidPreference();
  }
  if (
    input.travelSpeedKph !== undefined &&
    (!Number.isInteger(input.travelSpeedKph) ||
      input.travelSpeedKph < 1 ||
      input.travelSpeedKph > 300)
  ) {
    throw invalidPreference();
  }
  if (
    input.travelBufferMinutes !== undefined &&
    (!Number.isInteger(input.travelBufferMinutes) ||
      input.travelBufferMinutes < 0 ||
      input.travelBufferMinutes > 240)
  ) {
    throw invalidPreference();
  }
  return {
    ...(input.maxDistanceKm === undefined
      ? {}
      : { maxDistanceKm: input.maxDistanceKm }),
    ...(input.travelSpeedKph === undefined
      ? {}
      : { travelSpeedKph: input.travelSpeedKph }),
    ...(input.travelBufferMinutes === undefined
      ? {}
      : { travelBufferMinutes: input.travelBufferMinutes }),
  };
}

const publicPreferenceSelect = {
  id: true,
  maxDistanceKm: true,
  travelSpeedKph: true,
  travelBufferMinutes: true,
  createdAt: true,
  updatedAt: true,
} as const;

function presentPreference<
  T extends {
    maxDistanceKm: unknown;
  },
>(row: T, interestTags: string[]) {
  return { ...row, maxDistanceKm: Number(row.maxDistanceKm), interestTags };
}

function invalidPreference(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: "invalid_event_preference",
    message: "Invalid event preference",
  });
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function preferenceWriteFailed(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: "event_preference_write_failed",
    message: "Event preference could not be saved",
  });
}

function interestTagColumns(value: EncryptedValue) {
  return {
    interestTagsCiphertext: value.ciphertext as Uint8Array<ArrayBuffer>,
    interestTagsIv: value.iv as Uint8Array<ArrayBuffer>,
    interestTagsTag: value.tag as Uint8Array<ArrayBuffer>,
    interestTagsKeyVersion: value.keyVersion,
  };
}
