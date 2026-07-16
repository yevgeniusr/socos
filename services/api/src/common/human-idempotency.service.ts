import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hashCanonicalJson } from "../modules/agent-security/canonical-json.js";
import { PrismaService } from "../modules/prisma/prisma.service.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_TRANSACTION_ATTEMPTS = 3;
const CLEANUP_BATCH_SIZE = 25;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;

export interface HumanIdempotencyResult<T> {
  value: T;
  replayed: boolean;
}

@Injectable()
export class HumanIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    ownerId: string,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    execute: (transaction: Prisma.TransactionClient) => Promise<T>
  ): Promise<HumanIdempotencyResult<T>> {
    if (
      !OPERATION_PATTERN.test(operation) ||
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    ) {
      throw new BadRequestException("Invalid idempotency key.");
    }

    let requestHash: string;
    try {
      requestHash = hashCanonicalJson(normalizeJson(request));
    } catch {
      throw new BadRequestException("Request must be canonical JSON.");
    }
    const lockKey = hashCanonicalJson([ownerId, operation, idempotencyKey]);

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.executeInTransaction(
          ownerId,
          operation,
          idempotencyKey,
          requestHash,
          lockKey,
          execute
        );
      } catch (error) {
        if (!isPersistenceConflict(error)) throw error;
        if (attempt === MAX_TRANSACTION_ATTEMPTS) throw idempotencyConflict();
      }
    }
    throw idempotencyConflict();
  }

  private executeInTransaction<T>(
    ownerId: string,
    operation: string,
    idempotencyKey: string,
    requestHash: string,
    lockKey: string,
    execute: (transaction: Prisma.TransactionClient) => Promise<T>
  ): Promise<HumanIdempotencyResult<T>> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
            SELECT 1::integer AS "acquired"
            FROM (
              SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
            ) AS "human_idempotency_lock"
          `;
        const now = new Date();
        await transaction.$executeRaw`
            DELETE FROM "HumanIdempotencyRecord"
             WHERE "id" IN (
               SELECT "id"
                 FROM "HumanIdempotencyRecord"
                WHERE "ownerId" = ${ownerId}
                  AND "expiresAt" <= ${now}
                  AND NOT (
                    "operation" = ${operation}
                    AND "idempotencyKey" = ${idempotencyKey}
                  )
                ORDER BY "expiresAt" ASC, "id" ASC
                LIMIT ${CLEANUP_BATCH_SIZE}
             )
          `;
        let existing = await transaction.humanIdempotencyRecord.findUnique({
          where: {
            ownerId_operation_idempotencyKey: {
              ownerId,
              operation,
              idempotencyKey,
            },
          },
          select: {
            id: true,
            ownerId: true,
            requestHash: true,
            status: true,
            response: true,
            expiresAt: true,
          },
        });

        if (existing?.expiresAt <= now) {
          const deleted = await transaction.humanIdempotencyRecord.deleteMany({
            where: { id: existing.id, ownerId, expiresAt: { lte: now } },
          });
          if (deleted.count !== 1) throw idempotencyConflict();
          existing = null;
        }
        if (existing) {
          if (
            existing.ownerId !== ownerId ||
            existing.requestHash !== requestHash ||
            existing.status !== "completed" ||
            existing.response === null
          ) {
            throw idempotencyConflict();
          }
          return { value: existing.response as T, replayed: true };
        }

        const reservation = await transaction.humanIdempotencyRecord.create({
          data: {
            ownerId,
            operation,
            idempotencyKey,
            requestHash,
            status: "in_progress",
            expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS),
          },
          select: { id: true },
        });
        const value = normalizeJson(await execute(transaction)) as T;
        await transaction.humanIdempotencyRecord.update({
          where: { id: reservation.id },
          data: {
            status: "completed",
            response: value as Prisma.InputJsonValue,
          },
        });
        return { value, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }
}

function normalizeJson(value: unknown): Prisma.JsonValue {
  const normalized = JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
  hashCanonicalJson(normalized);
  return normalized;
}

function idempotencyConflict(): ConflictException {
  return new ConflictException(
    "Idempotency key conflicts with an existing request."
  );
}

function isPersistenceConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002" || code === "P2034";
}
