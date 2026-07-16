import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PreparedWatchStop } from "../calendar/calendar-watch.service.js";
import { CalendarWatchService } from "../calendar/calendar-watch.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PersonalDataIndexService } from "./personal-data-index.service.js";

const CONFIRMATION = "DELETE_PERSONAL_CONTEXT";
const CANONICAL_REQUEST = '{"confirmation":"DELETE_PERSONAL_CONTEXT"}';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const OWNER_PURPOSE = "deletion-audit-owner";
const IDEMPOTENCY_PURPOSE = "deletion-audit-idempotency-key";
const REQUEST_PURPOSE = "deletion-audit-request";
const OWNER_VALUE = "personal-context";
const CATEGORIES = ["calendar", "location", "event"] as const;
const SERIALIZATION_RETRY_LIMIT = 2;

export const PERSONAL_CONTEXT_DELETION_CLOCK = Symbol(
  "PERSONAL_CONTEXT_DELETION_CLOCK"
);

type PersonalContextCategory = (typeof CATEGORIES)[number];

export interface PersonalContextDeletionResponse {
  deletedAt: Date;
  categories: PersonalContextCategory[];
  rowCounts: Record<PersonalContextCategory, number>;
}

type AuditRow = {
  ownerMac: string;
  requestMac: string;
  categories: string[];
  calendarRowCount: number;
  locationRowCount: number;
  eventRowCount: number;
  deletedAt: Date;
};

type DeleteCount = { count: number };

