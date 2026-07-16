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
      count: jest.fn(),
      findMany: jest.fn(),
    },
    contact: { findMany: jest.fn() },
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

  it("lists bounded newest-first history with one owner-scoped contact lookup", async () => {
    const { service, prisma } = harness();
    prisma.actionProposal.updateMany.mockResolvedValue({ count: 1 });
    prisma.actionProposal.count.mockResolvedValue(5);
    prisma.actionProposal.findMany.mockResolvedValue([
      historyRow("proposal-message", "message", {
        contactId: "contact-one",
        channel: "social",
        body: "Synthetic message",
      }),
      historyRow("proposal-introduction", "introduction", {
        contactId: "contact-one",
        otherContactId: "contact-two",
        context: "Synthetic context",
      }),
      historyRow("proposal-invitation", "invitation", {
        contactId: "contact-two",
        title: "Synthetic invitation",
        scheduledAt: "2026-07-20T14:00:00.000Z",
      }),
      historyRow("proposal-merge", "merge", {
        sourceContactId: "contact-one",
        targetContactId: "contact-missing",
      }),
      historyRow("proposal-delete", "delete", {
        entityType: "interaction",
        entityId: "interaction-synthetic",
      }),
    ]);
    prisma.contact.findMany.mockResolvedValue([
      { id: "contact-one", firstName: "Ada", lastName: "Lovelace" },
      { id: "contact-two", firstName: "Grace", lastName: null },
    ]);

    const result = await service.listHistory(principal.ownerId, {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(prisma.actionProposal.updateMany).toHaveBeenCalledWith({
      where: {
        ownerId: principal.ownerId,
        status: "pending",
        expiresAt: { lte: now },
      },
      data: { status: "expired", decidedAt: now },
    });
    expect(prisma.actionProposal.count).toHaveBeenCalledWith({
      where: { ownerId: principal.ownerId },
    });
    expect(prisma.actionProposal.findMany).toHaveBeenCalledWith({
      where: { ownerId: principal.ownerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20,
      select: expect.any(Object),
    });
    expect(prisma.contact.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["contact-one", "contact-two", "contact-missing"],
        },
        ownerId: principal.ownerId,
        isDemo: false,
      },
      select: { id: true, firstName: true, lastName: true },
    });
    expect(result).toEqual({
      proposals: [
        expect.objectContaining({
          id: "proposal-message",
          preview: {
            type: "message",
            contact: { id: "contact-one", name: "Ada Lovelace" },
            channel: "social",
            body: "Synthetic message",
          },
        }),
        expect.objectContaining({
          id: "proposal-introduction",
          preview: {
            type: "introduction",
            contact: { id: "contact-one", name: "Ada Lovelace" },
            otherContact: { id: "contact-two", name: "Grace" },
            context: "Synthetic context",
          },
        }),
        expect.objectContaining({
          id: "proposal-invitation",
          preview: {
            type: "invitation",
            contact: { id: "contact-two", name: "Grace" },
            title: "Synthetic invitation",
            scheduledAt: "2026-07-20T14:00:00.000Z",
          },
        }),
        expect.objectContaining({
          id: "proposal-merge",
          preview: {
            type: "merge",
            sourceContact: { id: "contact-one", name: "Ada Lovelace" },
            targetContact: {
              id: "contact-missing",
              name: "Unavailable contact",
            },
          },
        }),
        expect.objectContaining({
          id: "proposal-delete",
          preview: {
            type: "delete",
            entityType: "interaction",
            entityId: "interaction-synthetic",
            label: "Interaction record",
          },
        }),
      ],
      total: 5,
      offset: 0,
      limit: 20,
    });
  });

  it("uses one identical owner and exact-status filter for count and page", async () => {
    const { service, prisma } = harness();
    prisma.actionProposal.updateMany.mockResolvedValue({ count: 0 });
    prisma.actionProposal.count.mockResolvedValue(0);
    prisma.actionProposal.findMany.mockResolvedValue([]);

    await service.listHistory(principal.ownerId, {
      status: "approved",
      limit: 7,
      offset: 14,
    });

    const expectedWhere = { ownerId: principal.ownerId, status: "approved" };
    expect(prisma.actionProposal.count).toHaveBeenCalledWith({
      where: expectedWhere,
    });
    expect(prisma.actionProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 14, take: 7 })
    );
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("fails malformed persisted previews closed and never leaks raw fields", async () => {
    const { service, prisma } = harness();
    prisma.actionProposal.updateMany.mockResolvedValue({ count: 0 });
    prisma.actionProposal.count.mockResolvedValue(3);
    prisma.actionProposal.findMany.mockResolvedValue([
      {
        ...historyRow("proposal-malformed", "message", {
          contactId: "contact-one",
          channel: "social",
          body: "Synthetic body",
          unexpectedSecret: "must-not-leak",
        }),
        ownerId: "must-not-leak",
        clientId: "must-not-leak",
        payloadHash: "must-not-leak",
        payload: { secret: "must-not-leak" },
        metadata: { secret: "must-not-leak" },
      },
      {
        ...historyRow("proposal-unsupported", "unsupported", {
          secret: "must-not-leak",
        }),
        status: "corrupt",
      },
      historyRow("proposal-null", "delete", null),
    ]);

    const result = await service.listHistory(principal.ownerId, {
      status: "all",
      limit: 20,
      offset: 0,
    });

    expect(result.proposals.map((proposal) => proposal.preview)).toEqual([
      { type: "unavailable", label: "Unavailable preview" },
      { type: "unavailable", label: "Unavailable preview" },
      { type: "unavailable", label: "Unavailable preview" },
    ]);
    expect(result.proposals[1]).toMatchObject({
      actionType: "unavailable",
      status: "unavailable",
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "ownerId",
      "clientId",
      "payloadHash",
      "payload",
      "metadata",
      "must-not-leak",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const select = JSON.stringify(
      prisma.actionProposal.findMany.mock.calls[0][0].select
    );
    for (const forbidden of [
      "ownerId",
      "clientId",
      "payloadHash",
      "payload",
      "metadata",
      "credentials",
    ]) {
      expect(select).not.toContain(forbidden);
    }
  });

  it("projects grant and outbox state without execution payloads or credentials", async () => {
    const { service, prisma } = harness();
    prisma.actionProposal.updateMany.mockResolvedValue({ count: 0 });
    prisma.actionProposal.count.mockResolvedValue(1);
    prisma.actionProposal.findMany.mockResolvedValue([
      {
        ...historyRow("proposal-approved", "delete", {
          entityType: "reminder",
          entityId: "reminder-synthetic",
        }),
        status: "approved",
        grant: {
          status: "consumed",
          expiresAt: new Date("2026-07-16T12:15:00.000Z"),
          consumedAt: new Date("2026-07-16T12:05:00.000Z"),
          revokedAt: null,
          outbox: {
            status: "completed",
            attempts: 1,
            completedAt: new Date("2026-07-16T12:06:00.000Z"),
            lastErrorCode: null,
          },
        },
      },
    ]);

    const result = await service.listHistory(principal.ownerId, {
      status: "approved",
      limit: 1,
      offset: 0,
    });

    expect(result.proposals[0]).toEqual(
      expect.objectContaining({
        grant: {
          status: "consumed",
          expiresAt: new Date("2026-07-16T12:15:00.000Z"),
          consumedAt: new Date("2026-07-16T12:05:00.000Z"),
          revokedAt: null,
          outbox: {
            status: "completed",
            attempts: 1,
            completedAt: new Date("2026-07-16T12:06:00.000Z"),
            lastErrorCode: null,
          },
        },
      })
    );
    expect(JSON.stringify(result)).not.toContain("credentials");
    expect(JSON.stringify(result)).not.toContain("payload");
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

function historyRow(id: string, actionType: string, preview: unknown) {
  return {
    id,
    actionType,
    preview,
    status: "pending",
    expiresAt: new Date("2026-07-17T12:00:00.000Z"),
    decidedAt: null,
    createdAt: now,
    client: { id: principal.clientId, name: principal.clientName },
    grant: null,
  };
}
