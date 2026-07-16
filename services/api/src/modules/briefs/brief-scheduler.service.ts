import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { dateKeyToUtcDate, localDateKey } from "./brief-time.js";
import { BriefGeneratorService } from "./brief-generator.service.js";

const USER_PAGE_SIZE = 100;
const GENERATION_CONCURRENCY = 5;

interface BriefUser {
  id: string;
  timeZone: string;
  briefHourLocal: number;
}

interface GenerationCounts {
  generated: number;
  existing: number;
  failed: number;
}

function localHour(now: Date, timeZone: string): number {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid date");

  const formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const hour = Number(
    formatter.formatToParts(now).find((part) => part.type === "hour")?.value
  );
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Invalid local hour");
  }
  return hour;
}

function ownerRef(ownerId: string): string {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 12);
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const current = values[next];
        next += 1;
        await worker(current);
      }
    }
  );
  await Promise.all(runners);
}

@Injectable()
export class BriefSchedulerService {
  private readonly logger = new Logger(BriefSchedulerService.name);
  private schedulerTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: BriefGeneratorService
  ) {}

  @Cron("0 */15 * * * *", { name: "generate-daily-social-briefs" })
  async handleCron(): Promise<void> {
    await this.generateDueBriefs(new Date());
  }

  async generateDueBriefs(now = new Date()): Promise<GenerationCounts> {
    const run = this.schedulerTail.then(() => this.runDueBriefs(now));
    this.schedulerTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async runDueBriefs(now: Date): Promise<GenerationCounts> {
    const counts: GenerationCounts = { generated: 0, existing: 0, failed: 0 };
    let cursor: string | undefined;

    while (true) {
      const users = await this.prisma.user.findMany({
        where: { contacts: { some: { isDemo: false } } },
        select: { id: true, timeZone: true, briefHourLocal: true },
        orderBy: { id: "asc" },
        take: USER_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const due: BriefUser[] = [];
      for (const user of users) {
        try {
          if (
            !Number.isInteger(user.briefHourLocal) ||
            user.briefHourLocal < 0 ||
            user.briefHourLocal > 23
          ) {
            throw new Error("Invalid brief hour");
          }
          if (localHour(now, user.timeZone) === user.briefHourLocal) {
            due.push(user);
          }
        } catch {
          counts.failed += 1;
          this.logger.error(
            `Brief eligibility failed ownerRef=${ownerRef(user.id)}`
          );
        }
      }

      await mapWithConcurrency(
        due,
        GENERATION_CONCURRENCY,
        async (user) => {
          try {
            const localDate = dateKeyToUtcDate(
              localDateKey(now, user.timeZone)
            );
            const existing = await this.prisma.briefBatch.findUnique({
              where: {
                ownerId_localDate: { ownerId: user.id, localDate },
              },
              select: { id: true, status: true },
            });
            if (existing?.status === "ready") {
              counts.existing += 1;
              return;
            }

            await this.generator.generateForOwner(user.id, now);
            counts.generated += 1;
          } catch {
            counts.failed += 1;
            this.logger.error(
              `Brief generation failed ownerRef=${ownerRef(user.id)}`
            );
          }
        }
      );

      if (users.length < USER_PAGE_SIZE) break;
      cursor = users.at(-1)!.id;
    }

    this.logger.log(
      `Brief scheduler complete generated=${counts.generated} existing=${counts.existing} failed=${counts.failed}`
    );
    return counts;
  }
}
