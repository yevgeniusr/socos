import { Injectable } from "@nestjs/common";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const SAMPLE_FRESHNESS_MS = 30 * 60 * 1_000;
const PLANNED_FIRST_MS = 6 * 60 * 60 * 1_000;

export type LocationContextSource =
  | "sample"
  | "visit"
  | "calendar"
  | "fallback";
export type LocationContextFreshness =
  | "fresh"
  | "recent"
  | "planned"
  | "fallback";

export type InternalLocationContext = {
  source: LocationContextSource;
  freshness: LocationContextFreshness;
  city: string | null;
  countryCode: string | null;
  timeZone: string | null;
  distanceCapability: boolean;
  lastSeenAt: Date | null;
  origin: { lat: number; lon: number } | null;
};

export type PublicLocationContext = Pick<
  InternalLocationContext,
  | "source"
  | "city"
  | "countryCode"
  | "timeZone"
  | "distanceCapability"
  | "lastSeenAt"
>;

@Injectable()
export class LocationContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService
  ) {}

  async current(
    ownerId: string,
    now = new Date()
  ): Promise<PublicLocationContext> {
    return publicContext(await this.resolveCurrent(ownerId, now));
  }

  async resolveCurrent(
    ownerId: string,
    now = new Date()
  ): Promise<InternalLocationContext> {
    return (
      (await this.currentSample(ownerId, now)) ??
      (await this.currentVisit(ownerId, now)) ??
      (await this.stayAt(ownerId, now)) ??
      fallback()
    );
  }

  async resolveForEvent(
    ownerId: string,
    eventStart: Date,
    now = new Date()
  ): Promise<InternalLocationContext> {
    if (eventStart.getTime() - now.getTime() > PLANNED_FIRST_MS) {
      return (
        (await this.stayAt(ownerId, eventStart)) ??
        (await this.currentSample(ownerId, now)) ??
        (await this.currentVisit(ownerId, now)) ??
        fallback()
      );
    }
    return this.resolveCurrent(ownerId, now);
  }

  private async currentSample(
    ownerId: string,
    now: Date
  ): Promise<InternalLocationContext | null> {
    const row = await this.prisma.locationSample.findFirst({
      where: {
        ownerId,
        recordedAt: {
          gte: new Date(now.getTime() - SAMPLE_FRESHNESS_MS),
          lte: now,
        },
      },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        recordedAt: true,
        coordinatesCiphertext: true,
        coordinatesIv: true,
        coordinatesTag: true,
        coordinatesKeyVersion: true,
        device: { select: { lastSeenAt: true } },
      },
    });
    if (!row) return null;
    const origin = this.cipher.decrypt<{ lat: number; lon: number }>(
      "location-sample-coordinates",
      ownerId,
      row.id,
      {
        ciphertext: Buffer.from(row.coordinatesCiphertext),
        iv: Buffer.from(row.coordinatesIv),
        tag: Buffer.from(row.coordinatesTag),
        keyVersion: row.coordinatesKeyVersion,
      }
    );
    return {
      source: "sample",
      freshness: "fresh",
      city: null,
      countryCode: null,
      timeZone: null,
      distanceCapability: true,
      lastSeenAt: row.device.lastSeenAt ?? row.recordedAt,
      origin,
    };
  }

  private async currentVisit(
    ownerId: string,
    now: Date
  ): Promise<InternalLocationContext | null> {
    const row = await this.prisma.derivedVisit.findFirst({
      where: { ownerId, departedAt: null, arrivedAt: { lte: now } },
      orderBy: [{ arrivedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        arrivedAt: true,
        centroidCiphertext: true,
        centroidIv: true,
        centroidTag: true,
        centroidKeyVersion: true,
        device: { select: { lastSeenAt: true } },
      },
    });
    if (!row) return null;
    const origin = this.cipher.decrypt<{ lat: number; lon: number }>(
      "derived-visit-centroid",
      ownerId,
      row.id,
      {
        ciphertext: Buffer.from(row.centroidCiphertext),
        iv: Buffer.from(row.centroidIv),
        tag: Buffer.from(row.centroidTag),
        keyVersion: row.centroidKeyVersion,
      }
    );
    return {
      source: "visit",
      freshness: "recent",
      city: null,
      countryCode: null,
      timeZone: null,
      distanceCapability: true,
      lastSeenAt: row.device.lastSeenAt,
      origin,
    };
  }

  private async stayAt(
    ownerId: string,
    at: Date
  ): Promise<InternalLocationContext | null> {
    const row = await this.prisma.cityStay.findFirst({
      where: {
        ownerId,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
      },
      orderBy: [
        { confidence: "desc" },
        { startsAt: "desc" },
        { sourceId: "asc" },
      ],
      select: {
        city: true,
        countryCode: true,
        timeZone: true,
        startsAt: true,
        endsAt: true,
        sourceId: true,
        confidence: true,
      },
    });
    if (!row) return null;
    return {
      source: "calendar",
      freshness: "planned",
      city: row.city,
      countryCode: row.countryCode,
      timeZone: row.timeZone,
      distanceCapability: false,
      lastSeenAt: null,
      origin: null,
    };
  }
}

function publicContext(
  context: InternalLocationContext
): PublicLocationContext {
  return {
    source: context.source,
    city: context.city,
    countryCode: context.countryCode,
    timeZone: context.timeZone,
    distanceCapability: context.distanceCapability,
    lastSeenAt: context.lastSeenAt,
  };
}

function fallback(): InternalLocationContext {
  return {
    source: "fallback",
    freshness: "fallback",
    city: "Dubai",
    countryCode: "AE",
    timeZone: "Asia/Dubai",
    distanceCapability: false,
    lastSeenAt: null,
    origin: null,
  };
}
