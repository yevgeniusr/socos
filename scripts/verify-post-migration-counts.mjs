#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const metadataPath = process.argv[2];
const requiredPgVariables = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const optionalPgVariables = [
  'PGSSLMODE',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGSSLROOTCERT',
  'PGSSLCRL',
  'PGCONNECT_TIMEOUT',
  'PGAPPNAME',
  'PGOPTIONS',
];
const pgEnvironment = Object.fromEntries(
  requiredPgVariables.map((name) => [name, process.env[name]]),
);
const migrationsRoot = resolve(
  process.env.SOCOS_MIGRATIONS_ROOT ?? 'services/api/prisma/migrations',
);
const migrationNames = readdirSync(migrationsRoot)
  .filter((name) => existsSync(resolve(migrationsRoot, name, 'migration.sql')))
  .sort();
const expectedMigrationCount = migrationNames.length;
const migrationCountByName = new Map(
  migrationNames.map((name, index) => [name, index + 1]),
);
const contactEnrichmentMigrationCount = migrationCountByName.get(
  '20260718200000_contact_enrichment',
);
const googleCalendarMultiAccountMigrationCount = migrationCountByName.get(
  '20260718210000_google_calendar_multi_account',
);
if (
  contactEnrichmentMigrationCount !== 15
  || googleCalendarMultiAccountMigrationCount !== 16
) {
  console.error('Required migration rollout order is invalid.');
  process.exit(65);
}
const agentInterfaceTables = [
  'ActionOutbox',
  'ActionProposal',
  'AgentClient',
  'AgentCredential',
  'AgentIdempotencyRecord',
  'ApprovalGrant',
  'MutationAuditEvent',
];
const calendarLocationTables = [
  'CalendarEvent',
  'CalendarSource',
  'CalendarWatch',
  'CityStay',
  'DerivedVisit',
  'GoogleCalendarConnection',
  'GoogleOAuthAttempt',
  'LocationAlias',
  'LocationDevice',
  'LocationSample',
  'PersonalDataDeletionAudit',
];
const eventDiscoveryTables = [
  'DiscoveredEvent',
  'EventPreference',
  'EventSource',
];
const humanIdempotencyTables = ['HumanIdempotencyRecord'];
const interactionReceiptTables = ['InteractionReceipt'];
const contactEnrichmentTables = ['ContactEnrichmentCandidate'];

function emptyTableRollout(migrationCount, label, tableNames) {
  return {
    migrationCount,
    label,
    tables: tableNames.map((name) => ({ name, introducedRowCount: 0 })),
  };
}

const introducedTableRollouts = [
  emptyTableRollout(7, 'agent-interface tables', agentInterfaceTables),
  emptyTableRollout(8, 'calendar-location tables', calendarLocationTables),
  emptyTableRollout(9, 'event-discovery tables', eventDiscoveryTables),
  emptyTableRollout(11, 'human-idempotency tables', humanIdempotencyTables),
  emptyTableRollout(12, 'interaction-receipt tables', interactionReceiptTables),
  {
    migrationCount: 13,
    label: 'event-catalog tables',
    tables: [
      { name: 'EventCatalogListing', introducedRowCount: 6 },
      { name: 'EventCatalogFollow', introducedRowCount: 0 },
    ],
  },
  emptyTableRollout(
    contactEnrichmentMigrationCount,
    'contact-enrichment tables',
    contactEnrichmentTables,
  ),
];
const rowCountRollouts = [
  {
    migrationCount: 14,
    table: 'EventCatalogListing',
    addedRowCount: 43,
  },
];
const allowedNewTables = new Set([
  ...introducedTableRollouts
    .filter((rollout) => rollout.migrationCount <= expectedMigrationCount)
    .flatMap((rollout) => rollout.tables.map((table) => table.name)),
]);

if (
  !metadataPath
  || requiredPgVariables.some((name) => typeof pgEnvironment[name] !== 'string' || pgEnvironment[name] === '')
) {
  console.error('PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, and aggregate metadata are required.');
  process.exit(64);
}

const psqlEnvironment = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME || '/nonexistent',
  LANG: process.env.LANG || 'C',
  LC_ALL: process.env.LC_ALL || 'C',
  ...pgEnvironment,
};
for (const name of optionalPgVariables) {
  if (process.env[name] !== undefined) psqlEnvironment[name] = process.env[name];
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
if (
  !Number.isSafeInteger(beforeMigrationCount) ||
  beforeMigrationCount < 6 ||
  beforeMigrationCount > expectedMigrationCount
) {
  console.error(
    `Pre-migration aggregate metadata must include migration history count 6 through ${expectedMigrationCount}.`,
  );
  process.exit(65);
}
for (const rollout of introducedTableRollouts) {
  if (
    beforeMigrationCount >= rollout.migrationCount &&
    rollout.tables.some((table) => !before.has(table.name))
  ) {
    console.error(
      `${beforeMigrationCount}-migration metadata must include all ${rollout.label}.`,
    );
    process.exit(65);
  }
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
    '--set=ON_ERROR_STOP=1',
    '--no-align',
    '--field-separator=\t',
    '--pset=footer=off',
    `--command=${query}`,
  ],
  { encoding: 'utf8', env: psqlEnvironment },
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
const addedRowsAfter = (table, migrationCount) =>
  rowCountRollouts
    .filter(
      (rollout) =>
        rollout.table === table
        && rollout.migrationCount > migrationCount
        && rollout.migrationCount <= expectedMigrationCount,
    )
    .reduce((total, rollout) => total + rollout.addedRowCount, 0);
for (const [table, count] of before) {
  if (table !== '_prisma_migrations') {
    valid &&= after.get(table) === count + addedRowsAfter(table, beforeMigrationCount);
  }
}
let introducedEmptyTables = 0;
const expectedIntroducedTables = introducedTableRollouts
  .filter(
    (rollout) =>
      beforeMigrationCount < rollout.migrationCount &&
      rollout.migrationCount <= expectedMigrationCount,
  )
  .flatMap((rollout) => rollout.tables);
for (const table of expectedIntroducedTables) {
  if (!before.has(table.name)) {
    const introducedAt = introducedTableRollouts.find((rollout) =>
      rollout.tables.some((candidate) => candidate.name === table.name)
    )?.migrationCount;
    valid &&=
      after.get(table.name) ===
      table.introducedRowCount + addedRowsAfter(table.name, introducedAt ?? beforeMigrationCount);
    if (table.introducedRowCount === 0) introducedEmptyTables++;
  }
}
valid &&= after.get('_prisma_migrations') === expectedMigrationCount;
valid &&= beforeMigrationCount <= expectedMigrationCount;
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
