import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  agentApprovedActionInputSchema,
  type AgentApprovedActionInput,
  type AgentPrincipal,
  type AgentResult,
  type ProposalActionType,
} from "@socos/agent-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashCanonicalJson } from "./canonical-json.js";

export const APPROVED_ACTION_EXECUTORS = Symbol("APPROVED_ACTION_EXECUTORS");

export interface ApprovedActionContext {
  principal: AgentPrincipal;
  proposalId: string;
  actionType: ProposalActionType;
  payload: Prisma.JsonValue;
}

export interface ApprovedActionExecutor {
  prepare(
    context: ApprovedActionContext,
    tx: Prisma.TransactionClient
  ): Promise<void>;
}

type ExecutionResult = {
  executionId: string;
  status: "queued";
};

@Injectable()
export class ApprovedActionExecutionService {
  private readonly executors: ReadonlyMap<
    ProposalActionType,
    ApprovedActionExecutor
  >;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(APPROVED_ACTION_EXECUTORS)
    executors?: ReadonlyMap<ProposalActionType, ApprovedActionExecutor>
  ) {
    this.executors = executors ?? new Map();
  }

  async execute(
    principal: AgentPrincipal,
    rawInput: AgentApprovedActionInput,
    client?: Prisma.TransactionClient
  ): Promise<AgentResult<ExecutionResult>> {
    const parsed = agentApprovedActionInputSchema.safeParse(rawInput);
    if (!parsed.success) return invalidInput();
    const input = parsed.data;
    const payloadHash = hashCanonicalJson({
      actionType: input.actionType,
      payload: input.payload,
    });
    const execute = (tx: Prisma.TransactionClient) =>
      this.executeInTransaction(tx, principal, input, payloadHash);
    return client
      ? execute(client)
      : this.prisma.$transaction(execute, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
  }

  private async executeInTransaction(
    tx: Prisma.TransactionClient,
    principal: AgentPrincipal,
    input: AgentApprovedActionInput,
    payloadHash: string
  ): Promise<AgentResult<ExecutionResult>> {
    const now = new Date();
    const grant = await tx.approvalGrant.findFirst({
      where: {
        id: input.grantId,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        status: "active",
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        proposal: { actionType: input.actionType, payloadHash },
      },
      select: {
        id: true,
        ownerId: true,
        clientId: true,
        proposalId: true,
        status: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        proposal: {
          select: { actionType: true, payloadHash: true, payload: true },
        },
      },
    });
    if (!isValidGrant(grant, principal, input, payloadHash, now)) {
      return invalidApproval();
    }

    const executor = this.executors.get(input.actionType);
    if (!executor) return unavailableAction();

    const claim = await tx.approvalGrant.updateMany({
      where: {
        id: grant.id,
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        status: "active",
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { status: "consumed", consumedAt: now },
    });
    if (claim.count !== 1) return invalidApproval();

    await executor.prepare(
      {
        principal,
        proposalId: grant.proposalId,
        actionType: input.actionType,
        payload: grant.proposal.payload,
      },
      tx
    );
    const outbox = await tx.actionOutbox.create({
      data: {
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        grantId: grant.id,
        status: "pending",
      },
      select: { id: true },
    });
    return {
      ok: true,
      data: { executionId: outbox.id, status: "queued" },
    };
  }
}

function isValidGrant(
  grant: {
    id: string;
    ownerId: string;
    clientId: string;
    status: string;
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
    proposal: {
      actionType: string;
      payloadHash: string;
      payload: Prisma.JsonValue;
    };
  } | null,
  principal: AgentPrincipal,
  input: AgentApprovedActionInput,
  payloadHash: string,
  now: Date
): boolean {
  if (
    !grant ||
    grant.ownerId !== principal.ownerId ||
    grant.clientId !== principal.clientId ||
    grant.status !== "active" ||
    grant.consumedAt !== null ||
    grant.revokedAt !== null ||
    grant.expiresAt <= now ||
    grant.proposal.actionType !== input.actionType ||
    grant.proposal.payloadHash !== payloadHash
  ) {
    return false;
  }
  return (
    hashCanonicalJson({
      actionType: grant.proposal.actionType,
      payload: grant.proposal.payload,
    }) === payloadHash
  );
}

function invalidInput(): AgentResult<ExecutionResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: "Invalid approved action input.",
      retryable: false,
    },
  };
}

function invalidApproval(): AgentResult<ExecutionResult> {
  return {
    ok: false,
    error: {
      code: "APPROVAL_INVALID",
      message: "Approval is invalid or no longer active.",
      retryable: false,
    },
  };
}

function unavailableAction(): AgentResult<ExecutionResult> {
  return {
    ok: false,
    error: {
      code: "ACTION_EXECUTION_UNAVAILABLE",
      message: "No approved executor is available for this action.",
      retryable: false,
    },
  };
}
