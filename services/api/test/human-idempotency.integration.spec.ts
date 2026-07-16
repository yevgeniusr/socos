import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { HumanIdempotencyService } from "../src/common/human-idempotency.service.js";

const testDatabaseUrl = process.env.DATABASE_URL;

describe("HumanIdempotencyService PostgreSQL concurrency", () => {
  jest.setTimeout(30_000);
  let prisma: PrismaClient;
  const ownerId = `human-idempotency-${process.pid}`;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.invalid`,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("commits one write and replays one equal response for concurrent identical keys", async () => {
    const service = new HumanIdempotencyService(
      prisma as unknown as PrismaService
    );
    let executions = 0;
    const execute = async (
      tx: Parameters<Parameters<typeof service.execute>[4]>[0]
    ) => {
      executions += 1;
      const user = await tx.user.update({
        where: { id: ownerId },
        data: { xp: { increment: 1 } },
        select: { xp: true },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { xp: user.xp };
    };

    const results = await Promise.all([
      service.execute(
        ownerId,
        "interaction:create",
        "concurrent-intent-key-001",
        { contactId: "contact-synthetic" },
        execute
      ),
      service.execute(
        ownerId,
        "interaction:create",
        "concurrent-intent-key-001",
        { contactId: "contact-synthetic" },
        execute
      ),
    ]);

    expect(results[0].value).toEqual(results[1].value);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(executions).toBe(1);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { xp: true },
      })
    ).resolves.toEqual({ xp: 1 });
    await expect(
      prisma.humanIdempotencyRecord.count({
        where: {
          ownerId,
          operation: "interaction:create",
          idempotencyKey: "concurrent-intent-key-001",
        },
      })
    ).resolves.toBe(1);
  });

  it("deletes at most one expired batch and preserves active records", async () => {
    const service = new HumanIdempotencyService(
      prisma as unknown as PrismaService
    );
    const expiredAt = new Date(Date.now() - 60_000);
    const activeUntil = new Date(Date.now() + 60_000);
    await prisma.humanIdempotencyRecord.createMany({
      data: [
        ...Array.from({ length: 30 }, (_, index) => ({
          ownerId,
          operation: "reminder:create",
          idempotencyKey: `expired-key-${index.toString().padStart(2, "0")}`,
          requestHash: "a".repeat(64),
          status: "completed",
          response: { id: `expired-${index}` },
          expiresAt: expiredAt,
        })),
        {
          ownerId,
          operation: "reminder:create",
          idempotencyKey: "active-cleanup-key-001",
          requestHash: "b".repeat(64),
          status: "completed",
          response: { id: "active" },
          expiresAt: activeUntil,
        },
      ],
    });

    await service.execute(
      ownerId,
      "reminder:create",
      "cleanup-trigger-key-001",
      { title: "Cleanup trigger" },
      async () => ({ id: "cleanup-trigger" })
    );

    await expect(
      prisma.humanIdempotencyRecord.count({
        where: { ownerId, expiresAt: { lte: expiredAt } },
      })
    ).resolves.toBe(5);
    await expect(
      prisma.humanIdempotencyRecord.count({
        where: { ownerId, idempotencyKey: "active-cleanup-key-001" },
      })
    ).resolves.toBe(1);
  });
});
