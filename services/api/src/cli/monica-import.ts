import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const postgres = pg as unknown as {
  Client: new (options: { connectionString: string }) => PgClient;
};

const EXPORT_FORMAT = "socos-monica-contacts";
const EXPORT_VERSION = 1;
const SOURCE_SYSTEM = "monica";
const EXPECTED_DEMO_COUNT = 7;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;

interface PgResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

interface PgClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<PgResult<Row>>;
}

export interface ImportContact {
  sourceId: string;
  firstName: string;
  lastName: string | null;
  middleName: string | null;
  nickname: string | null;
  company: string | null;
  jobTitle: string | null;
  labels: string[];
  groups: string[];
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
}

export interface ImportStore {
  connect(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  acquireImportLock(): Promise<void>;
  selectOwnerVault(expectedCount: number): Promise<{ ownerId: string; vaultId: string }>;
  prepareDemoBaseline(ownerId: string): Promise<void>;
  upsertContact(
    contact: ImportContact,
    ownerId: string,
    vaultId: string
  ): Promise<"created" | "updated">;
  assertFinalCounts(ownerId: string, expectedImported: number): Promise<void>;
}

export class ImportFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ImportFailure";
  }
}

function fail(code: string): never {
  throw new ImportFailure(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line);
    if (!isPlainObject(value)) fail("invalid_record");
    return value;
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    return fail("invalid_json");
  }
}

function nullableString(
  value: unknown,
  maxLength: number,
  code = "invalid_contact"
): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) fail(code);
  return value;
}

function requiredString(
  value: unknown,
  maxLength: number,
  code = "invalid_contact"
): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maxLength
  ) {
    fail(code);
  }
  return value;
}

function stringList(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    value.some((item) => typeof item !== "string" || item.length > 500)
  ) {
    fail("invalid_contact");
  }
  return [...new Set(value)].sort((left, right) => left.localeCompare(right));
}

function isoTimestamp(value: unknown): string {
  const timestamp = requiredString(value, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    fail("invalid_contact");
  }
  return new Date(timestamp).toISOString();
}

function parseContact(value: Record<string, unknown>): ImportContact {
  if (value.type !== "contact") fail("invalid_record_order");
  return {
    sourceId: requiredString(value.sourceId, 255),
    firstName: requiredString(value.firstName, 500),
    lastName: nullableString(value.lastName, 500),
    middleName: nullableString(value.middleName, 500),
    nickname: nullableString(value.nickname, 500),
    company: nullableString(value.company ?? null, 500),
    jobTitle: nullableString(value.jobTitle, 500),
    labels: stringList(value.labels),
    groups: stringList(value.groups),
    sourceCreatedAt: isoTimestamp(value.sourceCreatedAt),
    sourceUpdatedAt: isoTimestamp(value.sourceUpdatedAt),
  };
}

export function parseMonicaExport(
  input: string,
  expectedCount: number
): ImportContact[] {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
    fail("invalid_expected_count");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_STREAM_BYTES)
    fail("stream_too_large");

  const lines = input.split(/\r?\n/);
  while (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) fail("missing_header");

  const header = parseJsonLine(lines[0]);
  if (header.type !== "header" || header.format !== EXPORT_FORMAT)
    fail("invalid_header");
  if (header.version !== EXPORT_VERSION) fail("unsupported_version");
  if (lines.length < 2) fail("missing_trailer");

  const trailer = parseJsonLine(lines.at(-1) as string);
  if (trailer.type !== "trailer") fail("missing_trailer");

  const contactLines = lines.slice(1, -1);
  const contacts = contactLines.map((line) =>
    parseContact(parseJsonLine(line))
  );
  if (trailer.count !== contacts.length) fail("trailer_count_mismatch");
  if (contacts.length !== expectedCount) fail("expected_count_mismatch");

  const digest = createHash("sha256")
    .update(contactLines.map((line) => `${line}\n`).join(""))
    .digest("hex");
  if (typeof trailer.sha256 !== "string" || trailer.sha256 !== digest) {
    fail("checksum_mismatch");
  }

  const sourceIds = new Set<string>();
  for (const contact of contacts) {
    if (sourceIds.has(contact.sourceId)) fail("duplicate_source_id");
    sourceIds.add(contact.sourceId);
  }
  return contacts;
}

