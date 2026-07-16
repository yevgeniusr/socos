import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

const EARTH_RADIUS_M = 6_371_008.8;
const OPEN_RADIUS_M = 150;
const AWAY_RADIUS_M = 250;
const OPEN_DURATION_MS = 10 * 60 * 1_000;
const AWAY_DURATION_MS = 5 * 60 * 1_000;
const FOLLOWING_WINDOW_MS = 15 * 60 * 1_000;
const DERIVATION_VERSION = 1;
const CENTROID_PURPOSE = "derived-visit-centroid";
const SOURCE_PURPOSE = "derived-visit-source";

export type DerivationSample = {
  id: string;
  recordedAt: Date;
  lat: number;
  lon: number;
  accuracyM: number | null;
};

export type DerivedVisitCandidate = {
  arrivedAt: Date;
  departedAt: Date | null;
  centroid: { lat: number; lon: number };
  radiusM: number;
  confidence: 1;
  derivationVersion: 1;
  sampleIds: string[];
};

export type DerivationMetrics = {
  residentCentroidReads: number;
  residentAdds: number;
};

type StoredSample = {
  id: string;
  recordedAt: Date;
  receivedAt: Date;
  accuracyM: number | null;
  coordinatesCiphertext: Uint8Array;
  coordinatesIv: Uint8Array;
  coordinatesTag: Uint8Array;
  coordinatesKeyVersion: number;
};

type StoredVisit = {
  id: string;
  arrivedAt: Date;
  departedAt: Date | null;
  centroidCiphertext: Uint8Array;
  centroidIv: Uint8Array;
  centroidTag: Uint8Array;
  centroidKeyVersion: number;
  radiusM: number;
  confidence: number;
  sourceMac: string;
  derivationVersion: number;
  updatedAt: Date;
};

