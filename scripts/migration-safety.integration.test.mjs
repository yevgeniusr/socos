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
const preBriefMigrationPaths = [
  'services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql',
  'services/api/prisma/migrations/20260716000000_persist_dm_debrief/migration.sql',
  'services/api/prisma/migrations/20260716120000_add_contact_provenance/migration.sql',
];
const dailyBriefMigrationPath = resolve(
  root,
  'services/api/prisma/migrations/20260716130000_daily_social_brief/migration.sql',
);
const expectedBriefTables = ['BriefBatch', 'BriefItem', 'Quest', 'BriefFeedback', 'XpTransaction'];
const expectedUniqueIndexes = [
  'BriefBatch_ownerId_localDate_key',
  'BriefFeedback_ownerId_idempotencyKey_key',
  'XpTransaction_ownerId_sourceType_sourceId_key',
];
const expectedChecks = [
  ['User_briefHourLocal_check', /briefHourLocal >= 0.+briefHourLocal <= 23/],
  ['Contact_importance_check', /importance >= 1.+importance <= 5/],
  ['Contact_preferredCadenceDays_check', /preferredCadenceDays >= 7.+preferredCadenceDays <= 365/],
  ['Quest_xpReward_check', /xpReward.*>= 0/],
  ['BriefFeedback_target_check', /num_nonnulls\(briefItemId, questId\) = 1/],
];

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

  async function tableExists(client, table) {
    const result = await client.query(
      `SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS present`,
      [table],
    );
    return result.rows[0].present;
  }

  async function assertDailyBriefSchema(client) {
    for (const table of expectedBriefTables) {
      assert.equal(await tableExists(client, table), true, `missing table ${table}`);
    }

    for (const column of ['importance', 'preferredCadenceDays']) {
      assert.equal(
        await columnExists(client, 'Contact', column),
        true,
        `missing Contact.${column}`,
      );
    }
    for (const column of ['timeZone', 'briefHourLocal']) {
      assert.equal(await columnExists(client, 'User', column), true, `missing User.${column}`);
    }

    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedUniqueIndexes],
    );
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname).sort(),
      [...expectedUniqueIndexes].sort(),
    );
    for (const { indexname, indexdef } of indexes.rows) {
      assert.match(indexdef, /^CREATE UNIQUE INDEX /, `${indexname} must remain unique`);
    }

    const checks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [expectedChecks.map(([name]) => name)],
    );
    const definitions = new Map(
      checks.rows.map(({ conname, definition }) => [conname, definition.replaceAll('"', '')]),
    );
    for (const [name, pattern] of expectedChecks) {
      assert.match(definitions.get(name) ?? '', pattern, `missing or invalid check ${name}`);
    }
  }

  async function assertOwnerConsistency(client) {
    await client.query(
      `INSERT INTO "User" ("id", "email", "updatedAt")
       VALUES ('foreign-owner', 'foreign-owner@example.invalid', CURRENT_TIMESTAMP);
       INSERT INTO "BriefBatch" ("id", "ownerId", "localDate", "timeZone", "updatedAt")
       VALUES
         ('owned-batch', 'upgraded-user', DATE '2026-07-16', 'UTC', CURRENT_TIMESTAMP),
         ('other-batch', 'upgraded-user', DATE '2026-07-17', 'UTC', CURRENT_TIMESTAMP);
       INSERT INTO "BriefItem" (
         "id", "batchId", "ownerId", "kind", "sourceType", "rank", "score",
         "title", "reason", "evidence", "updatedAt"
       ) VALUES (
         'owned-item', 'owned-batch', 'upgraded-user', 'person', 'contact', 1, 50,
         'Synthetic item', 'Synthetic reason', '{}'::jsonb, CURRENT_TIMESTAMP
       );`,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefItem" (
           "id", "batchId", "ownerId", "kind", "sourceType", "rank", "score",
           "title", "reason", "evidence", "updatedAt"
         ) VALUES (
           'foreign-item', 'owned-batch', 'foreign-owner', 'person', 'contact', 2, 50,
           'Foreign item', 'Synthetic reason', '{}'::jsonb, CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "Quest" (
           "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
           "targetId", "xpReward"
         ) VALUES (
           'cross-batch-quest', 'other-batch', 'upgraded-user', 'owned-item',
           'Cross batch quest', 'interaction', 'synthetic-target', 15
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "Quest" (
           "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
           "targetId", "xpReward"
         ) VALUES (
           'foreign-owner-quest', 'owned-batch', 'foreign-owner', 'owned-item',
           'Foreign owner quest', 'interaction', 'synthetic-target', 15
         )`,
      ),
      /foreign key constraint/,
    );

    await client.query(
      `INSERT INTO "Quest" (
         "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
         "targetId", "xpReward"
       ) VALUES (
         'owned-quest', 'owned-batch', 'upgraded-user', 'owned-item',
         'Owned quest', 'interaction', 'synthetic-target', 15
       )`,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefFeedback" (
           "id", "ownerId", "briefItemId", "action", "idempotencyKey", "requestHash"
         ) VALUES (
           'foreign-item-feedback', 'foreign-owner', 'owned-item', 'accept',
           'foreign-item-key', 'synthetic-hash'
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefFeedback" (
           "id", "ownerId", "questId", "action", "idempotencyKey", "requestHash"
         ) VALUES (
           'foreign-quest-feedback', 'foreign-owner', 'owned-quest', 'complete',
           'foreign-quest-key', 'synthetic-hash'
         )`,
      ),
      /foreign key constraint/,
    );
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
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
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

  test('upgraded migration deployment adds the daily brief schema', async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      for (const path of preBriefMigrationPaths) {
        await client.query(readFileSync(resolve(root, path), 'utf8'));
      }

      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "xp", "updatedAt")
         VALUES (
           'upgraded-user', 'upgraded-user@example.invalid', 'Synthetic Owner', 37,
           CURRENT_TIMESTAMP
         );
         INSERT INTO "Vault" ("id", "name", "description", "ownerId", "updatedAt")
         VALUES (
           'upgraded-vault', 'Synthetic Vault', 'preserve-vault', 'upgraded-user',
           CURRENT_TIMESTAMP
         );
         INSERT INTO "Contact" (
           "id", "vaultId", "ownerId", "firstName", "lastName", "bio", "groups",
           "sourceSystem", "sourceId", "updatedAt"
         ) VALUES (
           'upgraded-contact', 'upgraded-vault', 'upgraded-user', 'Synthetic', 'Contact',
           'preserve-contact', ARRAY['Synthetic Group'], 'synthetic', 'source-1',
           CURRENT_TIMESTAMP
         );`,
      );
      const before = await client.query(
        `SELECT
           (SELECT count(*)::int FROM "User") AS "userCount",
           (SELECT count(*)::int FROM "Vault") AS "vaultCount",
           (SELECT count(*)::int FROM "Contact") AS "contactCount",
           (SELECT json_build_object('email', "email", 'name', "name", 'xp', "xp")
              FROM "User" WHERE "id" = 'upgraded-user') AS "userRecord",
           (SELECT json_build_object('name', "name", 'description', "description")
              FROM "Vault" WHERE "id" = 'upgraded-vault') AS "vaultRecord",
           (SELECT json_build_object(
              'firstName', "firstName", 'lastName', "lastName", 'bio', "bio",
              'groups', "groups", 'sourceSystem', "sourceSystem", 'sourceId', "sourceId"
            ) FROM "Contact" WHERE "id" = 'upgraded-contact') AS "contactRecord"`,
      );

      assert.equal(await tableExists(client, 'BriefBatch'), false);
      await client.query(readFileSync(dailyBriefMigrationPath, 'utf8'));
      await assertDailyBriefSchema(client);

      const after = await client.query(
        `SELECT
           (SELECT count(*)::int FROM "User") AS "userCount",
           (SELECT count(*)::int FROM "Vault") AS "vaultCount",
           (SELECT count(*)::int FROM "Contact") AS "contactCount",
           (SELECT json_build_object('email', "email", 'name', "name", 'xp', "xp")
              FROM "User" WHERE "id" = 'upgraded-user') AS "userRecord",
           (SELECT json_build_object('name', "name", 'description', "description")
              FROM "Vault" WHERE "id" = 'upgraded-vault') AS "vaultRecord",
           (SELECT json_build_object(
              'firstName', "firstName", 'lastName', "lastName", 'bio', "bio",
              'groups', "groups", 'sourceSystem', "sourceSystem", 'sourceId', "sourceId"
            ) FROM "Contact" WHERE "id" = 'upgraded-contact') AS "contactRecord"`,
      );
      assert.deepEqual(after.rows[0], before.rows[0]);

      const defaults = await client.query(
        `SELECT
           (SELECT "timeZone" FROM "User" WHERE "id" = 'upgraded-user') AS "timeZone",
           (SELECT "briefHourLocal" FROM "User" WHERE "id" = 'upgraded-user') AS "briefHourLocal",
           (SELECT "importance" FROM "Contact" WHERE "id" = 'upgraded-contact') AS "importance",
           (SELECT "preferredCadenceDays" FROM "Contact"
             WHERE "id" = 'upgraded-contact') AS "preferredCadenceDays"`,
      );
      assert.deepEqual(defaults.rows[0], {
        timeZone: 'UTC',
        briefHourLocal: 8,
        importance: 3,
        preferredCadenceDays: 90,
      });
      for (const table of expectedBriefTables) {
        const rows = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
        assert.equal(rows.rows[0].count, 0, `${table} must start empty after upgrade`);
      }

      await assertOwnerConsistency(client);
    });

    const output = execFileSync('node', ['scripts/compare-schema.mjs'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    assert.equal(output.trim(), 'schema_status=match statements=0');
  });

  test('fresh migration deployment reaches the checked-in Prisma schema', async () => {
    await withClient(async (client) => {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });
    execFileSync('pnpm', ['--filter', '@socos/api', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
    const output = execFileSync('node', ['scripts/compare-schema.mjs'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });
    assert.equal(output.trim(), 'schema_status=match statements=0');
    await withClient(assertDailyBriefSchema);
  });
}
