import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationPaths = [
  'services/api/prisma/migrations/20260327000000_initial_schema/migration.sql',
  'services/api/prisma/migrations/20260331000000_add_celebrations/migration.sql',
];
const reconciliationPath = resolve(
  root,
  'services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql',
);

if (!databaseUrl) {
  test('migration safety integration requires TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const parsedUrl = new URL(databaseUrl);
  assert.match(
    basename(parsedUrl.pathname),
    /^socos_migration_test_[a-z0-9_]+$/,
    'integration tests refuse to use a database without the socos_migration_test_ prefix',
  );

  const requireFromApi = createRequire(resolve(root, 'services/api/package.json'));
  const { Client } = requireFromApi('pg');

  async function withClient(callback) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  async function resetLegacySchema(client) {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    for (const path of migrationPaths) {
      await client.query(readFileSync(resolve(root, path), 'utf8'));
    }
  }

  async function columnExists(client, table, column) {
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS present`,
      [table, column],
    );
    return result.rows[0].present;
  }

  test('reconciliation refuses a populated legacy schema without changing it', async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      await client.query(
        `INSERT INTO "User" ("id", "email", "updatedAt")
         VALUES ('integration-user', 'integration@example.invalid', CURRENT_TIMESTAMP)`,
      );

      await assert.rejects(
        client.query(readFileSync(reconciliationPath, 'utf8')),
        /Refusing to convert a populated legacy schema/,
      );
      await client.query('ROLLBACK');

      assert.equal(await columnExists(client, 'Contact', 'name'), true);
      assert.equal(await columnExists(client, 'Contact', 'firstName'), false);
      assert.equal(await columnExists(client, 'DungeonMasterScenario', 'id'), false);
    });
  });

  test('an injected late migration failure rolls back every reconciliation change', async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      const migration = readFileSync(reconciliationPath, 'utf8');
      const injected = migration.replace(
        /\nCOMMIT;\s*$/,
        '\nCREATE TABLE "RollbackProbe" ("id" INTEGER);\nSELECT 1 / 0;\nCOMMIT;\n',
      );
      assert.notEqual(injected, migration, 'failure injection point was not found');

      await assert.rejects(client.query(injected), /division by zero/);
      await client.query('ROLLBACK');

      assert.equal(await columnExists(client, 'Contact', 'name'), true);
      assert.equal(await columnExists(client, 'Contact', 'firstName'), false);
      assert.equal(await columnExists(client, 'RollbackProbe', 'id'), false);
      assert.equal(await columnExists(client, 'DungeonMasterScenario', 'id'), false);
    });
  });

  test('reconciliation preserves a populated current-shape database', async () => {
    await withClient(async (client) => {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });
    execFileSync(
      'pnpm',
      ['--filter', '@socos/api', 'exec', 'prisma', 'db', 'push', '--skip-generate'],
      { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
    );
    await withClient(async (client) => {
      await client.query(
        'DROP TABLE "DMSceneResponse", "DMSession", "DungeonMasterScenario" CASCADE',
      );
      await client.query(
        `INSERT INTO "User" ("id", "email", "updatedAt")
         VALUES ('current-shape-user', 'current-shape@example.invalid', CURRENT_TIMESTAMP)`,
      );
      await client.query(
        `INSERT INTO "Vault" ("id", "name", "ownerId", "updatedAt")
         VALUES ('current-shape-vault', 'Synthetic vault', 'current-shape-user', CURRENT_TIMESTAMP);
         INSERT INTO "Contact" ("id", "vaultId", "ownerId", "firstName", "bio", "updatedAt")
         VALUES ('current-shape-contact', 'current-shape-vault', 'current-shape-user', 'Synthetic', 'preserve-me', CURRENT_TIMESTAMP);
         INSERT INTO "Interaction" ("id", "contactId", "ownerId", "type", "content", "updatedAt")
         VALUES ('current-shape-interaction', 'current-shape-contact', 'current-shape-user', 'note', 'preserve-interaction', CURRENT_TIMESTAMP);
         INSERT INTO "Reminder" ("id", "contactId", "ownerId", "type", "title", "scheduledAt", "updatedAt")
         VALUES ('current-shape-reminder', 'current-shape-contact', 'current-shape-user', 'followup', 'preserve-reminder', CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP);`,
      );

      await client.query(readFileSync(reconciliationPath, 'utf8'));

      const preserved = await client.query(
        'SELECT count(*)::int AS count FROM "User" WHERE id = $1',
        ['current-shape-user'],
      );
      assert.equal(preserved.rows[0].count, 1);
      const related = await client.query(
        `SELECT
           (SELECT "bio" FROM "Contact" WHERE "id" = 'current-shape-contact') AS bio,
           (SELECT "content" FROM "Interaction" WHERE "id" = 'current-shape-interaction') AS interaction,
           (SELECT "title" FROM "Reminder" WHERE "id" = 'current-shape-reminder') AS reminder`,
      );
      assert.deepEqual(related.rows[0], {
        bio: 'preserve-me',
        interaction: 'preserve-interaction',
        reminder: 'preserve-reminder',
      });
      assert.equal(await columnExists(client, 'DungeonMasterScenario', 'id'), true);
    });
  });

  test('fresh migration deployment reaches the checked-in Prisma schema', async () => {
    await withClient(async (client) => {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });
    execFileSync(
      'pnpm',
      ['--filter', '@socos/api', 'exec', 'prisma', 'migrate', 'deploy'],
      { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
    );
    const output = execFileSync('node', ['scripts/compare-schema.mjs'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    assert.equal(output.trim(), 'schema_status=match statements=0');
  });
}
