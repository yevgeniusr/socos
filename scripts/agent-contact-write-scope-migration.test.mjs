import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const migrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260719093000_hermes_enrichment_contact_write_scope/migration.sql",
);
const previousMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260719084500_agent_contact_write_scope/migration.sql",
);
const databaseUrl = process.env.TEST_DATABASE_URL;

const migrationSql = readFileSync(migrationPath, "utf8");
const previousMigrationSql = readFileSync(previousMigrationPath, "utf8");

test("documents why a forward Hermes Enrichment scope migration exists", () => {
  assert.match(previousMigrationSql, /"name"\s*=\s*'Hermes'/);
  assert.doesNotMatch(previousMigrationSql, /Hermes Enrichment/);
  assert.match(migrationSql, /20260719084500_agent_contact_write_scope/);
  assert.match(migrationSql, /Hermes Enrichment/);
  assert.match(migrationSql, /forward-only/i);
});

test("targets only active non-revoked exact Hermes Enrichment clients idempotently", () => {
  assert.equal(migrationSql.match(/UPDATE\s+"AgentClient"/gi)?.length, 1);
  assert.match(migrationSql, /SET[\s\S]*array_append\("scopes", 'contacts:write'\)/);
  assert.match(migrationSql, /WHERE[\s\S]*"name"\s*=\s*'Hermes Enrichment'/);
  assert.match(migrationSql, /WHERE[\s\S]*"status"\s*=\s*'active'/);
  assert.match(migrationSql, /WHERE[\s\S]*"revokedAt"\s+IS\s+NULL/);
  assert.match(
    migrationSql,
    /WHERE[\s\S]*NOT\s+\('contacts:write'\s*=\s*ANY\("scopes"\)\)/,
  );
  assert.doesNotMatch(migrationSql, /\bILIKE\b|\bLIKE\b/);
  assert.doesNotMatch(migrationSql, /"name"\s+IN\s*\(/);
  assert.doesNotMatch(migrationSql, /"status"\s*<>\s*'revoked'/);
});

test("PostgreSQL contract grants only the exact active non-revoked client", async (t) => {
  if (!databaseUrl) {
    t.skip("set TEST_DATABASE_URL to exercise the migration against PostgreSQL");
    return;
  }

  const parsedUrl = new URL(databaseUrl);
  assert.match(
    basename(parsedUrl.pathname),
    /^socos_agent_scope_contract_[a-z0-9_]*_test$/,
    "scope migration contract must use a throwaway test database",
  );

  const requireFromApi = createRequire(resolve(root, "services/api/package.json"));
  const { Client } = requireFromApi("pg");
  const schemaName = `agent_scope_contract_${process.pid}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}"`);
    await client.query(`
      CREATE TABLE "AgentClient" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "scopes" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "status" text NOT NULL DEFAULT 'active',
        "revokedAt" timestamp without time zone,
        "updatedAt" timestamp without time zone NOT NULL
      )
    `);
    await client.query(`
      INSERT INTO "AgentClient" ("id", "name", "scopes", "status", "revokedAt", "updatedAt")
      VALUES
        ('target', 'Hermes Enrichment', ARRAY['contacts:read'], 'active', NULL, TIMESTAMP '2026-07-19 08:45:00'),
        ('already-granted', 'Hermes Enrichment', ARRAY['contacts:read', 'contacts:write'], 'active', NULL, TIMESTAMP '2026-07-19 08:45:00'),
        ('revoked-status', 'Hermes Enrichment', ARRAY['contacts:read'], 'revoked', TIMESTAMP '2026-07-19 08:50:00', TIMESTAMP '2026-07-19 08:45:00'),
        ('revoked-at', 'Hermes Enrichment', ARRAY['contacts:read'], 'active', TIMESTAMP '2026-07-19 08:50:00', TIMESTAMP '2026-07-19 08:45:00'),
        ('old-hermes', 'Hermes', ARRAY['contacts:read'], 'active', NULL, TIMESTAMP '2026-07-19 08:45:00'),
        ('case-mismatch', 'hermes enrichment', ARRAY['contacts:read'], 'active', NULL, TIMESTAMP '2026-07-19 08:45:00')
    `);

    await client.query(migrationSql);
    const afterFirst = await client.query(
      `SELECT "id", "scopes", "updatedAt" FROM "AgentClient" ORDER BY "id"`,
    );
    await client.query(migrationSql);
    const afterSecond = await client.query(
      `SELECT "id", "scopes", "updatedAt" FROM "AgentClient" ORDER BY "id"`,
    );

    const rows = Object.fromEntries(
      afterSecond.rows.map((row) => [row.id, row]),
    );
    assert.deepEqual(rows.target.scopes, ["contacts:read", "contacts:write"]);
    assert.deepEqual(rows["already-granted"].scopes, [
      "contacts:read",
      "contacts:write",
    ]);
    assert.deepEqual(rows["revoked-status"].scopes, ["contacts:read"]);
    assert.deepEqual(rows["revoked-at"].scopes, ["contacts:read"]);
    assert.deepEqual(rows["old-hermes"].scopes, ["contacts:read"]);
    assert.deepEqual(rows["case-mismatch"].scopes, ["contacts:read"]);
    assert.equal(
      rows.target.scopes.filter((scope) => scope === "contacts:write").length,
      1,
    );
    assert.equal(
      rows.target.updatedAt.getTime(),
      afterFirst.rows.find((row) => row.id === "target").updatedAt.getTime(),
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.end();
  }
});
