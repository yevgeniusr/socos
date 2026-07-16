import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "../modules/prisma/prisma.service.js";
import { HumanIdempotencyService } from "./human-idempotency.service.js";

function harness() {
  let persisted: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ acquired: 1 }]),
    humanIdempotencyRecord: {
      findUnique: jest
        .fn()
        .mockImplementation(() => Promise.resolve(persisted)),
      create: jest.fn().mockImplementation(({ data }) => {
        persisted = { id: "intent-synthetic", ...data, response: null };
        return Promise.resolve({ id: "intent-synthetic" });
      }),
      update: jest.fn().mockImplementation(({ data }) => {
        persisted = { ...persisted, ...data };
        return Promise.resolve({ id: "intent-synthetic" });
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  return {
    service: new HumanIdempotencyService(prisma as unknown as PrismaService),
    tx,
  };
}

describe("HumanIdempotencyService", () => {
  it("replays a committed interaction response without another record or XP write", async () => {
    const { service } = harness();
    class InteractionRequest {
      contactId = "contact-synthetic";
      title = "Synthetic";
    }
    let interactionWrites = 0;
    let xpWrites = 0;
    const execute = jest.fn().mockImplementation(async () => {
      interactionWrites += 1;
      xpWrites += 1;
      return {
        interaction: {
          id: "interaction-synthetic",
          occurredAt: new Date("2026-07-17T08:00:00.000Z"),
        },
        user: { xp: 110, level: 2 },
      };
    });

    await service.execute(
      "owner-synthetic",
      "interaction:create",
      "intent-key-interaction-001",
      new InteractionRequest(),
      execute
    );
    const retry = await service.execute(
      "owner-synthetic",
      "interaction:create",
      "intent-key-interaction-001",
      { title: "Synthetic", contactId: "contact-synthetic" },
      execute
    );

    expect(retry).toEqual({
      replayed: true,
      value: {
        interaction: {
          id: "interaction-synthetic",
          occurredAt: "2026-07-17T08:00:00.000Z",
        },
        user: { xp: 110, level: 2 },
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(interactionWrites).toBe(1);
    expect(xpWrites).toBe(1);
  });

  it("does not replay the same owner operation and key for a different request", async () => {
    const { service } = harness();
    await service.execute(
      "owner-synthetic",
      "reminder:create",
      "intent-key-reminder-001",
      { title: "First reminder" },
      async () => ({ id: "reminder-synthetic" })
    );

    await expect(
      service.execute(
        "owner-synthetic",
        "reminder:create",
        "intent-key-reminder-001",
        { title: "Changed reminder" },
        async () => ({ id: "duplicate" })
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
