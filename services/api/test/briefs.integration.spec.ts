import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { BriefFeedbackService } from "../src/modules/briefs/brief-feedback.service.js";
import { BriefGeneratorService } from "../src/modules/briefs/brief-generator.service.js";
import { ImportantDatesService } from "../src/modules/briefs/important-dates.service.js";

jest.setTimeout(30_000);

const synthetic = {
  ownerId: "brief-concurrency-owner-synthetic",
  vaultId: "brief-concurrency-vault-synthetic",
  contactId: "brief-concurrency-contact-synthetic",
  batchId: "brief-concurrency-batch-synthetic",
  itemId: "brief-concurrency-item-synthetic",
  questId: "brief-concurrency-quest-synthetic",
  interactionId: "brief-concurrency-interaction-synthetic",
};

function requireDisposableDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const databaseName = decodeURIComponent(
    new URL(raw).pathname.replace(/^\//, "")
  );
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      "Brief integration tests require a database ending in _test"
    );
  }
}

requireDisposableDatabase();

interface SyntheticContactInput {
  id: string;
  firstName: string;
  birthday?: Date;
  isDemo?: boolean;
  importance?: number;
}

async function seedOwner(
  prisma: PrismaService,
  ownerId: string,
  contacts: SyntheticContactInput[],
  timeZone = "UTC"
): Promise<void> {
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.user.create({
    data: {
      id: ownerId,
      email: `${ownerId}@example.invalid`,
      name: "Synthetic Integration Owner",
      timeZone,
    },
  });
  const vaultId = `${ownerId}-vault`;
  await prisma.vault.create({
    data: { id: vaultId, name: "Synthetic Integration Vault", ownerId },
  });
  for (const contact of contacts) {
    await prisma.contact.create({
      data: {
        id: contact.id,
        vaultId,
        ownerId,
        firstName: contact.firstName,
        lastName: "Synthetic",
        birthday: contact.birthday,
        isDemo: contact.isDemo ?? false,
        importance: contact.importance ?? 3,
      },
    });
  }
}

function generatorFor(prisma: PrismaService): BriefGeneratorService {
  return new BriefGeneratorService(prisma, new ImportantDatesService(prisma));
}

describe("BriefFeedbackService PostgreSQL concurrency", () => {
  const prisma = new PrismaService();
  const service = new BriefFeedbackService(prisma);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.deleteMany({ where: { id: synthetic.ownerId } });

    await prisma.user.create({
      data: {
        id: synthetic.ownerId,
        email: "brief-concurrency-owner@example.invalid",
        name: "Synthetic Brief Owner",
        xp: 7,
      },
    });
    await prisma.vault.create({
      data: {
        id: synthetic.vaultId,
        name: "Synthetic Brief Vault",
        ownerId: synthetic.ownerId,
      },
    });
    await prisma.contact.create({
      data: {
        id: synthetic.contactId,
        vaultId: synthetic.vaultId,
        ownerId: synthetic.ownerId,
        firstName: "Synthetic",
        lastName: "Contact",
      },
    });
    await prisma.briefBatch.create({
      data: {
        id: synthetic.batchId,
        ownerId: synthetic.ownerId,
        localDate: new Date("2026-07-16T00:00:00.000Z"),
        timeZone: "UTC",
        status: "ready",
        generatedAt: new Date("2026-07-16T07:00:00.000Z"),
      },
    });
    await prisma.briefItem.create({
      data: {
        id: synthetic.itemId,
        batchId: synthetic.batchId,
        ownerId: synthetic.ownerId,
        contactId: synthetic.contactId,
        kind: "person",
        sourceType: "relationship",
        sourceId: synthetic.contactId,
        rank: 1,
        score: 90,
        title: "Reconnect with Synthetic Contact",
        reason: "Synthetic concurrency evidence",
        evidence: {},
      },
    });
    await prisma.quest.create({
      data: {
        id: synthetic.questId,
        batchId: synthetic.batchId,
        ownerId: synthetic.ownerId,
        briefItemId: synthetic.itemId,
        title: "Record a synthetic interaction",
        completionType: "interaction",
        targetId: synthetic.contactId,
        xpReward: 15,
        status: "pending",
        createdAt: new Date("2026-07-16T08:00:00.000Z"),
      },
    });
    await prisma.interaction.create({
      data: {
        id: synthetic.interactionId,
        contactId: synthetic.contactId,
        ownerId: synthetic.ownerId,
        type: "call",
        title: "Synthetic concurrency interaction",
        occurredAt: new Date("2026-07-16T09:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: synthetic.ownerId } });
    await prisma.$disconnect();
  });

  it("awards one quest ledger entry across ten simultaneous same-key completions", async () => {
    const requests = Array.from({ length: 10 }, () =>
      service.completeQuest(
        synthetic.ownerId,
        synthetic.questId,
        "concurrent:quest-intent-001",
        { interactionId: synthetic.interactionId }
      )
    );

    const results = await Promise.all(requests);
    const [user, quest, feedbackCount, ledger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: synthetic.ownerId } }),
      prisma.quest.findUniqueOrThrow({ where: { id: synthetic.questId } }),
      prisma.briefFeedback.count({
        where: { ownerId: synthetic.ownerId, questId: synthetic.questId },
      }),
      prisma.xpTransaction.findMany({
        where: {
          ownerId: synthetic.ownerId,
          sourceType: "quest",
          sourceId: synthetic.questId,
        },
      }),
    ]);

    expect(results).toEqual(Array(10).fill(results[0]));
    expect(feedbackCount).toBe(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(15);
    expect(user.xp).toBe(22);
    expect(quest.status).toBe("completed");
    expect(quest.completedAt).toEqual(results[0].completedAt);

    let laterConflict: unknown;
    try {
      await service.completeQuest(
        synthetic.ownerId,
        synthetic.questId,
        "concurrent:quest-intent-002",
        { interactionId: synthetic.interactionId }
      );
    } catch (error) {
      laterConflict = error;
    }

    expect(laterConflict).toBeInstanceOf(ConflictException);
    expect((laterConflict as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: "QUEST_ALREADY_COMPLETED" })
    );
    await expect(
      prisma.briefFeedback.count({ where: { ownerId: synthetic.ownerId } })
    ).resolves.toBe(1);
    await expect(
      prisma.xpTransaction.count({ where: { ownerId: synthetic.ownerId } })
    ).resolves.toBe(1);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: synthetic.ownerId } })
    ).resolves.toEqual(expect.objectContaining({ xp: 22 }));
  });
});

