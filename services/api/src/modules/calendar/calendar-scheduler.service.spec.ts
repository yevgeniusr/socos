import { SCHEDULE_CRON_OPTIONS } from "@nestjs/schedule/dist/schedule.constants.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import type { CalendarSyncService } from "./calendar-sync.service.js";
import type { CalendarWatchService } from "./calendar-watch.service.js";
import {
  CalendarSchedulerService,
  reconciliationSlot,
} from "./calendar-scheduler.service.js";

describe("CalendarSchedulerService", () => {
  it("declares exact one-minute, fifteen-minute, six-hour, and daily schedules", () => {
    for (const [method, cron] of [
      ["runPending", "0 * * * * *"],
      ["runCatchUp", "0 */15 * * * *"],
      ["maintainWatches", "0 0 */6 * * *"],
      ["runDailyMaintenance", "0 7 0 * * *"],
    ]) {
      expect(
        Reflect.getMetadata(
          SCHEDULE_CRON_OPTIONS,
          CalendarSchedulerService.prototype[
            method as keyof CalendarSchedulerService
          ]
        )
      ).toMatchObject({ cronTime: cron });
    }
  });

  it("uses stable SHA-256 source buckets across 96 slots", () => {
    expect(reconciliationSlot("source-a")).toBe(reconciliationSlot("source-a"));
    expect(reconciliationSlot("source-a")).toBeGreaterThanOrEqual(0);
    expect(reconciliationSlot("source-a")).toBeLessThan(96);
  });

  it("prunes OAuth attempts in rechecked batches capped at 500", async () => {
    const prisma = {
      googleOAuthAttempt: {
        findMany: jest.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const config = { isEnabled: jest.fn().mockReturnValue(true) };
    const service = new CalendarSchedulerService(
      prisma as unknown as PrismaService,
      config as unknown as PersonalDataConfigService,
      {} as CalendarSyncService,
      {} as CalendarWatchService
    );
    const now = new Date("2026-07-16T12:00:00Z");
    await service.pruneOAuthAttempts(now);
    expect(prisma.googleOAuthAttempt.findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date("2026-07-15T12:00:00Z") },
        OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true },
    });
    expect(prisma.googleOAuthAttempt.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["a", "b"] },
        createdAt: { lt: new Date("2026-07-15T12:00:00Z") },
        OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
    });
  });
});