export interface ImportSummary {
  imported: number;
  created: number;
  updated: number;
  demos: number;
}

export async function runMonicaImport(
  input: string,
  expectedCount: number,
  store: ImportStore
): Promise<ImportSummary> {
  const contacts = parseMonicaExport(input, expectedCount);
  let connected = false;
  try {
    await store.connect();
    connected = true;
    return await store.transaction(async () => {
      await store.acquireImportLock();
      const { ownerId, vaultId } = await store.selectOwnerVault(expectedCount);
      await store.prepareDemoBaseline(ownerId);

      let created = 0;
      let updated = 0;
      for (const contact of contacts) {
        const outcome = await store.upsertContact(contact, ownerId, vaultId);
        if (outcome === "created") created += 1;
        else updated += 1;
      }
      await store.assertFinalCounts(ownerId, expectedCount);
      return {
        imported: contacts.length,
        created,
        updated,
        demos: EXPECTED_DEMO_COUNT,
      };
    });
  } finally {
    if (connected) await store.close();
  }
}

interface CountRow {
  imported: number;
  demos: number;
  baseline: number;
}

interface OwnerVaultStateRow extends CountRow {
  ownerId: string;
  vaultId: string;
}

export class PostgresImportStore implements ImportStore {
  private readonly client: PgClient;

  constructor(databaseUrl: string) {
    this.client = new postgres.Client({ connectionString: databaseUrl });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    await this.client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const result = await callback();
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }

