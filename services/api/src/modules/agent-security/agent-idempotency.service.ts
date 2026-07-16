import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AgentPrincipal,
  AgentPublicError,
  AgentResult,
} from "@socos/agent-core";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashCanonicalJson } from "./canonical-json.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;

export interface AgentIdempotencyOptions {
  ttlMs?: number;
}

@Injectable()
export class AgentIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T extends Prisma.JsonValue>(
    principal: AgentPrincipal,
    operation: string,
    idempotencyKey: string,
    request: Prisma.JsonValue,
    execute: (transaction: Prisma.TransactionClient) => Promise<AgentResult<T>>,
    options: AgentIdempotencyOptions = {}
  ): Promise<AgentResult<T>> {
    const invalidInput = validateInput(
      operation,
      idempotencyKey,
      options.ttlMs
    );
    if (invalidInput) return failure(invalidInput);

    let requestHash: string;
    try {
      requestHash = hashCanonicalJson(request);
    } catch {
      return failure({
        code: "INVALID_INPUT",
        message: "Request must be canonical JSON.",
        retryable: false,
      });
    }

    const lockKey = hashCanonicalJson([
      principal.clientId,
      operation,
      idempotencyKey,
    ]);

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT 1::integer AS "acquired"
            FROM (
              SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
            ) AS "agent_idempotency_lock"
          `;
          const transactionNow = new Date();

          let existing = await transaction.agentIdempotencyRecord.findUnique({
            where: {
              clientId_operation_idempotencyKey: {
                clientId: principal.clientId,
                operation,
                idempotencyKey,
              },
            },
            select: {
              id: true,
              ownerId: true,
              clientId: true,
              requestHash: true,
              status: true,
              response: true,
              expiresAt: true,
            },
          });

          if (
            existing &&
            (existing.ownerId !== principal.ownerId ||
              existing.clientId !== principal.clientId)
          ) {
            return idempotencyConflict<T>(false);
          }

          if (existing?.expiresAt <= transactionNow) {
            const deleted = await transaction.agentIdempotencyRecord.deleteMany(
              {
                where: {
                  id: existing.id,
                  ownerId: principal.ownerId,
                  clientId: principal.clientId,
                  expiresAt: { lte: transactionNow },
                },
              }
            );
            if (deleted.count !== 1) return idempotencyConflict<T>(true);
            existing = null;
          }

          if (existing) {
            if (existing.requestHash !== requestHash) {
              return idempotencyConflict<T>(false);
            }
            if (
              (existing.status === "completed" ||
                existing.status === "failed") &&
              existing.response !== null
            ) {
              return existing.response as unknown as AgentResult<T>;
            }
            return inProgressConflict<T>();
          }

          const reservation = await transaction.agentIdempotencyRecord.create({
            data: {
              ownerId: principal.ownerId,
              clientId: principal.clientId,
              operation,
              idempotencyKey,
              requestHash,
              status: "in_progress",
              expiresAt: new Date(
                transactionNow.getTime() + (options.ttlMs ?? DEFAULT_TTL_MS)
              ),
            },
            select: { id: true },
          });

          const response = await execute(transaction);
          hashCanonicalJson(response);
          await transaction.agentIdempotencyRecord.update({
            where: { id: reservation.id },
            data: {
              status: "completed",
              response: response as unknown as Prisma.InputJsonValue,
            },
          });
          return response;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (isPersistenceConflict(error)) return inProgressConflict<T>();
      throw error;
    }
  }
}

function validateInput(
  operation: string,
  idempotencyKey: string,
  ttlMs: number | undefined
): AgentPublicError | null {
  if (!OPERATION_PATTERN.test(operation)) {
    return {
      code: "INVALID_INPUT",
      message: "Invalid agent operation.",
      retryable: false,
    };
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return {
      code: "INVALID_INPUT",
      message: "Invalid idempotency key.",
      retryable: false,
    };
  }
  if (
    ttlMs !== undefined &&
    (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > DEFAULT_TTL_MS)
  ) {
    return {
      code: "INVALID_INPUT",
      message: "Invalid idempotency expiry.",
      retryable: false,
    };
  }
  return null;
}

function idempotencyConflict<T extends Prisma.JsonValue>(
  retryable: boolean
): AgentResult<T> {
  return failure({
    code: "IDEMPOTENCY_CONFLICT",
    message: "Idempotency key conflicts with an existing request.",
    retryable,
  });
}

function inProgressConflict<T extends Prisma.JsonValue>(): AgentResult<T> {
  return failure({
    code: "IDEMPOTENCY_CONFLICT",
    message: "Idempotent operation is still in progress.",
    retryable: true,
  });
}

function failure<T>(error: AgentPublicError): AgentResult<T> {
  return { ok: false, error };
}

function isPersistenceConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002" || code === "P2034";
}
