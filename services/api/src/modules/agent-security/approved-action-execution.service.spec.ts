import type { AgentPrincipal, AgentResult } from "@socos/agent-core";
import type { PrismaService } from "../prisma/prisma.service.js";
import {
  ApprovedActionExecutionService,
  type ApprovedActionExecutor,
} from "./approved-action-execution.service.js";
import { hashCanonicalJson } from "./canonical-json.js";

const now = new Date("2026-07-16T12:00:00.000Z");
const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: ["approvals:execute"],
};
const input = {
  grantId: "grant-synthetic",
  actionType: "message" as const,
  idempotencyKey: "execute:message:001",
  payload: {
    contactId: "contact-synthetic",
    channel: "social" as const,
    body: "Synthetic approved draft",
  },
};

function grant(overrides: Record<string, unknown> = {}) {
  const payloadHash = hashCanonicalJson({
    actionType: input.actionType,
    payload: input.payload,
  });
  return {
    id: input.grantId,
    ownerId: principal.ownerId,
    clientId: principal.clientId,
    proposalId: "proposal-synthetic",
    status: "active",
    expiresAt: new Date("2026-07-16T12:15:00.000Z"),
    consumedAt: null,
    revokedAt: null,
    proposal: {
      actionType: input.actionType,
      payloadHash,
      payload: input.payload,
    },
    ...overrides,
  };
}

function harness(executor?: ApprovedActionExecutor) {
  const tx = {
    approvalGrant: {
      findFirst: jest.fn().mockResolvedValue(grant()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    actionOutbox: {
      create: jest.fn().mockResolvedValue({ id: "outbox-synthetic" }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
  };
  const executors = new Map();
  if (executor) executors.set("message", executor);
  return {
    service: new ApprovedActionExecutionService(
      prisma as unknown as PrismaService,
      executors
    ),
    prisma,
    tx,
  };
}

describe("ApprovedActionExecutionService", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("fails unavailable actions without consuming approval or creating outbox", async () => {
    const { service, tx } = harness();

    await expect(service.execute(principal, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "ACTION_EXECUTION_UNAVAILABLE",
        message: "No approved executor is available for this action.",
        retryable: false,
      },
    });
    expect(tx.approvalGrant.updateMany).not.toHaveBeenCalled();
    expect(tx.actionOutbox.create).not.toHaveBeenCalled();
  });

  it("rejects changed payload, wrong client, replay, expiry, and corrupt stored hashes", async () => {
    const { service, tx } = harness();
    for (const invalid of [
      null,
      grant({ clientId: "client-other" }),
      grant({ status: "consumed", consumedAt: now }),
      grant({ expiresAt: new Date("2026-07-16T11:59:59.999Z") }),
      grant({
        proposal: {
          ...grant().proposal,
          payloadHash: "f".repeat(64),
        },
      }),
    ]) {
      tx.approvalGrant.findFirst.mockResolvedValueOnce(invalid);
      await expect(service.execute(principal, input)).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "APPROVAL_INVALID" }),
        })
      );
    }
    await expect(
      service.execute(principal, {
        ...input,
        payload: { ...input.payload, body: "Changed after approval" },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "APPROVAL_INVALID" }),
      })
    );
    expect(tx.approvalGrant.updateMany).not.toHaveBeenCalled();
    expect(tx.actionOutbox.create).not.toHaveBeenCalled();
  });

  it("consumes a supported grant exactly once with its outbox in one transaction", async () => {
    const executor: ApprovedActionExecutor = {
      prepare: jest.fn().mockResolvedValue(undefined),
    };
    const { service, prisma, tx } = harness(executor);

    const result: AgentResult<{ executionId: string; status: "queued" }> =
      await service.execute(principal, input);

    expect(result).toEqual({
      ok: true,
      data: { executionId: "outbox-synthetic", status: "queued" },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(executor.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ principal, proposalId: "proposal-synthetic" }),
      tx
    );
    expect(tx.approvalGrant.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: input.grantId,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        status: "active",
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      }),
      data: { status: "consumed", consumedAt: now },
    });
    expect(tx.actionOutbox.create).toHaveBeenCalledWith({
      data: {
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        grantId: input.grantId,
        status: "pending",
      },
      select: { id: true },
    });
  });
});
