import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("explicit migration identifiers fit PostgreSQL's 63-byte limit", async () => {
  const migrationsRoot = path.join(root, "services/api/prisma/migrations");
  const entries = await readdir(migrationsRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name === "migration.sql")
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migration = await readFile(migrationFile, "utf8");
    for (const match of migration.matchAll(/"((?:""|[^"])*)"/g)) {
      const identifier = match[1].replaceAll('""', '"');
      assert.ok(
        Buffer.byteLength(identifier, "utf8") <= 63,
        `${path.relative(root, migrationFile)} contains an overlong PostgreSQL identifier: ${identifier}`,
      );
    }
  }
});

test("contact-enrichment migration uses Prisma's expected candidate index name", async () => {
  const migration = await text(
    "services/api/prisma/migrations/20260718200000_contact_enrichment/migration.sql",
  );

  assert.match(
    migration,
    /CREATE INDEX "ContactEnrichmentCandidate_ownerId_contactId_status_created_idx"\s+ON "ContactEnrichmentCandidate"\("ownerId", "contactId", "status", "createdAt"\);/,
  );
});

test("migration creates an owner-scoped constrained candidate ledger and partial birthdays", async () => {
  const migration = await text(
    "services/api/prisma/migrations/20260718200000_contact_enrichment/migration.sql",
  );

  assert.match(migration, /CREATE TABLE "ContactEnrichmentCandidate"/);
  assert.match(migration, /ADD COLUMN "birthdayMonth" INTEGER/);
  assert.match(migration, /ADD COLUMN "birthdayDay" INTEGER/);
  assert.match(migration, /Contact_birthday_parts_check/);
  assert.match(migration, /WHEN 2 THEN 29/);
  assert.match(
    migration,
    /UNIQUE INDEX "ContactEnrichmentCandidate_ownerId_contactId_contentHash_key"/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("contactId", "ownerId"\) REFERENCES "Contact"\("id", "ownerId"\)/,
  );
  assert.match(
    migration,
    /status" IN \('pending', 'accepted', 'rejected', 'superseded'\)/,
  );
  assert.match(
    migration,
    /sourceKind" IN \('second_brain', 'arc_history', 'arc_sidebar', 'vcard', 'public_web'\)/,
  );
  assert.match(migration, /confidence" >= 0 AND "confidence" <= 1/);
});

test("MCP exposes narrow enrichment scopes and four explicit tools", async () => {
  const contracts = await text(
    "packages/agent-core/src/agent-interface/contracts.ts",
  );
  const tools = await text(
    "services/api/src/modules/agent-tools/tool-handlers.ts",
  );

  for (const scope of [
    "enrichment:read",
    "enrichment:candidates:write",
    "enrichment:accept",
  ]) {
    assert.match(contracts, new RegExp(`['\"]${scope}['\"]`));
  }
  for (const name of [
    "socos_contacts_missing_enrichment",
    "socos_enrichment_candidates_list",
    "socos_enrichment_candidate_submit",
    "socos_enrichment_candidate_accept",
  ]) {
    assert.match(tools, new RegExp(`['\"]${name}['\"]`));
  }
  assert.match(
    tools,
    /"socos_enrichment_candidate_submit"[\s\S]{0,300}"enrichment:candidates:write"/,
  );
  assert.match(
    tools,
    /"socos_enrichment_candidate_accept"[\s\S]{0,300}"enrichment:accept"/,
  );
});

test("collector is dry-run local-only and Arc reads a copied URL/title projection", async () => {
  const collector = await text(
    "services/api/src/cli/contact-enrichment-collector.ts",
  );

  assert.match(collector, /copyFile\(source, copy\)/);
  assert.match(collector, /SELECT url, title FROM urls/);
  assert.match(collector, /url LIKE 'https:\/\/%'/);
  assert.match(collector, /dryRun: true/);
  assert.doesNotMatch(collector, /fetch\(|axios|playwright|puppeteer/i);
  assert.doesNotMatch(collector, /Apple.*Application Support|AddressBook|TCC/i);
});

test("operator docs preserve public-review and missing-only boundaries", async () => {
  const guide = await text("docs/contact-enrichment.md");
  const mcp = await text("docs/integrations/socos-mcp.md");
  const hermes = await text(
    "integrations/hermes/skills/socos-social-loop/SKILL.md",
  );
  const combined = `${guide}\n${mcp}\n${hermes}`;

  assert.match(combined, /public.web.{0,80}(?:pending|human review)/is);
  assert.match(combined, /missing.only/i);
  assert.match(combined, /never requires `approvals:execute`/i);
  assert.match(guide, /Cookies.*Login Data.*Web Data.*Local Storage/s);
  assert.match(guide, /explicitly exported `.vcf`/i);
});
