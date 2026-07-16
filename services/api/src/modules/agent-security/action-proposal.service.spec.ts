import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AgentPrincipal } from "@socos/agent-core";
import type { PrismaService } from "../prisma/prisma.service.js";
import { hashCanonicalJson } from "./canonical-json.js";
import { ActionProposalService } from "./action-proposal.service.js";

const now = new Date("2026-07-16T12:00:00.000Z");
const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: ["proposals:write"],
};

function harness() {
  const tx = {
    actionProposal: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalGrant: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    contact: { count: jest.fn() },
    interaction: { count: jest.fn() },
    reminder: { count: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    actionProposal: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    approvalGrant: { findFirst: jest.fn() },
  };
  return {
    service: new ActionProposalService(prisma as unknown as PrismaService),
    prisma,
    tx,
  };
}

describe("ActionProposalService", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("creates an approval-required proposal bound to the authenticated client", async () => {
    const { service, tx } = harness();
    tx.contact.count.mockResolvedValue(1);
    tx.actionProposal.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "proposal-synthetic", ...data })
    );
    const input = {
      actionType: "message" as const,
      idempotencyKey: "proposal:message:001",
      payload: {
        contactId: "contact-synthetic",
        channel: "social" as const,
        body: "Synthetic draft",
      },
    };

    const result = await service.createProposal(principal, input);

    expect(result).toEqual(
      expect.objectContaining({
        id: "proposal-synthetic",
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        actionType: "message",
        riskLevel: "approval_required",
        status: "pending",
      })
    );
    expect(tx.actionProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        payloadHash: hashCanonicalJson({
          actionType: input.actionType,
          payload: input.payload,
        }),
      }),
      select: expect.any(Object),
    });
    expect(JSON.stringify(tx.actionProposal.create.mock.calls[0][0])).not.toContain(
      "proposal:message:001"
    );
  });

  it("rejects references outside the authenticated owner", async () => {
    const { service, tx } = harness();
    tx.contact.count.mockResolvedValue(0);

    await expect(
      service.createProposal(principal, {
        actionType: "delete",
        idempotencyKey: "proposal:delete:001",
        payload: { entityType: "contact", entityId: "foreign-contact" },
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.actionProposal.create).not.toHaveBeenCalled();
  });

  it("requires delete-reminder proposals to reference a non-demo owner contact", async () => {
    const { service, tx } = harness();
    tx.reminder.count.mockResolvedValue(0);

    await expect(
      service.createProposal(principal, {
        actionType: "delete",
        idempotencyKey: "proposal:delete:reminder-001",
        payload: { entityType: "reminder", entityId: "demo-reminder" },
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.reminder.count).toHaveBeenCalledWith({
      where: {
        id: "demo-reminder",
        ownerId: principal.ownerId,
        contact: { ownerId: principal.ownerId, isDemo: false },
      },
    });
    expect(tx.actionProposal.create).not.toHaveBeenCalled();
  });

  it("approves a pending proposal and binds a short-lived grant to its exact hash", async () => {
    const { service, tx } = harness();
    tx.actionProposal.findFirst.mockResolvedValue({
      id: "proposal-synthetic",
      ownerId: principal.ownerId,
      clientId: principal.clientId,
      actionType: "message",
      payloadHash: "a".repeat(64),
      status: "pending",
      expiresAt: new Date("2026-07-16T13:00:00.000Z"),
    });
    tx.actionProposal.updateMany.mockResolvedValue({ count: 1 });
    tx.approvalGrant.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "grant-synthetic",
        ...data,
        proposal: {
          actionType: "message",
          payloadHash: "a".repeat(64),
          payload: {},
        },
      })
    );

    const grant = await service.approve(principal.ownerId, "proposal-synthetic");

    expect(grant).toEqual(
      expect.objectContaining({
        id: "grant-synthetic",
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        proposalId: "proposal-synthetic",
        status: "active",
        expiresAt: new Date("2026-07-16T12:15:00.000Z"),
        proposal: expect.objectContaining({
          actionType: "message",
          payloadHash: "a".repeat(64),
        }),
      })
    );
  });

  it("does not disclose or approve another owner's proposal", async () => {
    const { service, tx } = harness();
    tx.actionProposal.findFirst.mockResolvedValue(null);

    await expect(
      service.approve(principal.ownerId, "foreign-proposal")
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.approvalGrant.create).not.toHaveBeenCalled();
  });

  it("rejects expired proposals without creating a grant", async () => {
    const { service, tx } = harness();
    tx.actionProposal.findFirst.mockResolvedValue({
      id: "proposal-synthetic",
      ownerId: principal.ownerId,
      clientId: principal.clientId,
      actionType: "message",
      payloadHash: "a".repeat(64),
      status: "pending",
      expiresAt: new Date("2026-07-16T11:59:00.000Z"),
    });

    await expect(
      service.approve(principal.ownerId, "proposal-synthetic")
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.approvalGrant.create).not.toHaveBeenCalled();
  });

  it("rejects a pending proposal owner-safely", async () => {
    const { service, prisma } = harness();
    prisma.actionProposal.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.reject(principal.ownerId, "proposal-synthetic")
    ).resolves.toEqual({ id: "proposal-synthetic", status: "rejected" });
    expect(prisma.actionProposal.updateMany).toHaveBeenCalledWith({
      where: {
        id: "proposal-synthetic",
        ownerId: principal.ownerId,
        status: "pending",
        expiresAt: { gt: now },
      },
      data: { status: "rejected", decidedAt: now },
    });
  });

  it("validates grants against owner, client, action, hash, status, and expiry", async () => {
    const { service, prisma } = harness();
    const grant = {
      id: "grant-synthetic",
      ownerId: principal.ownerId,
      clientId: principal.clientId,
      proposalId: "proposal-synthetic",
      status: "active",
      expiresAt: new Date("2026-07-16T12:15:00.000Z"),
      consumedAt: null,
      revokedAt: null,
      proposal: {
        actionType: "message",
        payloadHash: "b".repeat(64),
        payload: {},
      },
    };
    prisma.approvalGrant.findFirst.mockResolvedValue(grant);

    await expect(
      service.validateGrant(principal, {
        grantId: grant.id,
        actionType: "message",
        payloadHash: grant.proposal.payloadHash,
      })
    ).resolves.toEqual(grant);
    expect(prisma.approvalGrant.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: grant.id,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        status: "active",
        expiresAt: { gt: now },
        consumedAt: null,
        revokedAt: null,
        proposal: {
          actionType: "message",
          payloadHash: grant.proposal.payloadHash,
        },
      }),
      select: expect.any(Object),
    });
  });
});
