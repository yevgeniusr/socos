import { Prisma, PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import {
  PERSONAL_DATA_ENVELOPES,
  type PersonalDataEnvelopeDefinition,
} from "../modules/personal-data/personal-data-envelope.registry.js";
import {
  PersonalDataCipherService,
  type EncryptedValue,
} from "../modules/personal-data/personal-data-cipher.service.js";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export type RekeyArguments = {
  from: number;
  to: number;
  batchSize: number;
  dryRun: boolean;
};

export type PersonalDataEnvelopeRow = EncryptedValue & {
  id: string;
  ownerId: string;
};

type RawPersonalDataEnvelopeRow = Omit<
  PersonalDataEnvelopeRow,
  "ciphertext" | "iv" | "tag"
> & {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
};

export interface PersonalDataRekeyTransaction {
  findPage(
    envelope: PersonalDataEnvelopeDefinition,
    from: number,
    afterId: string | undefined,
    take: number
  ): Promise<PersonalDataEnvelopeRow[]>;
  compareAndSet(
    envelope: PersonalDataEnvelopeDefinition,
    id: string,
    oldVersion: number,
    replacement: EncryptedValue
  ): Promise<boolean>;
}

export interface PersonalDataRekeyStore {
  count(
    envelope: PersonalDataEnvelopeDefinition,
    from: number
  ): Promise<number>;
  transaction<T>(
    callback: (transaction: PersonalDataRekeyTransaction) => Promise<T>
  ): Promise<T>;
  close(): Promise<void>;
}

export type RekeySummary = {
  scanned: number;
  rekeyed: number;
  contended: number;
};

class RekeyFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function parseRekeyArguments(args: string[]): RekeyArguments {
  const values = new Map<string, string>();
  let dryRun = false;

  for (const argument of args) {
    if (argument === "--dry-run") {
      if (dryRun) throw new RekeyFailure("invalid_arguments");
      dryRun = true;
      continue;
    }
    const match = /^(--from|--to|--batch-size)=([0-9]+)$/.exec(argument);
    if (!match || values.has(match[1])) {
      throw new RekeyFailure("invalid_arguments");
    }
    values.set(match[1], match[2]);
  }

  if (!values.has("--from") || !values.has("--to")) {
    throw new RekeyFailure("invalid_arguments");
  }
  const from = Number(values.get("--from"));
  const to = Number(values.get("--to"));
  const batchSize = values.has("--batch-size")
    ? Number(values.get("--batch-size"))
    : DEFAULT_BATCH_SIZE;
  if (
    !isPositiveInteger(from) ||
    !isPositiveInteger(to) ||
    from === to ||
    !isPositiveInteger(batchSize) ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new RekeyFailure("invalid_arguments");
  }
  return { from, to, batchSize, dryRun };
}

export async function runPersonalDataRekey(
  args: RekeyArguments,
  store: PersonalDataRekeyStore,
  cipher: PersonalDataCipherService,
  emit: (line: string) => void = () => undefined
): Promise<RekeySummary> {
  const total: RekeySummary = { scanned: 0, rekeyed: 0, contended: 0 };
  try {
    try {
      cipher.validateRekeyVersions(args.from, args.to);
    } catch {
      throw new RekeyFailure("invalid_key_versions");
    }

    for (const envelope of PERSONAL_DATA_ENVELOPES) {
      const summary: RekeySummary = {
        scanned: 0,
        rekeyed: 0,
        contended: 0,
      };
      if (args.dryRun) {
        summary.scanned = await store.count(envelope, args.from);
      } else {
        let afterId: string | undefined;
        while (true) {
          const page = await store.transaction(async (transaction) => {
            const rows = await transaction.findPage(
              envelope,
              args.from,
              afterId,
              args.batchSize
            );
            let rekeyed = 0;
            for (const row of rows) {
              const replacement = cipher.reencryptToVersion(
                envelope.purpose,
                row.ownerId,
                row.id,
                row,
                args.to
              );
              if (
                await transaction.compareAndSet(
                  envelope,
                  row.id,
                  args.from,
                  replacement
                )
              ) {
                rekeyed += 1;
              }
            }
            return { rows, rekeyed };
          });

          summary.scanned += page.rows.length;
          summary.rekeyed += page.rekeyed;
          summary.contended += page.rows.length - page.rekeyed;
          if (page.rows.length < args.batchSize) break;
          afterId = page.rows.at(-1)!.id;
        }
      }

      total.scanned += summary.scanned;
      total.rekeyed += summary.rekeyed;
      total.contended += summary.contended;
      emit(summaryLine(envelope, summary));
    }
    emit(
      `registry=personal-data model=aggregate envelope=aggregate scanned=${total.scanned} rekeyed=${total.rekeyed} contended=${total.contended}`
    );
    return total;
  } finally {
    await store.close();
  }
}

export class PrismaPersonalDataRekeyStore implements PersonalDataRekeyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async count(
    envelope: PersonalDataEnvelopeDefinition,
    from: number
  ): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int AS "count" FROM ${identifier(
        envelope.table
      )} WHERE ${identifier(envelope.keyVersionColumn)} = $1`,
      from
    );
    return rows[0]?.count ?? 0;
  }

  async transaction<T>(
    callback: (transaction: PersonalDataRekeyTransaction) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction((prisma) =>
      callback(new PrismaPersonalDataRekeyTransaction(prisma))
    );
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

class PrismaPersonalDataRekeyTransaction implements PersonalDataRekeyTransaction {
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  async findPage(
    envelope: PersonalDataEnvelopeDefinition,
    from: number,
    afterId: string | undefined,
    take: number
  ): Promise<PersonalDataEnvelopeRow[]> {
    const table = identifier(envelope.table);
    const version = identifier(envelope.keyVersionColumn);
    const cursor =
      afterId === undefined ? "" : ` AND (${version}, "id") > ($1, $2)`;
    const limitParameter = afterId === undefined ? "$2" : "$3";
    const query = `SELECT "id", "ownerId", ${identifier(
      envelope.ciphertextColumn
    )} AS "ciphertext", ${identifier(
      envelope.ivColumn
    )} AS "iv", ${identifier(envelope.tagColumn)} AS "tag", ${version} AS "keyVersion"
      FROM ${table}
      WHERE ${version} = $1${cursor}
      ORDER BY ${version}, "id"
      LIMIT ${limitParameter}`;
    const parameters =
      afterId === undefined ? [from, take] : [from, afterId, take];
    const rows = await this.prisma.$queryRawUnsafe<
      RawPersonalDataEnvelopeRow[]
    >(query, ...parameters);
    return rows.map((row) => ({
      ...row,
      ciphertext: Buffer.from(row.ciphertext),
      iv: Buffer.from(row.iv),
      tag: Buffer.from(row.tag),
    }));
  }

  async compareAndSet(
    envelope: PersonalDataEnvelopeDefinition,
    id: string,
    oldVersion: number,
    replacement: EncryptedValue
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRawUnsafe(
      `UPDATE ${identifier(envelope.table)}
       SET ${identifier(envelope.ciphertextColumn)} = $1,
           ${identifier(envelope.ivColumn)} = $2,
           ${identifier(envelope.tagColumn)} = $3,
           ${identifier(envelope.keyVersionColumn)} = $4
       WHERE "id" = $5 AND ${identifier(envelope.keyVersionColumn)} = $6`,
      replacement.ciphertext,
      replacement.iv,
      replacement.tag,
      replacement.keyVersion,
      id,
      oldVersion
    );
    return updated === 1;
  }
}

function summaryLine(
  envelope: PersonalDataEnvelopeDefinition,
  summary: RekeySummary
): string {
  return `registry=personal-data model=${envelope.model} envelope=${envelope.name} scanned=${summary.scanned} rekeyed=${summary.rekeyed} contended=${summary.contended}`;
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function safeRekeyFailureCode(error: unknown): string {
  return error instanceof RekeyFailure ? error.code : "rekey_failed";
}

async function main(): Promise<void> {
  try {
    const args = parseRekeyArguments(process.argv.slice(2));
    const cipher = new PersonalDataCipherService(new ConfigService());
    await runPersonalDataRekey(
      args,
      new PrismaPersonalDataRekeyStore(new PrismaClient()),
      cipher,
      (line) => process.stdout.write(`${line}\n`)
    );
  } catch (error) {
    process.stderr.write(
      `registry=personal-data model=aggregate envelope=aggregate error=${safeRekeyFailureCode(
        error
      )}\n`
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
