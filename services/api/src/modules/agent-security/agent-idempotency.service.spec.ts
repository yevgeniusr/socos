import { Prisma } from "@prisma/client";
import type { AgentPrincipal, AgentResult } from "@socos/agent-core";
import type { PrismaService } from "../prisma/prisma.service.js";
import { hashCanonicalJson } from "./canonical-json.js";
import { AgentIdempotencyService } from "./agent-idempotency.service.js";

const now = new Date("2026-07-16T12:00:00.000Z");
const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: ["interactions:write"],
};
const operation = "interactions.create";
const idempotencyKey = "interaction:intent-001";
const request = { contactId: "contact-synthetic", kind: "call" };
const response: AgentResult<{ interactionId: string }> = {
  ok: true,
  data: { interactionId: "interaction-synthetic" },
};

function harness(existing: Record<string, unknown> | null = null) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    agentIdempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(existing),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "idempotency-synthetic" }),
      update: jest.fn().mockResolvedValue({ id: "idempotency-synthetic" }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  return {
    service: new AgentIdempotencyService(prisma as unknown as PrismaService),
    prisma,
    tx,
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "idempotency-synthetic",
    ownerId: principal.ownerId,
    clientId: principal.clientId,
    operation,
    idempotencyKey,
    requestHash: hashCanonicalJson(request),
    status: "completed",
    response,
    expiresAt: new Date("2026-07-17T12:00:00.000Z"),
    ...overrides,
  };
}

describe("AgentIdempotencyService", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("reserves, executes, and completes inside one serializable transaction", async () => {
    const { service, prisma, tx } = harness();
    const execute = jest.fn().mockResolvedValue(response);

    await expect(
      service.execute(principal, operation, idempotencyKey, request, execute)
    ).resolves.toEqual(response);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      hashCanonicalJson([principal.clientId, operation, idempotencyKey])
    );
    expect(tx.$queryRaw.mock.calls[0][1]).not.toContain("\u0000");
    expect(tx.agentIdempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        operation,
        idempotencyKey,
        requestHash: hashCanonicalJson(request),
        status: "in_progress",
      }),
      select: { id: true },
    });
    expect(execute).toHaveBeenCalledWith(tx);
    expect(tx.agentIdempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: "idempotency-synthetic" },
      data: { status: "completed", response },
    });
  });

  it("replays a completed response for the same canonical request", async () => {
    const reorderedRequest = { kind: "call", contactId: "contact-synthetic" };
    const { service, tx } = harness(record());
    const execute = jest.fn();

    await expect(
      service.execute(
        principal,
        operation,
        idempotencyKey,
        reorderedRequest,
        execute
      )
    ).resolves.toEqual(response);

    expect(execute).not.toHaveBeenCalled();
    expect(tx.agentIdempotencyRecord.create).not.toHaveBeenCalled();
    expect(tx.agentIdempotencyRecord.update).not.toHaveBeenCalled();
  });

  it("returns a deterministic conflict for the same key and different hash", async () => {
    const { service } = harness(record());

    await expect(
      service.execute(
        principal,
        operation,
        idempotencyKey,
        { ...request, kind: "meeting" },
        jest.fn()
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key conflicts with an existing request.",
        retryable: false,
      },
    });
  });

  it("returns a retryable deterministic conflict while work is in progress", async () => {
    const { service } = harness(
      record({ status: "in_progress", response: null })
    );

    await expect(
      service.execute(principal, operation, idempotencyKey, request, jest.fn())
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotent operation is still in progress.",
        retryable: true,
      },
    });
  });

  it("safely replaces an expired record for the same owner and client", async () => {
    const expired = record({ expiresAt: new Date("2026-07-16T11:59:59.999Z") });
    const { service, tx } = harness(expired);

    await expect(
      service.execute(
        principal,
        operation,
        idempotencyKey,
        request,
        jest.fn().mockResolvedValue(response)
      )
    ).resolves.toEqual(response);

    expect(tx.agentIdempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        id: expired.id,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        expiresAt: { lte: now },
      },
    });
    expect(tx.agentIdempotencyRecord.create).toHaveBeenCalledTimes(1);
  });

  it("evaluates expiry after waiting for the transaction lock", async () => {
    const existing = record({
      expiresAt: new Date("2026-07-16T12:00:00.500Z"),
    });
    const replacement: AgentResult<{ interactionId: string }> = {
      ok: true,
      data: { interactionId: "replacement-interaction" },
    };
    const { service, tx } = harness(existing);
    tx.$queryRaw.mockImplementation(async () => {
      jest.setSystemTime(new Date("2026-07-16T12:00:01.000Z"));
      return [{ locked: true }];
    });

    await expect(
      service.execute(
        principal,
        operation,
        idempotencyKey,
        request,
        jest.fn().mockResolvedValue(replacement)
      )
    ).resolves.toEqual(replacement);
    expect(tx.agentIdempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: existing.id,
        expiresAt: { lte: new Date("2026-07-16T12:00:01.000Z") },
      }),
    });
  });

  it("never replays or replaces a cross-owner record, even after expiry", async () => {
    const { service, tx } = harness(
      record({
        ownerId: "other-owner",
        response: { ok: true, data: { private: "must-not-leak" } },
        expiresAt: new Date("2026-07-16T11:59:59.999Z"),
      })
    );

    await expect(
      service.execute(principal, operation, idempotencyKey, request, jest.fn())
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key conflicts with an existing request.",
        retryable: false,
      },
    });
    expect(tx.agentIdempotencyRecord.deleteMany).not.toHaveBeenCalled();
    expect(tx.agentIdempotencyRecord.create).not.toHaveBeenCalled();
  });
});
