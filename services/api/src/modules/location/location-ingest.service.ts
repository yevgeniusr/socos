import { randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  AuthenticatedLocationDevice,
  OwnTracksLocationDto,
} from "./location.dto.js";

const PAYLOAD_MAC_PURPOSE = "owntracks-payload";
const COORDINATES_PURPOSE = "location-sample-coordinates";

@Injectable()
export class LocationIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PersonalDataConfigService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService
  ) {}

  async ingest(
    device: AuthenticatedLocationDevice,
    input: OwnTracksLocationDto,
    receivedAt = new Date()
  ): Promise<[]> {
    this.config.requireEnabled("locationIngest");

    const recordedAt = new Date(input.tst * 1_000);
    const canonical = canonicalOwnTracksPayload(device.id, input);
    const payloadMac = this.index.mac(
      PAYLOAD_MAC_PURPOSE,
      device.ownerId,
      canonical
    );
    const sampleId = randomUUID();
    const coordinates = this.cipher.encrypt(
      COORDINATES_PURPOSE,
      device.ownerId,
      sampleId,
      {
        lat: normalizeZero(input.lat),
        lon: normalizeZero(input.lon),
        alt: optionalNumber(input.alt),
        cog: optionalNumber(input.cog),
        vel: optionalNumber(input.vel),
      }
    );

    try {
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.locationDevice.findFirst({
          where: { id: device.id, ownerId: device.ownerId, status: "active" },
          select: { lastSeenAt: true },
        });
        if (!current) throw unauthorized();

        await transaction.locationSample.create({
          data: {
            id: sampleId,
            ownerId: device.ownerId,
            deviceId: device.id,
            recordedAt,
            receivedAt,
            coordinatesCiphertext:
              coordinates.ciphertext as Uint8Array<ArrayBuffer>,
            coordinatesIv: coordinates.iv as Uint8Array<ArrayBuffer>,
            coordinatesTag: coordinates.tag as Uint8Array<ArrayBuffer>,
            coordinatesKeyVersion: coordinates.keyVersion,
            accuracyM: optionalNumber(input.acc),
            batteryPercent: input.batt ?? null,
            trigger: input.t ?? null,
            payloadMac,
          },
        });

        if (!current.lastSeenAt || current.lastSeenAt < recordedAt) {
          await transaction.locationDevice.updateMany({
            where: monotonicLastSeenWhere(device, recordedAt),
            data: { lastSeenAt: recordedAt },
          });
        }
      });
    } catch (error) {
      if (!isPayloadDuplicate(error)) throw error;
      await this.prisma.locationDevice.updateMany({
        where: monotonicLastSeenWhere(device, recordedAt),
        data: { lastSeenAt: recordedAt },
      });
    }

    return [];
  }
}

export function canonicalOwnTracksPayload(
  deviceId: string,
  input: OwnTracksLocationDto
): string {
  return JSON.stringify({
    deviceId,
    tst: normalizeZero(input.tst),
    lat: normalizeZero(input.lat),
    lon: normalizeZero(input.lon),
    acc: optionalNumber(input.acc),
    alt: optionalNumber(input.alt),
    vel: optionalNumber(input.vel),
    cog: optionalNumber(input.cog),
    batt: input.batt === undefined ? null : normalizeZero(input.batt),
    t: input.t ?? null,
  });
}

function optionalNumber(value: number | undefined): number | null {
  return value === undefined ? null : normalizeZero(value);
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function monotonicLastSeenWhere(
  device: AuthenticatedLocationDevice,
  recordedAt: Date
) {
  return {
    id: device.id,
    ownerId: device.ownerId,
    status: "active",
    OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: recordedAt } }],
  };
}

function isPayloadDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("deviceId") && target.includes("payloadMac");
  }
  return (
    typeof target === "string" &&
    target.includes("deviceId") &&
    target.includes("payloadMac")
  );
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: "invalid_device_credentials",
    message: "Unauthorized",
  });
}
