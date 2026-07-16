import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  agentActionProposalInputSchema,
  type AgentActionProposalInput,
  type AgentPrincipal,
  type ProposalActionType,
} from "@socos/agent-core";
import { PrismaService } from "../prisma/prisma.service.js";
import type { ApprovalHistoryQueryDto } from "./action-proposal.dto.js";
import {
  collectProposalContactIds,
  presentProposalHistory,
} from "./action-proposal.presenter.js";
import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
const APPROVAL_TTL_MS = 15 * 60 * 1000;

const proposalPresenter = {
  id: true,
  ownerId: true,
  clientId: true,
  actionType: true,
  riskLevel: true,
  payloadHash: true,
  preview: true,
  status: true,
  expiresAt: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const grantPresenter = {
  id: true,
  ownerId: true,
  clientId: true,
  proposalId: true,
  status: true,
  expiresAt: true,
  consumedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  proposal: {
    select: {
      actionType: true,
      payloadHash: true,
      payload: true,
    },
  },
} as const;

const proposalHistoryPresenter = {
  id: true,
  actionType: true,
  preview: true,
  status: true,
  expiresAt: true,
  decidedAt: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
  grant: {
    select: {
      status: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      outbox: {
        select: {
          status: true,
          attempts: true,
          completedAt: true,
          lastErrorCode: true,
        },
      },
    },
  },
} as const;

export interface ApprovalBinding {
  grantId: string;
  actionType: ProposalActionType;
  payloadHash: string;
}

@Injectable()
export class ActionProposalService {
  constructor(private readonly prisma: PrismaService) {}

  async createProposal(
    principal: AgentPrincipal,
    rawInput: AgentActionProposalInput,
    client?: Prisma.TransactionClient
  ) {
    const input = agentActionProposalInputSchema.parse(rawInput);
    const now = new Date();
    const payloadHash = hashCanonicalJson({
      actionType: input.actionType,
      payload: input.payload,
    });

    const create = async (tx: Prisma.TransactionClient) => {
      await this.assertOwnedReferences(tx, principal.ownerId, input);
      return tx.actionProposal.create({
        data: {
          ownerId: principal.ownerId,
          clientId: principal.clientId,
          actionType: input.actionType,
          riskLevel: "approval_required",
          payloadHash,
          payload: input.payload,
          preview: input.payload,
          metadata: {},
          status: "pending",
          expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        },
        select: proposalPresenter,
      });
    };
    return client ? create(client) : this.prisma.$transaction(create);
  }

  async listPending(ownerId: string) {
    const now = new Date();
    await this.prisma.actionProposal.updateMany({
      where: { ownerId, status: "pending", expiresAt: { lte: now } },
      data: { status: "expired", decidedAt: now },
    });
    return this.prisma.actionProposal.findMany({
      where: { ownerId, status: "pending", expiresAt: { gt: now } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        ...proposalPresenter,
        client: { select: { id: true, name: true } },
      },
    });
  }

  async listHistory(ownerId: string, query: ApprovalHistoryQueryDto) {
    const now = new Date();
    await this.prisma.actionProposal.updateMany({
      where: { ownerId, status: "pending", expiresAt: { lte: now } },
      data: { status: "expired", decidedAt: now },
    });

    const where: Prisma.ActionProposalWhereInput = { ownerId };
    if (query.status !== "all") where.status = query.status;
    const [total, proposals] = await Promise.all([
      this.prisma.actionProposal.count({ where }),
      this.prisma.actionProposal.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: query.offset,
        take: query.limit,
        select: proposalHistoryPresenter,
      }),
    ]);

    const contactIds = collectProposalContactIds(proposals);
    const contacts = contactIds.length
      ? await this.prisma.contact.findMany({
          where: { id: { in: contactIds }, ownerId, isDemo: false },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    return presentProposalHistory(
      proposals,
      contacts,
      total,
      query.offset,
      query.limit
    );
  }

  approve(ownerId: string, proposalId: string) {
    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        const proposal = await tx.actionProposal.findFirst({
          where: { id: proposalId, ownerId },
          select: {
            id: true,
            ownerId: true,
            clientId: true,
            actionType: true,
            payloadHash: true,
            payload: true,
            preview: true,
            status: true,
            expiresAt: true,
          },
        });
        if (!proposal) throw proposalNotFound();
        if (proposal.status === "approved") {
          const existing = await tx.approvalGrant.findUnique({
            where: { proposalId },
            select: grantPresenter,
          });
          if (existing) return existing;
        }
        if (proposal.status !== "pending" || proposal.expiresAt <= now) {
          throw approvalConflict();
        }
        const reviewable = agentActionProposalInputSchema.safeParse({
          actionType: proposal.actionType,
          idempotencyKey: "approval:review",
          payload: proposal.preview,
        });
        const executable = agentActionProposalInputSchema.safeParse({
          actionType: proposal.actionType,
          idempotencyKey: "approval:payload",
          payload: proposal.payload,
        });
        if (
          !reviewable.success ||
          !executable.success ||
          canonicalJson(reviewable.data.payload) !==
            canonicalJson(executable.data.payload) ||
          hashCanonicalJson({
            actionType: executable.data.actionType,
            payload: executable.data.payload,
          }) !== proposal.payloadHash
        ) {
          throw approvalConflict();
        }

        const claim = await tx.actionProposal.updateMany({
          where: {
            id: proposal.id,
            ownerId,
            status: "pending",
            expiresAt: { gt: now },
          },
          data: { status: "approved", decidedAt: now },
        });
        if (claim.count !== 1) throw approvalConflict();

        const expiresAt = new Date(
          Math.min(
            proposal.expiresAt.getTime(),
            now.getTime() + APPROVAL_TTL_MS
          )
        );
        return tx.approvalGrant.create({
          data: {
            ownerId,
            clientId: proposal.clientId,
            proposalId: proposal.id,
            status: "active",
            expiresAt,
          },
          select: grantPresenter,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async reject(ownerId: string, proposalId: string) {
    const now = new Date();
    const result = await this.prisma.actionProposal.updateMany({
      where: {
        id: proposalId,
        ownerId,
        status: "pending",
        expiresAt: { gt: now },
      },
      data: { status: "rejected", decidedAt: now },
    });
    if (result.count !== 1) {
      const proposal = await this.prisma.actionProposal.findFirst({
        where: { id: proposalId, ownerId },
        select: { status: true },
      });
      if (!proposal) throw proposalNotFound();
      if (proposal.status !== "rejected") throw approvalConflict();
    }
    return { id: proposalId, status: "rejected" as const };
  }

  async validateGrant(principal: AgentPrincipal, binding: ApprovalBinding) {
    const grant = await this.prisma.approvalGrant.findFirst({
      where: {
        id: binding.grantId,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        status: "active",
        expiresAt: { gt: new Date() },
        consumedAt: null,
        revokedAt: null,
        proposal: {
          actionType: binding.actionType,
          payloadHash: binding.payloadHash,
        },
      },
      select: grantPresenter,
    });
    if (!grant) throw approvalConflict();
    return grant;
  }

  private async assertOwnedReferences(
    tx: Prisma.TransactionClient,
    ownerId: string,
    input: AgentActionProposalInput
  ): Promise<void> {
    if (input.actionType === "message" || input.actionType === "invitation") {
      await this.assertOwnedContacts(tx, ownerId, [input.payload.contactId]);
      return;
    }
    if (input.actionType === "introduction") {
      await this.assertOwnedContacts(tx, ownerId, [
        input.payload.contactId,
        input.payload.otherContactId,
      ]);
      return;
    }
    if (input.actionType === "merge") {
      await this.assertOwnedContacts(tx, ownerId, [
        input.payload.sourceContactId,
        input.payload.targetContactId,
      ]);
      return;
    }
    const { entityType, entityId } = input.payload;
    let count = 0;
    if (entityType === "contact") {
      count = await tx.contact.count({
        where: { id: entityId, ownerId, isDemo: false },
      });
    } else if (entityType === "interaction") {
      count = await tx.interaction.count({
        where: { id: entityId, contact: { ownerId, isDemo: false } },
      });
    } else {
      count = await tx.reminder.count({
        where: {
          id: entityId,
          ownerId,
          contact: { ownerId, isDemo: false },
        },
      });
    }
    if (count !== 1) throw referencedResourceNotFound();
  }

  private async assertOwnedContacts(
    tx: Prisma.TransactionClient,
    ownerId: string,
    contactIds: string[]
  ): Promise<void> {
    const uniqueIds = [...new Set(contactIds)];
    const count = await tx.contact.count({
      where: { id: { in: uniqueIds }, ownerId, isDemo: false },
    });
    if (count !== uniqueIds.length) throw referencedResourceNotFound();
  }
}

function proposalNotFound(): NotFoundException {
  return new NotFoundException("Action proposal not found");
}

function referencedResourceNotFound(): NotFoundException {
  return new NotFoundException("Referenced CRM resource not found");
}

function approvalConflict(): ConflictException {
  return new ConflictException("Approval is invalid or no longer active");
}
