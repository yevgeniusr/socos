import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AGENT_ERROR_CODES,
  AGENT_RISK_LEVELS,
  PROPOSAL_ACTION_TYPES,
} from "@socos/agent-core";
import type {
  AgentErrorCode,
  AgentPrincipal,
  AgentRiskLevel,
  ProposalActionType,
} from "@socos/agent-core";
import { PrismaService } from "../prisma/prisma.service.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const OUTCOMES = new Set<AgentAuditOutcome>([
  "succeeded",
  "rejected",
  "failed",
]);
const SAFE_METADATA_KEYS = new Set<keyof AgentAuditMetadata>([
  "errorCode",
  "riskLevel",
  "replayed",
  "attempt",
]);

export type AgentAuditOutcome = "succeeded" | "rejected" | "failed";

export interface AgentAuditMetadata {
  errorCode?: AgentErrorCode;
  riskLevel?: AgentRiskLevel;
  replayed?: boolean;
  attempt?: number;
}

export interface AgentAuditInput {
  operation: string;
  actionType?: ProposalActionType;
  resourceType?: string;
  resourceId?: string;
  outcome: AgentAuditOutcome;
  requestHash?: string;
  idempotencyKey?: string;
  metadata?: AgentAuditMetadata;
}

export interface AgentAuditReceipt {
  id: string;
  createdAt: Date;
}

type AuditClient = Pick<Prisma.TransactionClient, "mutationAuditEvent">;

@Injectable()
export class AgentAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    principal: AgentPrincipal,
    input: AgentAuditInput,
    client: AuditClient = this.prisma
  ): Promise<AgentAuditReceipt> {
    validateEvent(input);
    const metadata = validateMetadata(input.metadata ?? {});

    return client.mutationAuditEvent.create({
      data: {
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        operation: input.operation,
        actionType: input.actionType,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: input.outcome,
        requestHash: input.requestHash,
        idempotencyKey: input.idempotencyKey,
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });
  }
}

function validateEvent(input: AgentAuditInput): void {
  if (
    !OPERATION_PATTERN.test(input.operation) ||
    !OUTCOMES.has(input.outcome)
  ) {
    throw invalidAuditEvent();
  }
  if (
    input.actionType !== undefined &&
    !PROPOSAL_ACTION_TYPES.includes(input.actionType)
  ) {
    throw invalidAuditEvent();
  }
  if (
    (input.resourceType !== undefined &&
      !IDENTIFIER_PATTERN.test(input.resourceType)) ||
    (input.resourceId !== undefined &&
      !IDENTIFIER_PATTERN.test(input.resourceId)) ||
    (input.requestHash !== undefined &&
      !HASH_PATTERN.test(input.requestHash)) ||
    (input.idempotencyKey !== undefined &&
      !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey))
  ) {
    throw invalidAuditEvent();
  }
}

function validateMetadata(metadata: AgentAuditMetadata): AgentAuditMetadata {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    Object.keys(metadata).some(
      (key) => !SAFE_METADATA_KEYS.has(key as keyof AgentAuditMetadata)
    )
  ) {
    throw unsafeMetadata();
  }
  if (
    (metadata.errorCode !== undefined &&
      !AGENT_ERROR_CODES.includes(metadata.errorCode)) ||
    (metadata.riskLevel !== undefined &&
      !AGENT_RISK_LEVELS.includes(metadata.riskLevel)) ||
    (metadata.replayed !== undefined &&
      typeof metadata.replayed !== "boolean") ||
    (metadata.attempt !== undefined &&
      (!Number.isSafeInteger(metadata.attempt) || metadata.attempt < 0))
  ) {
    throw unsafeMetadata();
  }
  return { ...metadata };
}

function invalidAuditEvent(): Error {
  return new Error("Invalid agent audit event");
}

function unsafeMetadata(): Error {
  return new Error("Unsafe agent audit metadata");
}