@Injectable()
export class VisitDerivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService
  ) {}

  async recomputeForSample(
    ownerId: string,
    deviceId: string,
    sampleId: string
  ): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        await acquireDeviceLock(transaction, ownerId, deviceId);
        const inserted = await transaction.locationSample.findFirst({
          where: { id: sampleId, ownerId, deviceId },
          select: { id: true, recordedAt: true },
        });
        if (!inserted) return;

        const predecessor = await transaction.locationSample.findFirst({
          where: {
            ownerId,
            deviceId,
            OR: [
              { recordedAt: { lt: inserted.recordedAt } },
              { recordedAt: inserted.recordedAt, id: { lt: inserted.id } },
            ],
          },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
          select: { id: true, recordedAt: true },
        });

        let startsAt = predecessor?.recordedAt ?? inserted.recordedAt;
        let endsAt = new Date(
          inserted.recordedAt.getTime() + FOLLOWING_WINDOW_MS
        );
        let intersecting: StoredVisit[] = [];

        while (true) {
          const visits = (await transaction.derivedVisit.findMany({
            where: visitOverlapWhere(ownerId, deviceId, startsAt, endsAt),
            orderBy: [{ arrivedAt: "asc" }, { id: "asc" }],
            select: storedVisitSelect,
          })) as StoredVisit[];
          intersecting = mergeVisits(intersecting, visits);
          const earliestVisit = visits[0];
          const openVisit = visits.find((visit) => visit.departedAt === null);
          let nextStart = startsAt;
          let nextEnd = endsAt;
          let expandedStartForVisit = false;

          if (earliestVisit && earliestVisit.arrivedAt < nextStart) {
            nextStart = earliestVisit.arrivedAt;
            expandedStartForVisit = true;
          }
          const closedEnd = Math.max(
            0,
            ...visits.map((visit) =>
              visit.departedAt
                ? visit.departedAt.getTime() + FOLLOWING_WINDOW_MS
                : 0
            )
          );
          if (closedEnd > nextEnd.getTime()) {
            nextEnd = new Date(closedEnd);
          }

          if (expandedStartForVisit) {
            const boundary = await transaction.locationSample.findFirst({
              where: {
                ownerId,
                deviceId,
                recordedAt: { gte: nextStart },
              },
              orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
              select: { id: true, recordedAt: true },
            });
            if (boundary) {
              const before = await transaction.locationSample.findFirst({
                where: {
                  ownerId,
                  deviceId,
                  OR: [
                    { recordedAt: { lt: boundary.recordedAt } },
                    {
                      recordedAt: boundary.recordedAt,
                      id: { lt: boundary.id },
                    },
                  ],
                },
                orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
                select: { id: true, recordedAt: true },
              });
              if (before?.recordedAt) nextStart = before.recordedAt;
            } else {
              const before = await transaction.locationSample.findFirst({
                where: {
                  ownerId,
                  deviceId,
                  recordedAt: { lt: nextStart },
                },
                orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
                select: { id: true, recordedAt: true },
              });
              if (before?.recordedAt) nextStart = before.recordedAt;
            }
          }

          if (openVisit) {
            const latest = await transaction.locationSample.findFirst({
              where: { ownerId, deviceId },
              orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
              select: { recordedAt: true },
            });
            if (latest && latest.recordedAt >= nextEnd) {
              nextEnd = new Date(latest.recordedAt.getTime() + 1);
            }
          }

          if (
            nextStart.getTime() === startsAt.getTime() &&
            nextEnd.getTime() === endsAt.getTime()
          ) {
            break;
          }
          startsAt = nextStart;
          endsAt = nextEnd;
        }

        const storedSamples = (await transaction.locationSample.findMany({
          where: {
            ownerId,
            deviceId,
            recordedAt: { gte: startsAt, lt: endsAt },
          },
          orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
          select: storedSampleSelect,
        })) as StoredSample[];
        if (
          intersecting.some(
            (visit) => !hasExactOpeningSupport(visit, storedSamples)
          )
        ) {
          return;
        }

        const samples = storedSamples.map((sample) => {
          const coordinates = this.cipher.decrypt<{ lat: number; lon: number }>(
            "location-sample-coordinates",
            ownerId,
            sample.id,
            envelope(sample, "coordinates")
          );
          return {
            id: sample.id,
            recordedAt: sample.recordedAt,
            accuracyM: sample.accuracyM,
            lat: coordinates.lat,
            lon: coordinates.lon,
          };
        });

        const keepIds = new Set<string>();
        const candidates = deriveVisits(samples);

        for (const candidate of candidates) {
          const canonical = sourceIdentity(deviceId, candidate.sampleIds);
          const sourceMac = this.index.mac(SOURCE_PURPOSE, ownerId, canonical);
          const current = (await transaction.derivedVisit.findFirst({
            where: { ownerId, deviceId, sourceMac },
            select: storedVisitSelect,
          })) as StoredVisit | null;
          const id = current?.id ?? randomUUID();

          if (current && this.isUnchanged(ownerId, current, candidate)) {
            keepIds.add(current.id);
            continue;
          }

          const encrypted = this.cipher.encrypt(
            CENTROID_PURPOSE,
            ownerId,
            id,
            candidate.centroid
          );
          const data = {
            arrivedAt: candidate.arrivedAt,
            departedAt: candidate.departedAt,
            centroidCiphertext: encrypted.ciphertext as Uint8Array<ArrayBuffer>,
            centroidIv: encrypted.iv as Uint8Array<ArrayBuffer>,
            centroidTag: encrypted.tag as Uint8Array<ArrayBuffer>,
            centroidKeyVersion: encrypted.keyVersion,
            radiusM: candidate.radiusM,
            confidence: candidate.confidence,
            sourceMac,
            derivationVersion: candidate.derivationVersion,
          };
          if (current) {
            const updated = await transaction.derivedVisit.updateMany({
              where: { id, ownerId, deviceId, sourceMac },
              data,
            });
            if (updated.count === 1) keepIds.add(id);
          } else {
            await transaction.derivedVisit.create({
              data: { id, ownerId, deviceId, ...data },
            });
            keepIds.add(id);
          }
        }

        const obsoleteIds = intersecting
          .map((visit) => visit.id)
          .filter((id) => !keepIds.has(id));
        if (obsoleteIds.length > 0) {
          await transaction.derivedVisit.deleteMany({
            where: { id: { in: obsoleteIds }, ownerId, deviceId },
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
  }

  private isUnchanged(
    ownerId: string,
    current: StoredVisit,
    candidate: DerivedVisitCandidate
  ): boolean {
    const centroid = this.cipher.decrypt<{ lat: number; lon: number }>(
      CENTROID_PURPOSE,
      ownerId,
      current.id,
      envelope(current, "centroid")
    );
    return (
      current.arrivedAt.getTime() === candidate.arrivedAt.getTime() &&
      (current.departedAt?.getTime() ?? null) ===
        (candidate.departedAt?.getTime() ?? null) &&
      current.radiusM === candidate.radiusM &&
      current.confidence === candidate.confidence &&
      current.derivationVersion === candidate.derivationVersion &&
      centroid.lat === candidate.centroid.lat &&
      centroid.lon === candidate.centroid.lon
    );
  }
}

export function deriveVisits(
  input: readonly DerivationSample[],
  metrics?: DerivationMetrics
): DerivedVisitCandidate[] {
  const samples = [...input]
    .filter((sample) => sample.accuracyM === null || sample.accuracyM <= 200)
    .sort(compareSamples);
  const visits: DerivedVisitCandidate[] = [];
  let candidate: DerivationSample[] = [];
  let resident: DerivationSample[] | null = null;
  let residentAccumulator: WeightedAccumulator | null = null;
  let away: DerivationSample[] = [];

  for (const sample of samples) {
    if (!resident) {
      candidate = stableSuffix([...candidate, sample]);
      if (canOpen(candidate)) {
        resident = candidate;
        residentAccumulator = accumulatorFor(resident, metrics);
        candidate = [];
      }
      continue;
    }

    if (metrics) metrics.residentCentroidReads += 1;
    const centroid = centroidFromAccumulator(residentAccumulator!);
    if (haversineDistanceM(centroid, sample) <= AWAY_RADIUS_M) {
      away = [];
      resident.push(sample);
      addToAccumulator(residentAccumulator!, sample);
      if (metrics) metrics.residentAdds += 1;
      continue;
    }

    away.push(sample);
    if (
      away.at(-1)!.recordedAt.getTime() - away[0].recordedAt.getTime() >=
      AWAY_DURATION_MS
    ) {
      visits.push(toVisit(resident, away[0].recordedAt));
      candidate = stableSuffix(away);
      resident = canOpen(candidate) ? candidate : null;
      residentAccumulator = resident ? accumulatorFor(resident, metrics) : null;
      if (resident) candidate = [];
      away = [];
    }
  }

  if (resident) visits.push(toVisit(resident, null));
  return visits;
}

type WeightedAccumulator = {
  referenceLon: number;
  totalWeight: number;
  weightedLat: number;
  weightedLon: number;
};

function accumulatorFor(
  points: readonly { lat: number; lon: number; accuracyM: number | null }[],
  metrics?: DerivationMetrics
): WeightedAccumulator {
  if (points.length === 0) throw new Error("Cannot derive an empty centroid");
  const accumulator: WeightedAccumulator = {
    referenceLon: points[0].lon,
    totalWeight: 0,
    weightedLat: 0,
    weightedLon: 0,
  };
  for (const point of points) addToAccumulator(accumulator, point);
  if (metrics) metrics.residentAdds += points.length;
  return accumulator;
}

function addToAccumulator(
  accumulator: WeightedAccumulator,
  point: { lat: number; lon: number; accuracyM: number | null }
): void {
  const weight =
    1 /
    (point.accuracyM === null || point.accuracyM === 0 ? 10 : point.accuracyM);
  let unwrapped = point.lon;
  while (unwrapped - accumulator.referenceLon >= 180) unwrapped -= 360;
  while (unwrapped - accumulator.referenceLon < -180) unwrapped += 360;
  accumulator.totalWeight += weight;
  accumulator.weightedLat += point.lat * weight;
  accumulator.weightedLon += unwrapped * weight;
}

function centroidFromAccumulator(accumulator: WeightedAccumulator): {
  lat: number;
  lon: number;
} {
  return {
    lat: accumulator.weightedLat / accumulator.totalWeight,
    lon: normalizeLongitude(accumulator.weightedLon / accumulator.totalWeight),
  };
}

export function weightedCentroid(
  points: readonly { lat: number; lon: number; accuracyM: number | null }[]
): { lat: number; lon: number } {
  if (points.length === 0) throw new Error("Cannot derive an empty centroid");
  return centroidFromAccumulator(accumulatorFor(points));
}

export function haversineDistanceM(
  first: { lat: number; lon: number },
  second: { lat: number; lon: number }
): number {
  const lat1 = radians(first.lat);
  const lat2 = radians(second.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(second.lon - first.lon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function sourceIdentity(deviceId: string, sampleIds: string[]): string {
  return JSON.stringify({
    derivationVersion: DERIVATION_VERSION,
    deviceId,
    sampleIds,
  });
}

async function acquireDeviceLock(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  deviceId: string
): Promise<void> {
  const lockKey = JSON.stringify([ownerId, deviceId]);
  await transaction.$queryRaw`
    SELECT 1::integer AS "acquired"
    FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    ) AS "location_visit_derivation_lock"
  `;
}

function stableSuffix(samples: DerivationSample[]): DerivationSample[] {
  for (let start = 0; start < samples.length; start += 1) {
    const suffix = samples.slice(start);
    const centroid = weightedCentroid(suffix);
    if (
      suffix.every(
        (sample) => haversineDistanceM(centroid, sample) <= OPEN_RADIUS_M
      )
    ) {
      return suffix;
    }
  }
  return [samples.at(-1)!];
}

function canOpen(samples: DerivationSample[]): boolean {
  return (
    samples.length >= 3 &&
    samples.at(-1)!.recordedAt.getTime() - samples[0].recordedAt.getTime() >=
      OPEN_DURATION_MS
  );
}

function toVisit(
  samples: DerivationSample[],
  departedAt: Date | null
): DerivedVisitCandidate {
  const centroid = weightedCentroid(samples);
  return {
    arrivedAt: samples[0].recordedAt,
    departedAt,
    centroid,
    radiusM: Math.max(
      0,
      ...samples.map((sample) => haversineDistanceM(centroid, sample))
    ),
    confidence: 1,
    derivationVersion: 1,
    sampleIds: samples.map((sample) => sample.id),
  };
}

function compareSamples(
  first: DerivationSample,
  second: DerivationSample
): number {
  return (
    first.recordedAt.getTime() - second.recordedAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function normalizeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function visitOverlapWhere(
  ownerId: string,
  deviceId: string,
  startsAt: Date,
  endsAt: Date
) {
  const dependencyStart = new Date(startsAt.getTime() - FOLLOWING_WINDOW_MS);
  return {
    ownerId,
    deviceId,
    arrivedAt: { lt: endsAt },
    OR: [{ departedAt: null }, { departedAt: { gte: dependencyStart } }],
  };
}

function mergeVisits(
  first: StoredVisit[],
  second: StoredVisit[]
): StoredVisit[] {
  const byId = new Map(first.map((visit) => [visit.id, visit]));
  for (const visit of second) byId.set(visit.id, visit);
  return [...byId.values()].sort(
    (left, right) =>
      left.arrivedAt.getTime() - right.arrivedAt.getTime() ||
      left.id.localeCompare(right.id)
  );
}

function hasExactOpeningSupport(
  visit: StoredVisit,
  samples: readonly StoredSample[]
): boolean {
  return samples.some(
    (sample) =>
      sample.recordedAt.getTime() === visit.arrivedAt.getTime() &&
      (sample.accuracyM === null || sample.accuracyM <= 200) &&
      sample.receivedAt <= visit.updatedAt
  );
}

function envelope(
  value: StoredSample | StoredVisit,
  prefix: "coordinates" | "centroid"
) {
  const source = value as unknown as Record<string, Uint8Array | number>;
  return {
    ciphertext: Buffer.from(source[`${prefix}Ciphertext`] as Uint8Array),
    iv: Buffer.from(source[`${prefix}Iv`] as Uint8Array),
    tag: Buffer.from(source[`${prefix}Tag`] as Uint8Array),
    keyVersion: source[`${prefix}KeyVersion`] as number,
  };
}

const storedSampleSelect = {
  id: true,
  recordedAt: true,
  receivedAt: true,
  accuracyM: true,
  coordinatesCiphertext: true,
  coordinatesIv: true,
  coordinatesTag: true,
  coordinatesKeyVersion: true,
} as const;

const storedVisitSelect = {
  id: true,
  arrivedAt: true,
  departedAt: true,
  centroidCiphertext: true,
  centroidIv: true,
  centroidTag: true,
  centroidKeyVersion: true,
  radiusM: true,
  confidence: true,
  sourceMac: true,
  derivationVersion: true,
  updatedAt: true,
} as const;