  async acquireImportLock(): Promise<void> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtext('socos:monica-contact-import'))"
    );
  }

  async selectOwnerVault(
    expectedCount: number
  ): Promise<{ ownerId: string; vaultId: string }> {
    const result = await this.client.query<OwnerVaultStateRow>(
      `SELECT
         u."id" AS "ownerId",
         v."id" AS "vaultId",
         count(c."id") FILTER (
           WHERE c."sourceSystem" = $1 AND c."sourceId" IS NOT NULL AND NOT c."isDemo"
         )::int AS imported,
         count(c."id") FILTER (WHERE c."isDemo")::int AS demos,
         count(c."id") FILTER (
           WHERE c."sourceSystem" IS NULL AND c."sourceId" IS NULL AND NOT c."isDemo"
         )::int AS baseline
       FROM "User" u
       JOIN "Vault" v ON v."ownerId" = u."id"
       LEFT JOIN "Contact" c ON c."ownerId" = u."id" AND c."vaultId" = v."id"
       GROUP BY u."id", v."id", u."createdAt", v."createdAt"
       ORDER BY u."createdAt", v."createdAt"`,
      [SOURCE_SYSTEM]
    );

    const isFirstRun = (row: OwnerVaultStateRow) =>
      row.imported === 0 &&
      row.demos === 0 &&
      row.baseline === EXPECTED_DEMO_COUNT;
    const isCompleteRerun = (row: OwnerVaultStateRow) =>
      row.imported === expectedCount && row.demos === EXPECTED_DEMO_COUNT;

    if (result.rows.some((row) => row.imported > 0 && !isCompleteRerun(row))) {
      fail("owner_vault_state_mismatch");
    }
    const candidates = result.rows.filter(
      (row) => isFirstRun(row) || isCompleteRerun(row)
    );
    if (candidates.length !== 1) fail("owner_vault_count_mismatch");
    return candidates[0];
  }

  private async counts(ownerId: string): Promise<CountRow> {
    const result = await this.client.query<CountRow>(
      `SELECT
         count(*) FILTER (
           WHERE "sourceSystem" = $2 AND "sourceId" IS NOT NULL AND NOT "isDemo"
         )::int AS imported,
         count(*) FILTER (WHERE "isDemo")::int AS demos,
         count(*) FILTER (
           WHERE "sourceSystem" IS NULL AND "sourceId" IS NULL AND NOT "isDemo"
         )::int AS baseline
       FROM "Contact"
       WHERE "ownerId" = $1`,
      [ownerId, SOURCE_SYSTEM]
    );
    return result.rows[0];
  }

  async prepareDemoBaseline(ownerId: string): Promise<void> {
    const before = await this.counts(ownerId);
    if (before.imported === 0) {
      if (before.demos !== 0 || before.baseline !== EXPECTED_DEMO_COUNT) {
        fail("baseline_count_mismatch");
      }
      const updated = await this.client.query(
        `UPDATE "Contact"
            SET "isDemo" = true, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "ownerId" = $1
            AND "sourceSystem" IS NULL
            AND "sourceId" IS NULL
            AND NOT "isDemo"`,
        [ownerId]
      );
      if (updated.rowCount !== EXPECTED_DEMO_COUNT)
        fail("baseline_update_mismatch");
    } else if (before.demos !== EXPECTED_DEMO_COUNT) {
      fail("demo_count_mismatch");
    }
  }

  async upsertContact(
    contact: ImportContact,
    ownerId: string,
    vaultId: string
  ): Promise<"created" | "updated"> {
    const existing = await this.client.query(
      `SELECT 1 FROM "Contact"
        WHERE "ownerId" = $1 AND "sourceSystem" = $2 AND "sourceId" = $3`,
      [ownerId, SOURCE_SYSTEM, contact.sourceId]
    );
    await this.client.query(
      `INSERT INTO "Contact" (
         "id", "vaultId", "ownerId", "firstName", "lastName", "middleName",
         "nickname", "company", "jobTitle", "labels", "groups", "sourceSystem",
         "sourceId", "sourceUpdatedAt", "importedAt", "isDemo", "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14::timestamptz AT TIME ZONE 'UTC', CURRENT_TIMESTAMP, false,
         $15::timestamptz AT TIME ZONE 'UTC', CURRENT_TIMESTAMP
       )
       ON CONFLICT ("ownerId", "sourceSystem", "sourceId") DO UPDATE SET
         "vaultId" = EXCLUDED."vaultId",
         "firstName" = EXCLUDED."firstName",
         "lastName" = EXCLUDED."lastName",
         "middleName" = EXCLUDED."middleName",
         "nickname" = EXCLUDED."nickname",
         "company" = EXCLUDED."company",
         "jobTitle" = EXCLUDED."jobTitle",
         "labels" = EXCLUDED."labels",
         "groups" = EXCLUDED."groups",
         "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
         "importedAt" = CURRENT_TIMESTAMP,
         "isDemo" = false,
         "updatedAt" = CURRENT_TIMESTAMP`,
      [
        randomUUID(),
        vaultId,
        ownerId,
        contact.firstName,
        contact.lastName,
        contact.middleName,
        contact.nickname,
        contact.company,
        contact.jobTitle,
        contact.labels,
        contact.groups,
        SOURCE_SYSTEM,
        contact.sourceId,
        contact.sourceUpdatedAt,
        contact.sourceCreatedAt,
      ]
    );
    return existing.rows.length === 0 ? "created" : "updated";
  }

  async assertFinalCounts(
    ownerId: string,
    expectedImported: number
  ): Promise<void> {
    const after = await this.counts(ownerId);
    if (
      after.imported !== expectedImported ||
      after.demos !== EXPECTED_DEMO_COUNT
    ) {
      fail("final_count_mismatch");
    }
  }
}

function expectedCountFromArgs(args: string[]): number {
  const option = args.find((argument) =>
    argument.startsWith("--expected-count=")
  );
  if (!option || args.length !== 1) fail("invalid_arguments");
  const count = Number(option.slice("--expected-count=".length));
  if (!Number.isSafeInteger(count) || count < 1) fail("invalid_expected_count");
  return count;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_STREAM_BYTES) fail("stream_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function safeFailureCode(error: unknown): string {
  return error instanceof ImportFailure ? error.code : "import_failed";
}

async function main(): Promise<void> {
  try {
    const expectedCount = expectedCountFromArgs(process.argv.slice(2));
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) fail("database_url_missing");
    const summary = await runMonicaImport(
      await readStdin(),
      expectedCount,
      new PostgresImportStore(databaseUrl)
    );
    process.stdout.write(
      `import_status=complete imported=${summary.imported} created=${summary.created} updated=${summary.updated} demos=${summary.demos}\n`
    );
  } catch (error) {
    process.stderr.write(
      `import_status=failed code=${safeFailureCode(error)}\n`
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
