import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  CreateLocationAliasDto,
  UpdateLocationAliasDto,
} from "./location.dto.js";

const ALIAS_PURPOSE = "location-alias";
const EVENT_DETAILS_PURPOSE = "calendar-event-details";

type AliasRow = {
  id: string;
  ownerId: string;
  aliasMac: string;
  aliasCiphertext: Uint8Array;
  aliasIv: Uint8Array;
  aliasTag: Uint8Array;
  aliasKeyVersion: number;
  city: string;
  countryCode: string;
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
};

type CalendarEventDetails = {
  summary: string;
  locationText: string | null;
  selfResponseStatus:
    | "accepted"
    | "declined"
    | "tentative"
    | "needsAction"
    | null;
};

@Injectable()
export class LocationAliasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService
  ) {}

  async create(ownerId: string, input: CreateLocationAliasDto) {
    const display = displayAlias(input.alias);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await acquireOwnerLocationLock(transaction, ownerId);
        const id = randomUUID();
        const encrypted = this.cipher.encrypt(
          ALIAS_PURPOSE,
          ownerId,
          id,
          display
        );
        const row = (await transaction.locationAlias.create({
          data: {
            id,
            ownerId,
            aliasMac: this.index.mac(
              ALIAS_PURPOSE,
              ownerId,
              canonicalLocationAlias(input.alias)
            ),
            aliasCiphertext: encrypted.ciphertext as Uint8Array<ArrayBuffer>,
            aliasIv: encrypted.iv as Uint8Array<ArrayBuffer>,
            aliasTag: encrypted.tag as Uint8Array<ArrayBuffer>,
            aliasKeyVersion: encrypted.keyVersion,
            city: input.city.trim(),
            countryCode: input.countryCode,
            timeZone: input.timeZone,
          },
          select: aliasSelect,
        })) as AliasRow;
        await this.rebuildCalendarStaysInTransaction(ownerId, transaction);
        return presentAlias(row, display);
      });
    } catch (error) {
      if (isAliasDuplicate(error)) throw duplicateAlias();
      throw error;
    }
  }

  async list(ownerId: string) {
    const rows = (await this.prisma.locationAlias.findMany({
      where: { ownerId },
      orderBy: [{ city: "asc" }, { id: "asc" }],
      select: aliasSelect,
    })) as AliasRow[];
    return rows.map((row) =>
      presentAlias(row, this.decryptAlias(ownerId, row))
    );
  }

  async update(
    ownerId: string,
    aliasId: string,
    input: UpdateLocationAliasDto
  ) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await acquireOwnerLocationLock(transaction, ownerId);
        const current = (await transaction.locationAlias.findFirst({
          where: { id: aliasId, ownerId },
          select: aliasSelect,
        })) as AliasRow | null;
        if (!current) throw aliasNotFound();

        const currentDisplay = this.decryptAlias(ownerId, current);
        const display =
          input.alias === undefined
            ? currentDisplay
            : displayAlias(input.alias);
        const aliasEnvelope =
          input.alias === undefined
            ? undefined
            : this.cipher.encrypt(ALIAS_PURPOSE, ownerId, aliasId, display);
        const data = {
          ...(aliasEnvelope
            ? {
                aliasMac: this.index.mac(
                  ALIAS_PURPOSE,
                  ownerId,
                  canonicalLocationAlias(input.alias!)
                ),
                aliasCiphertext:
                  aliasEnvelope.ciphertext as Uint8Array<ArrayBuffer>,
                aliasIv: aliasEnvelope.iv as Uint8Array<ArrayBuffer>,
                aliasTag: aliasEnvelope.tag as Uint8Array<ArrayBuffer>,
                aliasKeyVersion: aliasEnvelope.keyVersion,
              }
            : {}),
          ...(input.city === undefined ? {} : { city: input.city.trim() }),
          ...(input.countryCode === undefined
            ? {}
            : { countryCode: input.countryCode }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        };
        const updated = await transaction.locationAlias.updateMany({
          where: {
            id: aliasId,
            ownerId,
            updatedAt: current.updatedAt,
          },
          data,
        });
        if (updated.count !== 1) throw aliasNotFound();
        const persisted = (await transaction.locationAlias.findFirst({
          where: { id: aliasId, ownerId },
          select: aliasSelect,
        })) as AliasRow | null;
        if (!persisted) throw aliasNotFound();
        await this.rebuildCalendarStaysInTransaction(ownerId, transaction);
        return presentAlias(persisted, display);
      });
    } catch (error) {
      if (isAliasDuplicate(error)) throw duplicateAlias();
      throw error;
    }
  }

  async remove(ownerId: string, aliasId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await acquireOwnerLocationLock(transaction, ownerId);
      const deleted = await transaction.locationAlias.deleteMany({
        where: { id: aliasId, ownerId },
      });
      if (deleted.count !== 1) throw aliasNotFound();
      await this.rebuildCalendarStaysInTransaction(ownerId, transaction);
    });
  }

  async rebuildCalendarStays(
    ownerId: string,
    transaction?: Prisma.TransactionClient
  ): Promise<void> {
    if (transaction) {
      await acquireOwnerLocationLock(transaction, ownerId);
      await this.rebuildCalendarStaysInTransaction(ownerId, transaction);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await acquireOwnerLocationLock(tx, ownerId);
      await this.rebuildCalendarStaysInTransaction(ownerId, tx);
    });
  }

  private async rebuildCalendarStaysInTransaction(
    ownerId: string,
    transaction: Prisma.TransactionClient
  ): Promise<void> {
    await transaction.cityStay.deleteMany({
      where: { ownerId, source: "calendar" },
    });
    const aliases = (await transaction.locationAlias.findMany({
      where: { ownerId },
      orderBy: { id: "asc" },
      select: {
        aliasMac: true,
        city: true,
        countryCode: true,
        timeZone: true,
      },
    })) as Pick<AliasRow, "aliasMac" | "city" | "countryCode" | "timeZone">[];
    const byMac = new Map(aliases.map((alias) => [alias.aliasMac, alias]));
    if (byMac.size === 0) return;

    const events = await transaction.calendarEvent.findMany({
      where: {
        ownerId,
        status: { not: "cancelled" },
        startAt: { not: null },
        endAt: { not: null },
        detailsCiphertext: { not: null },
        detailsIv: { not: null },
        detailsTag: { not: null },
        detailsKeyVersion: { not: null },
        source: {
          is: {
            ownerId,
            selected: true,
            connection: { status: "active" },
          },
        },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        ownerId: true,
        status: true,
        startAt: true,
        endAt: true,
        detailsCiphertext: true,
        detailsIv: true,
        detailsTag: true,
        detailsKeyVersion: true,
      },
    });
    const stays: Array<{
      ownerId: string;
      startsAt: Date;
      endsAt: Date;
      city: string;
      countryCode: string;
      timeZone: string;
      source: "calendar";
      sourceId: string;
      confidence: 1;
    }> = [];
    for (const event of events) {
      if (
        event.ownerId !== ownerId ||
        event.status === "cancelled" ||
        !event.startAt ||
        !event.endAt ||
        !event.detailsCiphertext ||
        !event.detailsIv ||
        !event.detailsTag ||
        !event.detailsKeyVersion
      ) {
        continue;
      }
      const details = this.cipher.decrypt<CalendarEventDetails>(
        EVENT_DETAILS_PURPOSE,
        ownerId,
        event.id,
        {
          ciphertext: Buffer.from(event.detailsCiphertext),
          iv: Buffer.from(event.detailsIv),
          tag: Buffer.from(event.detailsTag),
          keyVersion: event.detailsKeyVersion,
        }
      );
      if (
        details.selfResponseStatus === "declined" ||
        details.locationText === null
      ) {
        continue;
      }
      const mac = this.index.mac(
        ALIAS_PURPOSE,
        ownerId,
        canonicalLocationAlias(details.locationText)
      );
      const alias = byMac.get(mac);
      if (!alias) continue;
      stays.push({
        ownerId,
        startsAt: event.startAt,
        endsAt: event.endAt,
        city: alias.city,
        countryCode: alias.countryCode,
        timeZone: alias.timeZone,
        source: "calendar",
        sourceId: event.id,
        confidence: 1,
      });
    }
    if (stays.length > 0) {
      await transaction.cityStay.createMany({ data: stays });
    }
  }

  private decryptAlias(ownerId: string, row: AliasRow): string {
    return this.cipher.decrypt<string>(ALIAS_PURPOSE, ownerId, row.id, {
      ciphertext: Buffer.from(row.aliasCiphertext),
      iv: Buffer.from(row.aliasIv),
      tag: Buffer.from(row.aliasTag),
      keyVersion: row.aliasKeyVersion,
    });
  }
}

