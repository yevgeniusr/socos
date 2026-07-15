import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  ImportFailure,
  PostgresImportStore,
  runMonicaImport,
  type ImportContact,
} from "./monica-import";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

function exportStream(contacts: ImportContact[]): string {
  const lines = contacts.map((contact) =>
    JSON.stringify({ type: "contact", ...contact })
  );
  const digest = createHash("sha256")
    .update(lines.map((line) => `${line}\n`).join(""))
    .digest("hex");
  return [
    JSON.stringify({
      type: "header",
      format: "socos-monica-contacts",
      version: 1,
    }),
    ...lines,
    JSON.stringify({ type: "trailer", count: contacts.length, sha256: digest }),
    "",
  ].join("\n");
}

const contacts: ImportContact[] = [
  {
    sourceId: "integration-source-1",
    firstName: "Synthetic One",
    lastName: null,
    middleName: null,
    nickname: null,
    company: "Synthetic Company",
    jobTitle: null,
    labels: ["Synthetic Label"],
    groups: ["Synthetic Group"],
    sourceCreatedAt: "2026-01-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    sourceId: "integration-source-2",
    firstName: "Synthetic Two",
    lastName: "Example",
    middleName: null,
    nickname: null,
    company: null,
    jobTitle: "Builder",
    labels: [],
    groups: [],
    sourceCreatedAt: "2026-01-03T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-04T00:00:00.000Z",
  },
];