@Injectable()
export class PersonalContextDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly index: PersonalDataIndexService,
    private readonly watches: CalendarWatchService,
    @Optional()
    @Inject(PERSONAL_CONTEXT_DELETION_CLOCK)
    private readonly clock: () => Date = () => new Date()
  ) {}

  async deletePersonalContext(
    ownerId: string,
    idempotencyKey: string,
    body: unknown
  ): Promise<PersonalContextDeletionResponse> {
    assertIdempotencyKey(idempotencyKey);
    assertConfirmationBody(body);

    const ownerMac = this.index.mac(OWNER_PURPOSE, ownerId, OWNER_VALUE);
    const idempotencyKeyMac = this.index.mac(
      IDEMPOTENCY_PURPOSE,
      ownerId,
      idempotencyKey
    );
    const requestMac = this.index.mac(
      REQUEST_PURPOSE,
      ownerId,
      CANONICAL_REQUEST
    );

    const existing = await this.readAudit(idempotencyKeyMac);
    if (existing) return this.replay(ownerId, existing);

    const now = this.clock();
    const prepared = await this.watches.prepareOwnerStops(ownerId, now);
    let attempt = 0;
    while (true) {
      try {
        const result = await this.prisma.$transaction(
          (tx) =>
            this.deleteInTransaction(tx, {
              ownerId,
              ownerMac,
              idempotencyKeyMac,
              requestMac,
              deletedAt: now,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        if (result.winner) {
          await this.stopPrepared(prepared, now);
        }
        return this.replay(ownerId, result.audit);
      } catch (error) {
        if (isUniqueOrSerializationConflict(error)) {
          const winner = await this.readAudit(idempotencyKeyMac);
          if (winner) return this.replay(ownerId, winner);
          if (isSerializationConflict(error) && attempt < SERIALIZATION_RETRY_LIMIT) {
            attempt += 1;
            continue;
          }
        }
        throw error;
      }
    }
  }

  private async deleteInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      ownerId: string;
      ownerMac: string;
      idempotencyKeyMac: string;
      requestMac: string;
      deletedAt: Date;
    }
  ): Promise<{ audit: AuditRow; winner: boolean }> {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "User" WHERE "id" = ${input.ownerId} FOR UPDATE`
    );
    const owner = await tx.user.findUnique({
      where: { id: input.ownerId },
      select: { id: true },
    });
    if (!owner) throw new NotFoundException("User not found");

    const existing = await tx.personalDataDeletionAudit.findUnique({
      where: { idempotencyKeyMac: input.idempotencyKeyMac },
    });
    if (existing) {
      return { audit: existing, winner: false };
    }

    const calendarRowCount = await this.deleteCalendarRows(tx, input.ownerId);
    const locationRowCount = await this.deleteLocationRows(tx, input.ownerId);
    const eventRowCount = await this.deleteEventRows(tx, input.ownerId);
    const audit = await tx.personalDataDeletionAudit.create({
      data: {
        ownerMac: input.ownerMac,
        idempotencyKeyMac: input.idempotencyKeyMac,
        requestMac: input.requestMac,
        categories: [...CATEGORIES],
        calendarRowCount,
        locationRowCount,
        eventRowCount,
        deletedAt: input.deletedAt,
      },
    });
    return { audit, winner: true };
  }

  private async deleteCalendarRows(
    tx: Prisma.TransactionClient,
    ownerId: string
  ): Promise<number> {
    return sumCounts([
      await tx.calendarEvent.deleteMany({ where: { ownerId } }),
      await tx.cityStay.deleteMany({ where: { ownerId } }),
      await tx.calendarWatch.deleteMany({ where: { ownerId } }),
      await tx.calendarSource.deleteMany({ where: { ownerId } }),
      await tx.googleCalendarConnection.deleteMany({ where: { ownerId } }),
      await tx.googleOAuthAttempt.deleteMany({ where: { ownerId } }),
    ]);
  }

  private async deleteLocationRows(
    tx: Prisma.TransactionClient,
    ownerId: string
  ): Promise<number> {
    return sumCounts([
      await tx.locationSample.deleteMany({ where: { ownerId } }),
      await tx.derivedVisit.deleteMany({ where: { ownerId } }),
      await tx.locationAlias.deleteMany({ where: { ownerId } }),
      await tx.locationDevice.deleteMany({ where: { ownerId } }),
    ]);
  }

  private async deleteEventRows(
    tx: Prisma.TransactionClient,
    ownerId: string
  ): Promise<number> {
    return sumCounts([
      await tx.briefFeedback.deleteMany({
        where: {
          ownerId,
          briefItem: { kind: "event" },
        },
      }),
      await tx.briefItem.deleteMany({
        where: { ownerId, kind: "event" },
      }),
      await tx.discoveredEvent.deleteMany({ where: { ownerId } }),
      await tx.eventSource.deleteMany({ where: { ownerId } }),
      await tx.eventPreference.deleteMany({ where: { ownerId } }),
    ]);
  }

  private async readAudit(idempotencyKeyMac: string): Promise<AuditRow | null> {
    return this.prisma.personalDataDeletionAudit.findUnique({
      where: { idempotencyKeyMac },
    });
  }

  private replay(
    ownerId: string,
    audit: AuditRow
  ): PersonalContextDeletionResponse {
    if (
      !this.index.verify(audit.ownerMac, OWNER_PURPOSE, ownerId, OWNER_VALUE) ||
      !this.index.verify(
        audit.requestMac,
        REQUEST_PURPOSE,
        ownerId,
        CANONICAL_REQUEST
      )
    ) {
      throw new ConflictException("Personal context deletion integrity conflict");
    }
    return {
      deletedAt: audit.deletedAt,
      categories: [...CATEGORIES],
      rowCounts: {
        calendar: audit.calendarRowCount,
        location: audit.locationRowCount,
        event: audit.eventRowCount,
      },
    };
  }

  private async stopPrepared(
    prepared: PreparedWatchStop[],
    now: Date
  ): Promise<void> {
    try {
      await this.watches.stopPreparedBestEffort(prepared, now);
    } catch {
      // Local deletion and audit have committed; remote channels expire if stop fails.
    }
  }
}

function sumCounts(results: DeleteCount[]): number {
  return results.reduce((total, result) => total + result.count, 0);
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException("Invalid Idempotency-Key");
  }
}

function assertConfirmationBody(
  value: unknown
): asserts value is { confirmation: typeof CONFIRMATION } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    (value as { confirmation?: unknown }).confirmation !== CONFIRMATION
  ) {
    throw new BadRequestException("Invalid confirmation");
  }
}

function isUniqueOrSerializationConflict(error: unknown): boolean {
  return isUniqueConflict(error) || isSerializationConflict(error);
}

function isUniqueConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function isSerializationConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2034"
  );
}
