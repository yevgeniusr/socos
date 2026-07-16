#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
const metadataPath = process.argv[2];
const expectedMigrationCount = 7;
const agentInterfaceTables = [
  'ActionOutbox',
  'ActionProposal',
  'AgentClient',
  'AgentCredential',
  'AgentIdempotencyRecord',
  'ApprovalGrant',
  'MutationAuditEvent',
];
const allowedNewTables = new Set([
  ...agentInterfaceTables,
]);

if (!databaseUrl || !metadataPath) {
  console.error('DATABASE_URL and aggregate metadata are required.');
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

const beforeMigrationCount = before.get('_prisma_migrations');
if (beforeMigrationCount !== 6 && beforeMigrationCount !== 7) {
  console.error('Pre-migration aggregate metadata must include migration history count 6 or 7.');
  process.exit(65);
}
if (beforeMigrationCount === 7 && agentInterfaceTables.some((table) => !before.has(table))) {
  console.error('Seven-migration metadata must include all agent-interface tables.');
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
  if (table !== '_prisma_migrations') valid &&= after.get(table) === count;
}
let introducedEmptyTables = 0;
for (const table of allowedNewTables) {
  if (before.has(table)) {
    valid &&= after.get(table) === before.get(table);
  } else {
    valid &&= after.get(table) === 0;
    introducedEmptyTables++;
  }
}
valid &&= after.get('_prisma_migrations') === expectedMigrationCount;
valid &&= beforeMigrationCount === expectedMigrationCount - 1
  || beforeMigrationCount === expectedMigrationCount;
for (const table of after.keys()) {
  valid &&= before.has(table) || allowedNewTables.has(table) || table === '_prisma_migrations';
}

if (!valid) {
  console.error('Post-migration aggregate verification failed.');
  process.exit(2);
}

console.log(
  `migration_counts_status=preserved existing_tables=${before.size - (beforeMigrationCount === undefined ? 0 : 1)} new_empty_tables=${introducedEmptyTables} migrations=${expectedMigrationCount}`,
);
