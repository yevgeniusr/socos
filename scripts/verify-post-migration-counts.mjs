#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
const metadataPath = process.argv[2];
const expectedMigrationCount = Number.parseInt(process.env.EXPECTED_MIGRATION_COUNT ?? '3', 10);
const allowedNewTables = new Set(['DMSceneResponse', 'DMSession', 'DungeonMasterScenario']);

if (!databaseUrl || !metadataPath || !Number.isSafeInteger(expectedMigrationCount)) {
  console.error('DATABASE_URL, aggregate metadata, and a valid migration count are required.');
  process.exit(64);
}

function parseMetadata(raw) {
  const lines = raw.trimEnd().split('\n');
  if (lines.shift() !== 'table_name\trow_count') throw new Error('invalid header');

  const counts = new Map();
  for (const line of lines) {
    const [table, countText, extra] = line.split('\t');
    const count = Number.parseInt(countText, 10);
    if (!table || extra !== undefined || !/^\d+$/.test(countText) || !Number.isSafeInteger(count)) {
      throw new Error('invalid aggregate row');
    }
    if (counts.has(table)) throw new Error('duplicate table');
    counts.set(table, count);
  }
  return counts;
}

let before;
try {
  before = parseMetadata(readFileSync(resolve(metadataPath), 'utf8'));
} catch {
  console.error('Pre-migration aggregate metadata is invalid.');
  process.exit(65);
}

const query = `
  SELECT c.relname AS table_name,
         ((xpath('/row/count/text()', query_to_xml(
           format('SELECT count(*) AS count FROM %I.%I', n.nspname, c.relname),
           false, true, ''
         )))[1]::text)::bigint AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname;
`;
const result = spawnSync(
  'psql',
  [
    '-X',
    databaseUrl,
    '--set=ON_ERROR_STOP=1',
    '--no-align',
    '--field-separator=\t',
    '--pset=footer=off',
    `--command=${query}`,
  ],
  { encoding: 'utf8' },
);

if (result.error || result.status !== 0) {
  console.error('Post-migration aggregate query failed.');
  process.exit(1);
}

let after;
try {
  after = parseMetadata(result.stdout);
} catch {
  console.error('Post-migration aggregate verification failed.');
  process.exit(2);
}

let valid = before.size > 0;
for (const [table, count] of before) {
  valid &&= table !== '_prisma_migrations' && after.get(table) === count;
}
for (const table of allowedNewTables) {
  valid &&= !before.has(table) && after.get(table) === 0;
}
valid &&= after.get('_prisma_migrations') === expectedMigrationCount;
for (const table of after.keys()) {
  valid &&= before.has(table) || allowedNewTables.has(table) || table === '_prisma_migrations';
}

if (!valid) {
  console.error('Post-migration aggregate verification failed.');
  process.exit(2);
}

console.log(
  `migration_counts_status=preserved existing_tables=${before.size} new_empty_tables=${allowedNewTables.size} migrations=${expectedMigrationCount}`,
);