export function canonicalLocationAlias(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function displayAlias(value: string): string {
  return value.trim().normalize("NFC");
}

async function acquireOwnerLocationLock(
  transaction: Prisma.TransactionClient,
  ownerId: string
): Promise<void> {
  const lockKey = JSON.stringify([ownerId, "calendar-city-stays"]);
  await transaction.$queryRaw`
    SELECT 1::integer AS "acquired"
    FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    ) AS "location_calendar_stay_lock"
  `;
}

function presentAlias(row: AliasRow, alias: string) {
  return {
    id: row.id,
    alias,
    city: row.city,
    countryCode: row.countryCode,
    timeZone: row.timeZone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isAliasDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  return Array.isArray(target)
    ? target.includes("ownerId") && target.includes("aliasMac")
    : typeof target === "string" &&
        target.includes("ownerId") &&
        target.includes("aliasMac");
}

function duplicateAlias(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: "location_alias_exists",
    message: "Location alias already exists",
  });
}

function aliasNotFound(): NotFoundException {
  return new NotFoundException("Location alias not found");
}

const aliasSelect = {
  id: true,
  ownerId: true,
  aliasMac: true,
  aliasCiphertext: true,
  aliasIv: true,
  aliasTag: true,
  aliasKeyVersion: true,
  city: true,
  countryCode: true,
  timeZone: true,
  createdAt: true,
  updatedAt: true,
} as const;
