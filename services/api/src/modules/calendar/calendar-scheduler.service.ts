import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CalendarSyncService } from "./calendar-sync.service.js";
import { CalendarWatchService } from "./calendar-watch.service.js";
export { reconciliationSlot } from "./calendar-reconciliation.js";

const CLAIM_LIMIT = 25;
const OAUTH_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CalendarSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PersonalDataConfigService,
    private readonly sync: CalendarSyncService,
    private readonly watches: CalendarWatchService
  ) {}

  @Cron("0 * * * * *", { name: "calendar-pending-sync", timeZone: "UTC" })
  async runPending(): Promise<void> {
    if (!this.config.isEnabled("calendarSync")) return;
    const now = new Date();
    for (let count = 0; count < CLAIM_LIMIT; count += 1) {
      const list = await this.sync.runNextCalendarList(now);
      const source = await this.sync.runNextSource(now);
      if (!list && !source) break;
    }
  }

  @Cron("0 */15 * * * *", {
    name: "calendar-catch-up",
    timeZone: "UTC",
  })
  async runCatchUp(): Promise<void> {
    if (!this.config.isEnabled("calendarSync")) return;
    const now = new Date();
    await this.sync.markDueForCatchUp(now);
    await this.sync.markDailyReconciliation(
      now,
      now.getUTCHours() * 4 + Math.floor(now.getUTCMinutes() / 15)
    );
  }

  @Cron("0 0 */6 * * *", {
    name: "calendar-watch-maintenance",
    timeZone: "UTC",
  })
  async maintainWatches(): Promise<void> {
    if (!this.config.isEnabled("calendarSync")) return;
    await this.watches.maintain(new Date());
  }

  @Cron("0 7 0 * * *", {
    name: "calendar-daily-maintenance",
    timeZone: "UTC",
  })
  async runDailyMaintenance(): Promise<void> {
    if (!this.config.isEnabled("calendarSync")) return;
    const now = new Date();
    await this.pruneOAuthAttempts(now);
  }

  async pruneOAuthAttempts(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    let deletedTotal = 0;
    while (true) {
      const where = {
        createdAt: { lt: cutoff },
        OR: [
          { consumedAt: { not: null as Date | null } },
          { expiresAt: { lt: now } },
        ],
      };
      const rows = await this.prisma.googleOAuthAttempt.findMany({
        where,
        orderBy: { id: "asc" },
        take: OAUTH_BATCH,
        select: { id: true },
      });
      if (rows.length === 0) return deletedTotal;
      const deleted = await this.prisma.googleOAuthAttempt.deleteMany({
        where: { id: { in: rows.map((row) => row.id) }, ...where },
      });
      deletedTotal += deleted.count;
      if (rows.length < OAUTH_BATCH) return deletedTotal;
    }
  }
}
