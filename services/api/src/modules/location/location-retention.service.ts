import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

const DEVICE_PAGE_SIZE = 100;
const DELETE_BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1_000;

type RetentionDevice = {
  id: string;
  ownerId: string;
  rawRetentionDays: number;
  derivedRetentionDays: number;
};

export type RetentionCounts = {
  devicesProcessed: number;
  samplesDeleted: number;
  visitsDeleted: number;
  completedAt: Date;
};

@Injectable()
export class LocationRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 15 3 * * *", {
    name: "location-retention",
    timeZone: "UTC",
  })
  async handleCron(): Promise<void> {
    await this.runRetention(new Date());
  }

  async runRetention(now = new Date()): Promise<RetentionCounts> {
    const counts: RetentionCounts = {
      devicesProcessed: 0,
      samplesDeleted: 0,
      visitsDeleted: 0,
      completedAt: now,
    };
    let cursor: string | undefined;

    while (true) {
      const devices = (await this.prisma.locationDevice.findMany({
        orderBy: { id: "asc" },
        take: DEVICE_PAGE_SIZE,
        select: {
          id: true,
          ownerId: true,
          rawRetentionDays: true,
          derivedRetentionDays: true,
        },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })) as RetentionDevice[];

      for (const device of devices) {
        const sampleCutoff = new Date(
          now.getTime() - device.rawRetentionDays * DAY_MS
        );
        const visitCutoff = new Date(
          now.getTime() - device.derivedRetentionDays * DAY_MS
        );
        counts.samplesDeleted += await this.deleteSampleBatches(
          device,
          sampleCutoff
        );
        counts.visitsDeleted += await this.deleteVisitBatches(
          device,
          visitCutoff
        );
        counts.devicesProcessed += 1;
      }

      if (devices.length < DEVICE_PAGE_SIZE) break;
      cursor = devices.at(-1)!.id;
    }
    counts.completedAt = new Date();
    return counts;
  }

  private async deleteSampleBatches(
    device: RetentionDevice,
    cutoff: Date
  ): Promise<number> {
    let total = 0;
    while (true) {
      const deleted = await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.locationSample.findMany({
          where: {
            ownerId: device.ownerId,
            deviceId: device.id,
            recordedAt: { lt: cutoff },
          },
          orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
          take: DELETE_BATCH_SIZE,
          select: { id: true },
        });
        if (rows.length === 0) return { selected: 0, deleted: 0 };
        const result = await transaction.locationSample.deleteMany({
          where: {
            ownerId: device.ownerId,
            deviceId: device.id,
            recordedAt: { lt: cutoff },
            id: { in: rows.map((row) => row.id) },
          },
        });
        return { selected: rows.length, deleted: result.count };
      });
      total += deleted.deleted;
      if (deleted.selected < DELETE_BATCH_SIZE) return total;
    }
  }

  private async deleteVisitBatches(
    device: RetentionDevice,
    cutoff: Date
  ): Promise<number> {
    let total = 0;
    while (true) {
      const deleted = await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.derivedVisit.findMany({
          where: {
            ownerId: device.ownerId,
            deviceId: device.id,
            departedAt: { not: null, lt: cutoff },
          },
          orderBy: [{ departedAt: "asc" }, { id: "asc" }],
          take: DELETE_BATCH_SIZE,
          select: { id: true },
        });
        if (rows.length === 0) return { selected: 0, deleted: 0 };
        const result = await transaction.derivedVisit.deleteMany({
          where: {
            ownerId: device.ownerId,
            deviceId: device.id,
            departedAt: { not: null, lt: cutoff },
            id: { in: rows.map((row) => row.id) },
          },
        });
        return { selected: rows.length, deleted: result.count };
      });
      total += deleted.deleted;
      if (deleted.selected < DELETE_BATCH_SIZE) return total;
    }
  }
}
