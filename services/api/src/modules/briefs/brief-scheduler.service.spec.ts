import type { Logger } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { BriefGeneratorService } from "./brief-generator.service.js";
import { BriefSchedulerService } from "./brief-scheduler.service.js";

const now = new Date("2026-07-16T08:15:00.000Z");

interface SyntheticUser {
  id: string;
  timeZone: string;
  briefHourLocal: number;
}

function harness(
  users: SyntheticUser[],
  options: {
    existingOwnerIds?: string[];
    failures?: string[];
  } = {}
) {
  const sortedUsers = [...users].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const existingOwnerIds = new Set(options.existingOwnerIds ?? []);
  const generatedOwnerIds = new Set<string>();
  const failures = new Set(options.failures ?? []);
  const page = <T extends { id: string }>(
    rows: T[],
    args: { cursor?: { id: string }; take: number }
  ): T[] => {
    const start = args.cursor
      ? rows.findIndex((row) => row.id === args.cursor!.id) + 1
      : 0;
    return rows.slice(Math.max(0, start), start + args.take);
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockImplementation((args) =>
        Promise.resolve(page(sortedUsers, args))
      ),
    },
    briefBatch: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          existingOwnerIds.has(where.ownerId_localDate.ownerId) ||
            generatedOwnerIds.has(where.ownerId_localDate.ownerId)
            ? { id: `batch-${where.ownerId_localDate.ownerId}`, status: "ready" }
            : null
        )
      ),
    },
  };
  const generator = {
    generateForOwner: jest.fn().mockImplementation((ownerId: string) => {
      if (failures.has(ownerId)) {
        return Promise.reject(new Error("synthetic generation failure"));
      }
      generatedOwnerIds.add(ownerId);
      return Promise.resolve({ schemaVersion: "1.0" });
    }),
  };
  const service = new BriefSchedulerService(
    prisma as unknown as PrismaService,
    generator as unknown as BriefGeneratorService
  );
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  (
    service as unknown as {
      logger: Pick<Logger, "log" | "warn" | "error" | "debug">;
    }
  ).logger = logger;

  return { service, prisma, generator, logger };
}

describe("BriefSchedulerService", () => {
  it("generates only for owners whose configured local hour is due", async () => {
    const { service, generator } = harness([
      { id: "dubai", timeZone: "Asia/Dubai", briefHourLocal: 12 },
      { id: "honolulu", timeZone: "Pacific/Honolulu", briefHourLocal: 22 },
      { id: "kiritimati", timeZone: "Pacific/Kiritimati", briefHourLocal: 22 },
      { id: "not-due", timeZone: "UTC", briefHourLocal: 9 },
    ]);

    await expect(service.generateDueBriefs(now)).resolves.toEqual({
      generated: 3,
      existing: 0,
      failed: 0,
    });
    expect(generator.generateForOwner.mock.calls.map(([id]) => id).sort()).toEqual(
      ["dubai", "honolulu", "kiritimati"]
    );
  });

  it("records invalid timezone and generation failures without stopping others", async () => {
    const { service, generator, logger } = harness(
      [
        { id: "invalid-zone", timeZone: "Mars/Olympus", briefHourLocal: 8 },
        { id: "fails", timeZone: "UTC", briefHourLocal: 8 },
        { id: "works", timeZone: "UTC", briefHourLocal: 8 },
      ],
      { failures: ["fails"] }
    );

    await expect(service.generateDueBriefs(now)).resolves.toEqual({
      generated: 1,
      existing: 0,
      failed: 2,
    });
    expect(generator.generateForOwner).toHaveBeenCalledWith("works", now);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("Mars/Olympus");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "synthetic generation failure"
    );
  });

  it("counts a ready local-date batch as existing without regenerating", async () => {
    const { service, generator } = harness(
      [{ id: "existing", timeZone: "Asia/Dubai", briefHourLocal: 12 }],
      { existingOwnerIds: ["existing"] }
    );

    await expect(service.generateDueBriefs(now)).resolves.toEqual({
      generated: 0,
      existing: 1,
      failed: 0,
    });
    expect(generator.generateForOwner).not.toHaveBeenCalled();
  });

  it("pages eligible users in bounded groups of 100", async () => {
    const users = Array.from({ length: 205 }, (_, index) => ({
      id: `owner-${String(index).padStart(3, "0")}`,
      timeZone: "UTC",
      briefHourLocal: 8,
    }));
    const { service, prisma, generator } = harness(users);

    await expect(service.generateDueBriefs(now)).resolves.toEqual({
      generated: 205,
      existing: 0,
      failed: 0,
    });
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 100,
        skip: 1,
        cursor: { id: "owner-099" },
      })
    );
    expect(generator.generateForOwner).toHaveBeenCalledTimes(205);
  });

  it("never runs more than five owner generations concurrently", async () => {
    const users = Array.from({ length: 12 }, (_, index) => ({
      id: `owner-${index}`,
      timeZone: "UTC",
      briefHourLocal: 8,
    }));
    const { service, generator } = harness(users);
    let active = 0;
    let peak = 0;
    generator.generateForOwner.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { schemaVersion: "1.0" };
    });

    await service.generateDueBriefs(now);

    expect(peak).toBe(5);
  });

  it("logs only aggregate counts and sanitized owner identifiers", async () => {
    const sensitive = [
      "private@example.com",
      "Sensitive Contact",
      "Private Birthday",
      "personal feedback reason",
    ];
    const { service, logger } = harness([
      { id: "owner-safe-id", timeZone: "UTC", briefHourLocal: 8 },
    ]);

    await service.generateDueBriefs(now);

    const output = JSON.stringify(
      Object.values(logger).flatMap((method) => method.mock.calls)
    );
    for (const value of sensitive) expect(output).not.toContain(value);
    expect(output).toContain("generated");
  });

  it("serializes overlapping ticks and counts the persisted batch once", async () => {
    const { service, generator } = harness([
      { id: "owner", timeZone: "UTC", briefHourLocal: 8 },
    ]);

    const results = await Promise.all([
      service.generateDueBriefs(now),
      service.generateDueBriefs(now),
    ]);

    expect(generator.generateForOwner).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { generated: 1, existing: 0, failed: 0 },
      { generated: 0, existing: 1, failed: 0 },
    ]);
  });

  it("keeps the five-worker cap across overlapping scheduler calls", async () => {
    const users = Array.from({ length: 12 }, (_, index) => ({
      id: `overlap-owner-${index}`,
      timeZone: "UTC",
      briefHourLocal: 8,
    }));
    const { service, generator } = harness(users);
    let active = 0;
    let peak = 0;
    generator.generateForOwner.mockImplementation(async (ownerId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { schemaVersion: "1.0", ownerId };
    });

    await Promise.all([
      service.generateDueBriefs(now),
      service.generateDueBriefs(now),
    ]);

    expect(peak).toBe(5);
  });
});