describe("Daily brief PostgreSQL generation integrity", () => {
  const prisma = new PrismaService();
  const owners = {
    concurrent: "brief-generation-concurrent-owner-synthetic",
    rollback: "brief-generation-rollback-owner-synthetic",
    authorizationA: "brief-authorization-owner-a-synthetic",
    authorizationB: "brief-authorization-owner-b-synthetic",
    dubai: "brief-dubai-owner-synthetic",
    recurrence: "brief-recurrence-owner-synthetic",
    demo: "brief-demo-owner-synthetic",
    readOnly: "brief-read-only-owner-synthetic",
  };
  const ownerIds = Object.values(owners);
  const celebrationPackId = "brief-recurrence-pack-synthetic";

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
    await prisma.celebrationPack.deleteMany({
      where: { id: celebrationPackId },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
    await prisma.celebrationPack.deleteMany({
      where: { id: celebrationPackId },
    });
    await prisma.$disconnect();
  });

  it("creates one bounded batch across twenty simultaneous generation calls", async () => {
    const contacts = [1, 2, 3].map((rank) => ({
      id: `${owners.concurrent}-contact-${rank}`,
      firstName: `Concurrent${rank}`,
      importance: 6 - rank,
    }));
    await seedOwner(prisma, owners.concurrent, contacts);
    const generator = generatorFor(prisma);
    const now = new Date("2026-07-16T08:00:00.000Z");

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        generator.generateForOwner(owners.concurrent, now)
      )
    );
    const [batches, itemCount, questCount] = await Promise.all([
      prisma.briefBatch.findMany({ where: { ownerId: owners.concurrent } }),
      prisma.briefItem.count({ where: { ownerId: owners.concurrent } }),
      prisma.quest.count({ where: { ownerId: owners.concurrent } }),
    ]);

    expect(results).toEqual(Array(20).fill(results[0]));
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe("ready");
    expect(itemCount).toBeGreaterThanOrEqual(2);
    expect(itemCount).toBeLessThanOrEqual(8);
    expect(questCount).toBeGreaterThanOrEqual(2);
    expect(questCount).toBeLessThanOrEqual(4);
  });

  it("rolls back batch, item, and quest rows after a late transaction failure", async () => {
    await seedOwner(prisma, owners.rollback, [
      {
        id: `${owners.rollback}-contact-1`,
        firstName: "Rollback",
      },
    ]);
    const originalTransaction = prisma.$transaction.bind(prisma);
    const failingPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== "$transaction") {
          return Reflect.get(target, property, receiver);
        }
        return async (callback: any, options: any) =>
          (originalTransaction as any)(async (tx: any) => {
            const failingTx = new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                if (txProperty !== "briefBatch") {
                  return Reflect.get(txTarget, txProperty, txReceiver);
                }
                return new Proxy(txTarget.briefBatch, {
                  get(delegate, operation, delegateReceiver) {
                    if (operation === "update") {
                      return async () => {
                        throw new Error("Synthetic late transaction failure");
                      };
                    }
                    return Reflect.get(delegate, operation, delegateReceiver);
                  },
                });
              },
            });
            return callback(failingTx);
          }, options);
      },
    }) as unknown as PrismaService;

    await expect(
      generatorFor(failingPrisma).generateForOwner(
        owners.rollback,
        new Date("2026-07-16T08:00:00.000Z")
      )
    ).rejects.toThrow("Synthetic late transaction failure");
    await expect(
      prisma.briefBatch.count({ where: { ownerId: owners.rollback } })
    ).resolves.toBe(0);
    await expect(
      prisma.briefItem.count({ where: { ownerId: owners.rollback } })
    ).resolves.toBe(0);
    await expect(
      prisma.quest.count({ where: { ownerId: owners.rollback } })
    ).resolves.toBe(0);
  });

  it("rejects changed idempotent content and cross-owner reads or mutations", async () => {
    await seedOwner(prisma, owners.authorizationA, [
      {
        id: `${owners.authorizationA}-contact-1`,
        firstName: "AuthorizationA",
      },
      {
        id: `${owners.authorizationA}-contact-2`,
        firstName: "AuthorizationB",
      },
    ]);
    await seedOwner(prisma, owners.authorizationB, [
      {
        id: `${owners.authorizationB}-contact-1`,
        firstName: "Foreign",
      },
    ]);
    const now = new Date("2026-07-16T08:00:00.000Z");
    const generator = generatorFor(prisma);
    const brief = await generator.generateForOwner(owners.authorizationA, now);
    const itemId = brief.people[0].itemId;
    const questId = brief.quests[0].questId;
    const feedback = new BriefFeedbackService(prisma);

    await feedback.recordItemFeedback(
      owners.authorizationA,
      itemId,
      "authorization:item-intent-001",
      { action: "accept" }
    );
    const itemBeforeConflict = await prisma.briefItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        status: true,
        actionedAt: true,
        snoozedUntil: true,
        updatedAt: true,
      },
    });
    await expect(
      feedback.recordItemFeedback(
        owners.authorizationA,
        itemId,
        "authorization:item-intent-001",
        { action: "dismiss", reason: "Changed synthetic content" }
      )
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      generator.getReadyForOwner(owners.authorizationB, now)
    ).resolves.toBeNull();
    await expect(
      feedback.recordItemFeedback(
        owners.authorizationB,
        itemId,
        "authorization:foreign-item-001",
        { action: "dismiss" }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      feedback.completeQuest(
        owners.authorizationB,
        questId,
        "authorization:foreign-quest-001",
        { interactionId: "interaction-does-not-exist-synthetic" }
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      prisma.briefFeedback.count({
        where: { ownerId: owners.authorizationA },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.briefFeedback.count({
        where: { ownerId: owners.authorizationB },
      })
    ).resolves.toBe(0);
    const itemAfterConflict = await prisma.briefItem.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        status: true,
        actionedAt: true,
        snoozedUntil: true,
        updatedAt: true,
      },
    });
    expect(itemBeforeConflict).toEqual(
      expect.objectContaining({
        status: "accepted",
        actionedAt: expect.any(Date),
        snoozedUntil: null,
      })
    );
    expect(itemAfterConflict).toEqual(itemBeforeConflict);
    await expect(
      prisma.xpTransaction.count({
        where: {
          ownerId: { in: [owners.authorizationA, owners.authorizationB] },
        },
      })
    ).resolves.toBe(0);
  });

  it("uses the same Dubai local date on both sides of UTC midnight", async () => {
    await seedOwner(
      prisma,
      owners.dubai,
      [
        {
          id: `${owners.dubai}-contact-1`,
          firstName: "Dubai",
        },
      ],
      "Asia/Dubai"
    );
    const generator = generatorFor(prisma);

    const beforeUtcMidnight = await generator.generateForOwner(
      owners.dubai,
      new Date("2026-12-31T21:30:00.000Z")
    );
    const afterUtcMidnight = await generator.generateForOwner(
      owners.dubai,
      new Date("2027-01-01T00:30:00.000Z")
    );

    expect(beforeUtcMidnight.localDate).toBe("2027-01-01");
    expect(afterUtcMidnight).toEqual(beforeUtcMidnight);
    await expect(
      prisma.briefBatch.count({ where: { ownerId: owners.dubai } })
    ).resolves.toBe(1);
  });

  it("deduplicates December 31 birthdays and January 1 celebrations", async () => {
    const contactId = `${owners.recurrence}-contact-1`;
    await seedOwner(prisma, owners.recurrence, [
      {
        id: contactId,
        firstName: "Recurrence",
        birthday: new Date("1990-12-31T00:00:00.000Z"),
      },
    ]);
    const celebrationId = "brief-recurrence-celebration-synthetic";
    const attachedId = "brief-recurrence-attached-synthetic";
    await prisma.celebrationPack.create({
      data: {
        id: celebrationPackId,
        ownerId: owners.recurrence,
        name: "Synthetic Recurrence Pack",
        celebrations: {
          create: {
            id: celebrationId,
            ownerId: owners.recurrence,
            name: "Synthetic New Year",
            date: "01-01",
            category: "personal",
            calendarType: "gregorian",
          },
        },
      },
    });
    await prisma.contactCelebration.create({
      data: {
        id: attachedId,
        contactId,
        celebrationId,
        ownerId: owners.recurrence,
      },
    });
    await prisma.reminder.createMany({
      data: [
        {
          id: "brief-recurrence-birthday-reminder-synthetic",
          contactId,
          ownerId: owners.recurrence,
          type: "birthday",
          title: "Synthetic birthday reminder",
          scheduledAt: new Date("2026-12-31T12:00:00.000Z"),
        },
        {
          id: "brief-recurrence-celebration-reminder-synthetic",
          contactId,
          ownerId: owners.recurrence,
          type: "custom",
          title: "Recurrence - Synthetic New Year",
          scheduledAt: new Date("2027-01-01T09:00:00.000Z"),
        },
      ],
    });

    const brief = await generatorFor(prisma).generateForOwner(
      owners.recurrence,
      new Date("2026-12-31T10:00:00.000Z")
    );

    expect(brief.dates.filter((date) => date.type === "birthday")).toHaveLength(
      1
    );
    expect(
      brief.dates.filter((date) => date.type === "celebration")
    ).toHaveLength(1);
    expect(brief.dates.filter((date) => date.type === "reminder")).toHaveLength(
      0
    );
    expect(brief.dates.map((date) => date.date)).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("excludes demo contacts from presented and stored brief items", async () => {
    const realContactId = `${owners.demo}-contact-real`;
    const demoContactId = `${owners.demo}-contact-demo`;
    await seedOwner(prisma, owners.demo, [
      { id: realContactId, firstName: "Real" },
      {
        id: demoContactId,
        firstName: "ExcludedDemo",
        birthday: new Date("1990-07-16T00:00:00.000Z"),
        isDemo: true,
        importance: 5,
      },
    ]);

    const brief = await generatorFor(prisma).generateForOwner(
      owners.demo,
      new Date("2026-07-16T08:00:00.000Z")
    );
    const storedContactIds = await prisma.briefItem.findMany({
      where: { ownerId: owners.demo },
      select: { contactId: true },
    });

    expect(brief.people.map((person) => person.contact.id)).toEqual([
      realContactId,
    ]);
    expect(brief.dates).toHaveLength(0);
    expect(storedContactIds).not.toContainEqual({ contactId: demoContactId });
  });

  it("retrieves a ready brief without inserting or updating any domain row", async () => {
    await seedOwner(prisma, owners.readOnly, [
      {
        id: `${owners.readOnly}-contact-1`,
        firstName: "ReadOnly",
      },
    ]);
    const now = new Date("2026-07-16T08:00:00.000Z");
    const generator = generatorFor(prisma);
    const generated = await generator.generateForOwner(owners.readOnly, now);
    const before = await Promise.all([
      prisma.briefBatch.findMany({ where: { ownerId: owners.readOnly } }),
      prisma.briefItem.count({ where: { ownerId: owners.readOnly } }),
      prisma.quest.count({ where: { ownerId: owners.readOnly } }),
      prisma.briefFeedback.count({ where: { ownerId: owners.readOnly } }),
      prisma.xpTransaction.count({ where: { ownerId: owners.readOnly } }),
    ]);

    const retrieved = await generator.getReadyForOwner(owners.readOnly, now);
    const after = await Promise.all([
      prisma.briefBatch.findMany({ where: { ownerId: owners.readOnly } }),
      prisma.briefItem.count({ where: { ownerId: owners.readOnly } }),
      prisma.quest.count({ where: { ownerId: owners.readOnly } }),
      prisma.briefFeedback.count({ where: { ownerId: owners.readOnly } }),
      prisma.xpTransaction.count({ where: { ownerId: owners.readOnly } }),
    ]);

    expect(retrieved).toEqual(generated);
    expect(after).toEqual(before);
  });
});