describeWithPostgres("Postgres Monica import integration", () => {
  const baseUrl = new URL(
    databaseUrl ??
      "postgresql://unused:unused@127.0.0.1/socos_migration_test_skipped"
  );
  const databaseName = baseUrl.pathname.slice(1);
  if (!/^socos_migration_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("import integration refuses a non-test database");
  }

  const schema = `socos_import_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = new URL(baseUrl);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
  const admin = new pg.Client({ connectionString: baseUrl.toString() });

  async function withClient<T>(
    callback: (client: pg.Client) => Promise<T>
  ): Promise<T> {
    const client = new pg.Client({ connectionString: scopedUrl.toString() });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  async function resetData(): Promise<void> {
    await withClient(async (client) => {
      await client.query('TRUNCATE "Contact", "Vault", "User"');
      await client.query(
        `INSERT INTO "User" ("id", "createdAt") VALUES
           ('integration-owner', CURRENT_TIMESTAMP),
           ('empty-owner', CURRENT_TIMESTAMP + INTERVAL '1 second');
         INSERT INTO "Vault" ("id", "ownerId", "createdAt") VALUES
           ('integration-vault', 'integration-owner', CURRENT_TIMESTAMP),
           ('empty-vault', 'empty-owner', CURRENT_TIMESTAMP + INTERVAL '1 second');`
      );
      for (let index = 0; index < 7; index += 1) {
        await client.query(
          `INSERT INTO "Contact" (
             "id", "vaultId", "ownerId", "firstName", "updatedAt"
           ) VALUES ($1, 'integration-vault', 'integration-owner', $2, CURRENT_TIMESTAMP)`,
          [`baseline-${index}`, `Synthetic Baseline ${index}`]
        );
      }
    });
  }

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await withClient(async (client) => {
      await client.query(`
        CREATE TABLE "User" (
          "id" TEXT PRIMARY KEY,
          "createdAt" TIMESTAMP(3) NOT NULL
        );
        CREATE TABLE "Vault" (
          "id" TEXT PRIMARY KEY,
          "ownerId" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL
        );
        CREATE TABLE "Contact" (
          "id" TEXT PRIMARY KEY,
          "vaultId" TEXT NOT NULL,
          "ownerId" TEXT NOT NULL,
          "firstName" TEXT NOT NULL,
          "lastName" TEXT,
          "middleName" TEXT,
          "nickname" TEXT,
          "company" TEXT,
          "jobTitle" TEXT,
          "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "groups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "sourceSystem" TEXT,
          "sourceId" TEXT,
          "sourceUpdatedAt" TIMESTAMP(3),
          "importedAt" TIMESTAMP(3),
          "isDemo" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          UNIQUE ("ownerId", "sourceSystem", "sourceId")
        );
      `);
    });
  });

  beforeEach(resetData);

  afterAll(async () => {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });

  it("selects the populated owner, marks demos, and is idempotent", async () => {
    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new PostgresImportStore(scopedUrl.toString())
      )
    ).resolves.toMatchObject({ created: 2, updated: 0, demos: 7 });
    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new PostgresImportStore(scopedUrl.toString())
      )
    ).resolves.toMatchObject({ created: 0, updated: 2, demos: 7 });

    await withClient(async (client) => {
      const result = await client.query(
        `SELECT
           count(*) FILTER (WHERE "isDemo")::int AS demos,
           count(*) FILTER (WHERE "sourceSystem" = 'monica')::int AS imported,
           count(DISTINCT "sourceId") FILTER (WHERE "sourceSystem" = 'monica')::int AS sources
         FROM "Contact"`
      );
      expect(result.rows[0]).toEqual({ demos: 7, imported: 2, sources: 2 });
    });
  });

  it("rolls back demo marking and inserted contacts after a database-step failure", async () => {
    class FailingStore extends PostgresImportStore {
      private writes = 0;

      override async upsertContact(
        contact: ImportContact,
        ownerId: string,
        vaultId: string
      ): Promise<"created" | "updated"> {
        this.writes += 1;
        if (this.writes === 2)
          throw new ImportFailure("synthetic_write_failure");
        return super.upsertContact(contact, ownerId, vaultId);
      }
    }

    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new FailingStore(scopedUrl.toString())
      )
    ).rejects.toMatchObject({ code: "synthetic_write_failure" });

    await withClient(async (client) => {
      const result = await client.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE "isDemo")::int AS demos,
           count(*) FILTER (WHERE "sourceSystem" = 'monica')::int AS imported
         FROM "Contact"`
      );
      expect(result.rows[0]).toEqual({ total: 7, demos: 0, imported: 0 });
    });
  });

  it("rejects a partial imported candidate even when another first-run candidate is valid", async () => {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO "Contact" (
           "id", "vaultId", "ownerId", "firstName", "sourceSystem", "sourceId", "isDemo", "updatedAt"
         ) VALUES (
           'partial-import', 'empty-vault', 'empty-owner', 'Synthetic Partial',
           'monica', 'partial-source', false, CURRENT_TIMESTAMP
         )`
      );
    });

    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new PostgresImportStore(scopedUrl.toString())
      )
    ).rejects.toMatchObject({ code: "owner_vault_state_mismatch" });

    await withClient(async (client) => {
      const result = await client.query(
        `SELECT count(*) FILTER (WHERE "isDemo")::int AS demos FROM "Contact"`
      );
      expect(result.rows[0]).toEqual({ demos: 0 });
    });
  });

  it("rejects competing exact first-run candidates", async () => {
    await withClient(async (client) => {
      for (let index = 0; index < 7; index += 1) {
        await client.query(
          `INSERT INTO "Contact" (
             "id", "vaultId", "ownerId", "firstName", "updatedAt"
           ) VALUES ($1, 'empty-vault', 'empty-owner', $2, CURRENT_TIMESTAMP)`,
          [`competing-${index}`, `Synthetic Competing ${index}`]
        );
      }
    });

    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new PostgresImportStore(scopedUrl.toString())
      )
    ).rejects.toMatchObject({ code: "owner_vault_count_mismatch" });
  });

  it("allows a complete rerun after a new native contact is added", async () => {
    await runMonicaImport(
      exportStream(contacts),
      contacts.length,
      new PostgresImportStore(scopedUrl.toString())
    );
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO "Contact" (
           "id", "vaultId", "ownerId", "firstName", "updatedAt"
         ) VALUES (
           'native-after-import', 'integration-vault', 'integration-owner',
           'Synthetic Native', CURRENT_TIMESTAMP
         )`
      );
    });

    await expect(
      runMonicaImport(
        exportStream(contacts),
        contacts.length,
        new PostgresImportStore(scopedUrl.toString())
      )
    ).resolves.toMatchObject({ created: 0, updated: 2, demos: 7 });
  });
});
