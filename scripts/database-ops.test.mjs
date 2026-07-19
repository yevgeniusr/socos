import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const migrationsRoot = resolve(root, 'services/api/prisma/migrations');
const currentMigrationNames = readdirSync(migrationsRoot)
  .filter((name) => existsSync(resolve(migrationsRoot, name, 'migration.sql')))
  .sort();
const currentMigrationCount = currentMigrationNames.length;
const backupPgEnvironment = {
  PGHOST: 'example.invalid',
  PGPORT: '5432',
  PGUSER: 'secret-user',
  PGPASSWORD: 'secret-password',
  PGDATABASE: 'socos',
};

function executable(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function nodeExecutable(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function run(script, { args = [], env = {} } = {}) {
  return spawnSync(resolve(root, script), args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('backup creates a private custom dump with checksum and aggregate metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-backup-test-'));
  const bin = join(dir, 'bin');
  const signalLog = join(dir, 'snapshot-signal.log');
  const argsLog = join(dir, 'database-argv.log');
  execFileSync('mkdir', ['-p', bin]);
  executable(
    bin,
    'pg_dump',
    `if [ "\${DATABASE_URL+x}" = x ]; then has_database_url=true; else has_database_url=false; fi; printf 'pg_dump hasDatabaseUrl=%s args=%s\\n' "$has_database_url" "$*" >> '${argsLog}'; case "$*" in *--snapshot=*) ;; *) exit 3;; esac; while [ "$#" -gt 0 ]; do if [ "$1" = "--file" ]; then shift; printf custom-dump > "$1"; exit; fi; shift; done; exit 2`,
  );
  nodeExecutable(
    bin,
    'psql',
    `const fs = require('node:fs');
fs.appendFileSync('${argsLog}', 'psql hasDatabaseUrl=' + Object.hasOwn(process.env, 'DATABASE_URL') + ' args=' + JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.SOCOS_SNAPSHOT_FILE) {
  fs.writeFileSync(process.env.SOCOS_SNAPSHOT_FILE, '00000003-0000001B-1');
  fs.writeFileSync(process.env.SOCOS_SNAPSHOT_READY, '');
  process.on('SIGINT', () => { fs.writeFileSync('${signalLog}', 'INT'); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (process.argv.join(' ').includes('SET TRANSACTION SNAPSHOT')) {
  process.stdout.write('table_name\\trow_count\\nContact\\t106\\nInteraction\\t13\\n');
} else process.exit(4);`,
  );

  const result = run('scripts/backup-postgres.sh', {
    env: {
      BACKUP_DIR: dir,
      ...backupPgEnvironment,
      DATABASE_URL: 'postgresql://decoy-user:decoy-password@decoy.invalid/wrong',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const secrets = /secret-user|secret-password|decoy-user|decoy-password/;
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, secrets);
  const dump = result.stdout.match(/backup_file=(.+)/)?.[1];
  assert.ok(dump);
  assert.equal(readFileSync(dump, 'utf8'), 'custom-dump');
  assert.equal(statSync(dump).mode & 0o777, 0o600);
  assert.match(readFileSync(`${dump}.sha256`, 'utf8'), /^[a-f0-9]{64}  /);
  assert.equal(
    readFileSync(`${dump}.metadata.tsv`, 'utf8'),
    'table_name\trow_count\nContact\t106\nInteraction\t13\n',
  );
  assert.equal(readFileSync(signalLog, 'utf8'), 'INT');
  const clientCalls = readFileSync(argsLog, 'utf8').trim().split('\n');
  assert.equal(clientCalls.length, 3);
  for (const clientCall of clientCalls) {
    assert.match(clientCall, /^(?:psql|pg_dump) hasDatabaseUrl=false args=/);
    assert.doesNotMatch(clientCall, secrets);
  }
});

test('backup never publishes partial artifacts when dump creation fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-backup-failure-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  executable(bin, 'pg_dump', 'exit 9');
  nodeExecutable(
    bin,
    'psql',
    `const fs = require('node:fs');
fs.writeFileSync(process.env.SOCOS_SNAPSHOT_FILE, '00000003-0000001B-1');
fs.writeFileSync(process.env.SOCOS_SNAPSHOT_READY, '');
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1000);`,
  );

  const result = run('scripts/backup-postgres.sh', {
    env: {
      BACKUP_DIR: dir,
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-user|secret-password/);
  assert.deepEqual(
    readdirSync(dir).filter((name) => /\.(dump|tsv|sha256)$/.test(name)),
    [],
  );
});

test('backup escalates snapshot cancellation when SIGINT is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-backup-signal-test-'));
  const bin = join(dir, 'bin');
  const signalLog = join(dir, 'snapshot-signal.log');
  execFileSync('mkdir', ['-p', bin]);
  executable(
    bin,
    'pg_dump',
    'while [ "$#" -gt 0 ]; do if [ "$1" = "--file" ]; then shift; printf custom-dump > "$1"; exit; fi; shift; done; exit 2',
  );
  nodeExecutable(
    bin,
    'psql',
    `const fs = require('node:fs');
if (process.env.SOCOS_SNAPSHOT_FILE) {
  fs.writeFileSync(process.env.SOCOS_SNAPSHOT_FILE, '00000003-0000001B-1');
  fs.writeFileSync(process.env.SOCOS_SNAPSHOT_READY, '');
  process.on('SIGINT', () => fs.appendFileSync('${signalLog}', 'INT\\n'));
  process.on('SIGTERM', () => { fs.appendFileSync('${signalLog}', 'TERM\\n'); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (process.argv.join(' ').includes('SET TRANSACTION SNAPSHOT')) {
  process.stdout.write('table_name\\trow_count\\nContact\\t0\\n');
}`,
  );

  const result = run('scripts/backup-postgres.sh', {
    env: {
      BACKUP_DIR: dir,
      ...backupPgEnvironment,
      SNAPSHOT_CANCEL_GRACE_SECONDS: '0.05',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(signalLog, 'utf8'), 'INT\nTERM\n');
});

test('backup rejects DATABASE_URL-only configuration before launching database clients', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-backup-url-only-test-'));
  const bin = join(dir, 'bin');
  const called = join(dir, 'database-client-called');
  execFileSync('mkdir', ['-p', bin]);
  executable(bin, 'psql', `touch '${called}'`);
  executable(bin, 'pg_dump', `touch '${called}'`);

  const result = run('scripts/backup-postgres.sh', {
    env: {
      BACKUP_DIR: dir,
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PGHOST: '',
      PGPORT: '',
      PGUSER: '',
      PGPASSWORD: '',
      PGDATABASE: '',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(called), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-user|secret-password/);
});

test('independent recovery runbook uses secret-store libpq variables instead of a database URI', () => {
  const runbook = readFileSync(resolve(root, 'docs/runbooks/database-backup-restore.md'), 'utf8');
  const independentRecovery = runbook
    .split('## Independent Recovery Proof')[1]
    .split('\n## ')[0];
  assert.match(independentRecovery, /PGHOST.*PGPORT.*PGUSER.*PGPASSWORD.*PGDATABASE/is);
  for (const optionalVariable of [
    'PGSSLMODE',
    'PGSSLCERT',
    'PGSSLKEY',
    'PGSSLROOTCERT',
    'PGSSLCRL',
    'PGCONNECT_TIMEOUT',
    'PGAPPNAME',
    'PGOPTIONS',
  ]) assert.match(independentRecovery, new RegExp(`\\b${optionalVariable}\\b`));
  assert.match(independentRecovery, /not\s+configured.*need not be set or exported/is);
  assert.doesNotMatch(independentRecovery, /(?:^|[\s(])DATABASE_URL=/m);
});

test('post-migration recovery example uses required and configured optional libpq variables', () => {
  const runbook = readFileSync(resolve(root, 'docs/runbooks/database-backup-restore.md'), 'utf8');
  const migrationRecovery = runbook
    .split('## Migration Recovery Drill')[1]
    .split('\n## ')[0];
  assert.match(migrationRecovery, /PGHOST.*PGPORT.*PGUSER.*PGPASSWORD.*PGDATABASE/is);
  for (const optionalVariable of [
    'PGSSLMODE',
    'PGSSLCERT',
    'PGSSLKEY',
    'PGSSLROOTCERT',
    'PGSSLCRL',
    'PGCONNECT_TIMEOUT',
    'PGAPPNAME',
    'PGOPTIONS',
  ]) assert.match(migrationRecovery, new RegExp(`\\b${optionalVariable}\\b`));
  assert.match(migrationRecovery, /only.*configured.*optional libpq/is);
  assert.match(
    migrationRecovery,
    /(?:^|\n)node scripts\/verify-post-migration-counts\.mjs "\$PRE_MIGRATION_METADATA"/,
  );
  assert.match(
    migrationRecovery,
    /six seeded `EventCatalogListing` rows.*Migration 14 adds exactly 43 global catalogue rows.*49.*zero owner follows/is,
  );
});

test('scheduled backup runbook requires a canonical positive execution size without printing it', () => {
  const runbook = readFileSync(resolve(root, 'docs/runbooks/database-backup-restore.md'), 'utf8');
  const scheduledBackup = runbook
    .split('## Scheduled Backup')[1]
    .split('\n## ')[0];
  const successBranch = scheduledBackup.match(/success\)([\s\S]*?)break/);

  assert.match(scheduledBackup, /\{uuid, status, size, created_at, updated_at\}/);
  assert.ok(successBranch);
  assert.match(successBranch[1], /type == "string"[\s\S]*?test\("\^\[1-9\]\[0-9\]\*\$"\)/);
  assert.match(successBranch[1], /type == "number"/);
  assert.match(successBranch[1], /> 0/);
  assert.match(successBranch[1], /<= 9007199254740991/);
  assert.match(successBranch[1], /== floor/);
  assert.doesNotMatch(successBranch[1], /printf[^\n]*size/);
});

test('handoff keeps completed owner recovery and release baseline out of active work', () => {
  const handoff = readFileSync(resolve(root, 'docs/ai-handoff-2026-07-17.md'), 'utf8');
  const done = handoff.split('## Done And Deployed')[1].split('\n## ')[0];
  const inProgress = handoff.split('## In Progress')[1].split('\n## ')[0];
  const remaining = handoff.split('## Remaining Work')[1].split('\n## ')[0];

  assert.match(done, /^### Owner Access Recovery$/m);
  assert.match(done, /^### Release Baseline: Completed$/m);
  assert.doesNotMatch(inProgress, /^### Owner Access Recovery$/m);
  assert.doesNotMatch(remaining, /^### Release Baseline: Completed$/m);
  assert.equal(handoff.match(/^### Owner Access Recovery$/gm)?.length, 1);
  assert.equal(handoff.match(/^### Release Baseline: Completed$/gm)?.length, 1);
});

test('restore verification always drops its disposable database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-restore-test-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  execFileSync('mkdir', ['-p', bin]);
  const dump = join(dir, 'backup.dump');
  writeFileSync(dump, 'custom-dump');
  writeFileSync(
    `${dump}.sha256`,
    `${execFileSync('shasum', ['-a', '256', dump], { encoding: 'utf8' }).split(' ')[0]}  backup.dump\n`,
  );
  const aggregateMetadata =
    'table_name\trow_count\nContact\t0\nInteraction\t0\nReminder\t0\nUser\t0\nVault\t0\n';
  writeFileSync(`${dump}.metadata.tsv`, aggregateMetadata);
  executable(bin, 'createdb', `printf 'createdb\\n' >> '${log}'`);
  executable(bin, 'pg_restore', `printf 'restore\\n' >> '${log}'`);
  executable(bin, 'psql', `printf '${aggregateMetadata.replaceAll('\n', '\\n')}'`);
  executable(bin, 'dropdb', `printf 'dropdb\\n' >> '${log}'`);

  const result = run('scripts/verify-postgres-backup.sh', {
    args: [dump],
    env: {
      ADMIN_DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/postgres',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-user|secret-password/);
  assert.equal(readFileSync(log, 'utf8'), 'createdb\nrestore\ndropdb\n');
  assert.match(result.stdout, /aggregate_counts=verified/);
});

test('restore verification fails if the disposable database cannot be dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-restore-drop-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const dump = join(dir, 'backup.dump');
  writeFileSync(dump, 'custom-dump');
  writeFileSync(
    `${dump}.sha256`,
    `${execFileSync('shasum', ['-a', '256', dump], { encoding: 'utf8' }).split(' ')[0]}  backup.dump\n`,
  );
  const aggregateMetadata =
    'table_name\trow_count\nContact\t0\nInteraction\t0\nReminder\t0\nUser\t0\nVault\t0\n';
  writeFileSync(`${dump}.metadata.tsv`, aggregateMetadata);
  executable(bin, 'createdb', 'exit 0');
  executable(bin, 'pg_restore', 'exit 0');
  executable(bin, 'psql', `printf '${aggregateMetadata.replaceAll('\n', '\\n')}'`);
  executable(bin, 'dropdb', 'exit 8');

  const result = run('scripts/verify-postgres-backup.sh', {
    args: [dump],
    env: {
      ADMIN_DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/postgres',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /restore_status=verified/);
});

test('restore verification retains the disposable database only when requested', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-restore-retain-test-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  execFileSync('mkdir', ['-p', bin]);
  const dump = join(dir, 'backup.dump');
  writeFileSync(dump, 'custom-dump');
  writeFileSync(
    `${dump}.sha256`,
    `${execFileSync('shasum', ['-a', '256', dump], { encoding: 'utf8' }).split(' ')[0]}  backup.dump\n`,
  );
  const aggregateMetadata =
    'table_name\trow_count\nContact\t0\nInteraction\t0\nReminder\t0\nUser\t0\nVault\t0\n';
  writeFileSync(`${dump}.metadata.tsv`, aggregateMetadata);
  executable(bin, 'createdb', `printf 'createdb\\n' >> '${log}'`);
  executable(bin, 'pg_restore', 'exit 0');
  executable(bin, 'psql', `printf '${aggregateMetadata.replaceAll('\n', '\\n')}'`);
  executable(bin, 'dropdb', `printf 'dropdb\\n' >> '${log}'`);

  const result = run('scripts/verify-postgres-backup.sh', {
    args: [dump],
    env: {
      ADMIN_DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/postgres',
      KEEP_RESTORE_DB: '1',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(log, 'utf8'), 'createdb\n');
  assert.match(result.stdout, /restore_database_retained=socos_restore_[a-f0-9]+/);
});

test('restore verification reports cleanup failure after a restore error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-restore-cleanup-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const dump = join(dir, 'backup.dump');
  writeFileSync(dump, 'custom-dump');
  writeFileSync(
    `${dump}.sha256`,
    `${execFileSync('shasum', ['-a', '256', dump], { encoding: 'utf8' }).split(' ')[0]}  backup.dump\n`,
  );
  writeFileSync(`${dump}.metadata.tsv`, 'table_name\trow_count\n');
  executable(bin, 'createdb', 'exit 0');
  executable(bin, 'pg_restore', 'exit 9');
  executable(bin, 'dropdb', 'exit 8');

  const result = run('scripts/verify-postgres-backup.sh', {
    args: [dump],
    env: {
      ADMIN_DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/postgres',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /database deletion failed/);
});

test('post-migration verifier supports the current rollout from the pre-agent baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-agent-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  writeFileSync(
    before,
    'table_name\trow_count\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDungeonMasterScenario\t3\n_prisma_migrations\t6\n',
  );
  executable(
    bin,
    'psql',
    `printf 'table_name\\trow_count\\nActionOutbox\\t0\\nActionProposal\\t0\\nAgentClient\\t0\\nAgentCredential\\t0\\nAgentIdempotencyRecord\\t0\\nApprovalGrant\\t0\\nCalendarEvent\\t0\\nCalendarSource\\t0\\nCalendarWatch\\t0\\nCityStay\\t0\\nContact\\t106\\nContactEnrichmentCandidate\\t0\\nDMSceneResponse\\t2\\nDMSession\\t1\\nDerivedVisit\\t0\\nDiscoveredEvent\\t0\\nDungeonMasterScenario\\t3\\nEventCatalogFollow\\t0\\nEventCatalogListing\\t49\\nEventPreference\\t0\\nEventSource\\t0\\nGoogleCalendarConnection\\t0\\nGoogleOAuthAttempt\\t0\\nHumanIdempotencyRecord\\t0\\nInteractionReceipt\\t0\\nLocationAlias\\t0\\nLocationDevice\\t0\\nLocationSample\\t0\\nMutationAuditEvent\\t0\\nPersonalDataDeletionAudit\\t0\\n_prisma_migrations\\t${expectedMigrationCount}\\n'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=4 new_empty_tables=25 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier supports a seven-migration upgrade and preserves counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-agent-noop-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const metadata =
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDungeonMasterScenario\t3\nMutationAuditEvent\t8\n_prisma_migrations\t7\n';
  writeFileSync(before, metadata);
  executable(
    bin,
    'psql',
    `printf 'table_name\\trow_count\\nActionOutbox\\t1\\nActionProposal\\t2\\nAgentClient\\t3\\nAgentCredential\\t3\\nAgentIdempotencyRecord\\t4\\nApprovalGrant\\t1\\nCalendarEvent\\t0\\nCalendarSource\\t0\\nCalendarWatch\\t0\\nCityStay\\t0\\nContact\\t106\\nContactEnrichmentCandidate\\t0\\nDMSceneResponse\\t2\\nDMSession\\t1\\nDerivedVisit\\t0\\nDiscoveredEvent\\t0\\nDungeonMasterScenario\\t3\\nEventCatalogFollow\\t0\\nEventCatalogListing\\t49\\nEventPreference\\t0\\nEventSource\\t0\\nGoogleCalendarConnection\\t0\\nGoogleOAuthAttempt\\t0\\nHumanIdempotencyRecord\\t0\\nInteractionReceipt\\t0\\nLocationAlias\\t0\\nLocationDevice\\t0\\nLocationSample\\t0\\nMutationAuditEvent\\t8\\nPersonalDataDeletionAudit\\t0\\n_prisma_migrations\\t${expectedMigrationCount}\\n'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=11 new_empty_tables=18 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier supports an eight-migration upgrade with event tables introduced empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-count-eight-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const beforeMetadata =
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDerivedVisit\t0\nDungeonMasterScenario\t3\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t8\n';
  writeFileSync(before, beforeMetadata);
  executable(
    bin,
    'psql',
    `printf 'table_name\\trow_count\\nActionOutbox\\t1\\nActionProposal\\t2\\nAgentClient\\t3\\nAgentCredential\\t3\\nAgentIdempotencyRecord\\t4\\nApprovalGrant\\t1\\nCalendarEvent\\t0\\nCalendarSource\\t0\\nCalendarWatch\\t0\\nCityStay\\t0\\nContact\\t106\\nContactEnrichmentCandidate\\t0\\nDMSceneResponse\\t2\\nDMSession\\t1\\nDerivedVisit\\t0\\nDiscoveredEvent\\t0\\nDungeonMasterScenario\\t3\\nEventCatalogFollow\\t0\\nEventCatalogListing\\t49\\nEventPreference\\t0\\nEventSource\\t0\\nGoogleCalendarConnection\\t0\\nGoogleOAuthAttempt\\t0\\nHumanIdempotencyRecord\\t0\\nInteractionReceipt\\t0\\nLocationAlias\\t0\\nLocationDevice\\t0\\nLocationSample\\t0\\nMutationAuditEvent\\t8\\nPersonalDataDeletionAudit\\t0\\n_prisma_migrations\\t${expectedMigrationCount}\\n'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=22 new_empty_tables=7 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier supports a nine-migration upgrade before event-brief snapshots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-count-nine-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const metadata =
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDerivedVisit\t0\nDiscoveredEvent\t0\nDungeonMasterScenario\t3\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t9\n';
  const afterMetadata =
    `table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nContactEnrichmentCandidate\t0\nDMSceneResponse\t2\nDMSession\t1\nDerivedVisit\t0\nDiscoveredEvent\t0\nDungeonMasterScenario\t3\nEventCatalogFollow\t0\nEventCatalogListing\t49\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nHumanIdempotencyRecord\t0\nInteractionReceipt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t${expectedMigrationCount}\n`;
  writeFileSync(before, metadata);
  executable(
    bin,
    'psql',
    `printf '${afterMetadata.replaceAll('\n', '\\n')}'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=25 new_empty_tables=4 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier preserves human idempotency rows current-to-current', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-current-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const metadata =
    `table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nContactEnrichmentCandidate\t0\nDMSceneResponse\t2\nDMSession\t1\nDerivedVisit\t0\nDiscoveredEvent\t0\nDungeonMasterScenario\t3\nEventCatalogFollow\t0\nEventCatalogListing\t49\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nHumanIdempotencyRecord\t3\nInteractionReceipt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t${expectedMigrationCount}\n`;
  writeFileSync(before, metadata);
  executable(bin, 'psql', `printf '${metadata.replaceAll('\n', '\\n')}'`);

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=30 new_empty_tables=0 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier supports an eleven-migration upgrade with receipts and follows empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-receipt-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const argsLog = join(dir, 'psql-args.log');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const metadata =
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDerivedVisit\t0\nDiscoveredEvent\t0\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nHumanIdempotencyRecord\t3\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t11\n';
  writeFileSync(before, metadata);
  executable(
    bin,
    'psql',
    `printf '%s\\n' "$*" > '${argsLog}'\nprintf '${metadata.replace('_prisma_migrations\t11', `ContactEnrichmentCandidate\t0\nEventCatalogFollow\t0\nEventCatalogListing\t49\nInteractionReceipt\t0\n_prisma_migrations\t${expectedMigrationCount}`).replaceAll('\n', '\\n')}'`,
  );
  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`new_empty_tables=3 migrations=${expectedMigrationCount}`));
  assert.doesNotMatch(result.stdout + result.stderr, /secret-user|secret-password/);
  assert.doesNotMatch(readFileSync(argsLog, 'utf8'), /secret-user|secret-password/);
});

const migrationTwelveMetadata =
  'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDerivedVisit\t0\nDiscoveredEvent\t0\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nHumanIdempotencyRecord\t3\nInteractionReceipt\t4\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t12\n';

function runEventCatalogCountVerification(
  afterCatalogRows,
  candidateRows = 0,
  includeCandidateTable = true,
) {
  const dir = mkdtempSync(join(tmpdir(), 'socos-event-catalog-count-test-'));
  const bin = join(dir, 'bin');
  const before = join(dir, 'before.tsv');
  execFileSync('mkdir', ['-p', bin]);
  writeFileSync(before, migrationTwelveMetadata);
  executable(
    bin,
    'psql',
    `printf '${migrationTwelveMetadata
      .replace(
        '_prisma_migrations\t12\n',
        `${afterCatalogRows}${includeCandidateTable ? `ContactEnrichmentCandidate\t${candidateRows}\n` : ''}_prisma_migrations\t${currentMigrationCount}\n`,
      )
      .replaceAll('\n', '\\n')}'`,
  );
  return run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
}

test('post-migration verifier accepts the current migration baseline', () => {
  assert.equal(currentMigrationCount, 20);
  assert.equal(currentMigrationNames[14], '20260718200000_contact_enrichment');
  assert.equal(currentMigrationNames[15], '20260718210000_google_calendar_multi_account');
  assert.equal(currentMigrationNames[18], '20260719120000_contact_social_link_correction');
  assert.equal(currentMigrationNames[19], '20260719123000_contact_social_link_correct_scope');

  const result = runEventCatalogCountVerification(
    'EventCatalogFollow\t0\nEventCatalogListing\t49\n',
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'migration_counts_status=preserved existing_tables=24 new_empty_tables=2 migrations=20',
  );
});

test('post-migration verifier rejects the wrong event catalog seed count', () => {
  const result = runEventCatalogCountVerification(
    'EventCatalogFollow\t0\nEventCatalogListing\t48\n',
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects event catalog follows introduced with rows', () => {
  const result = runEventCatalogCountVerification(
    'EventCatalogFollow\t1\nEventCatalogListing\t49\n',
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects missing event catalog rollout tables', () => {
  const result = runEventCatalogCountVerification('EventCatalogListing\t49\n');

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects contact enrichment candidates introduced with rows', () => {
  const result = runEventCatalogCountVerification(
    'EventCatalogFollow\t0\nEventCatalogListing\t49\n',
    1,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects a missing contact enrichment rollout table', () => {
  const result = runEventCatalogCountVerification(
    'EventCatalogFollow\t0\nEventCatalogListing\t49\n',
    0,
    false,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier preserves existing event catalog counts at the current baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-current-event-catalog-count-test-'));
  const bin = join(dir, 'bin');
  const before = join(dir, 'before.tsv');
  execFileSync('mkdir', ['-p', bin]);
  const metadata = migrationTwelveMetadata
    .replace(
      '_prisma_migrations\t12\n',
      'EventCatalogFollow\t2\nEventCatalogListing\t9\n_prisma_migrations\t13\n',
    );
  writeFileSync(before, metadata);
  const afterMetadata = metadata
    .replace('EventCatalogListing\t9', 'EventCatalogListing\t52')
    .replace(
      '_prisma_migrations\t13',
      `ContactEnrichmentCandidate\t0\n_prisma_migrations\t${currentMigrationCount}`,
    );
  executable(bin, 'psql', `printf '${afterMetadata.replaceAll('\n', '\\n')}'`);

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'migration_counts_status=preserved existing_tables=26 new_empty_tables=1 migrations=20',
  );
});

test('post-migration verifier gives psql only the configured libpq environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-migration-environment-test-'));
  const bin = join(dir, 'bin');
  const before = join(dir, 'before.tsv');
  const callLog = join(dir, 'psql-call.json');
  execFileSync('mkdir', ['-p', bin]);
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  const metadata =
    `table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nContactEnrichmentCandidate\t0\nDerivedVisit\t0\nDiscoveredEvent\t0\nEventCatalogFollow\t0\nEventCatalogListing\t49\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nHumanIdempotencyRecord\t3\nInteractionReceipt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t8\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t${expectedMigrationCount}\n`;
  writeFileSync(before, metadata);
  const psql = join(bin, 'psql');
  writeFileSync(
    psql,
    `#!${process.execPath}\nconst fs = require('node:fs');
const allowed = new Set([
  'PATH', 'HOME', 'LANG', 'LC_ALL',
  '__CF_USER_TEXT_ENCODING',
  'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
  'PGSSLMODE', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT', 'PGSSLCRL',
  'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGOPTIONS',
]);
fs.writeFileSync('${callLog}', JSON.stringify({
  args: process.argv.slice(2),
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  hasPassword: process.env.PGPASSWORD === 'secret-password',
  database: process.env.PGDATABASE,
  sslmode: process.env.PGSSLMODE,
  appname: process.env.PGAPPNAME,
  optional: Object.fromEntries([
    'PGSSLMODE', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT', 'PGSSLCRL',
    'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGOPTIONS',
  ].map((key) => [key, process.env[key]])),
  hasBaseEnvironment: ['PATH', 'HOME', 'LANG', 'LC_ALL']
    .every((key) => typeof process.env[key] === 'string' && process.env[key] !== ''),
  hasDatabaseUrl: Object.hasOwn(process.env, 'DATABASE_URL'),
  unexpectedKeys: Object.keys(process.env).filter((key) => !allowed.has(key)).sort(),
}));
process.stdout.write(${JSON.stringify(metadata)});`,
  );
  chmodSync(psql, 0o755);

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      PGHOST: 'database.internal',
      PGPORT: '6543',
      PGUSER: 'secret-user',
      PGPASSWORD: 'secret-password',
      PGDATABASE: 'socos_release_gate_restore',
      PGSSLMODE: 'require',
      PGSSLCERT: '/tls/client.crt',
      PGSSLKEY: '/tls/client.key',
      PGSSLROOTCERT: '/tls/root.crt',
      PGSSLCRL: '/tls/root.crl',
      PGCONNECT_TIMEOUT: '15',
      PGAPPNAME: 'release-invariants',
      PGOPTIONS: '-c statement_timeout=30000',
      DATABASE_URL: 'postgresql://decoy-user:decoy-password@decoy.invalid/wrong',
      UNRELATED_SECRET: 'must-not-reach-psql',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=27 new_empty_tables=0 migrations=${expectedMigrationCount}`,
  );
  const call = JSON.parse(readFileSync(callLog, 'utf8'));
  assert.equal(call.host, 'database.internal');
  assert.equal(call.port, '6543');
  assert.equal(call.user, 'secret-user');
  assert.equal(call.hasPassword, true);
  assert.equal(call.database, 'socos_release_gate_restore');
  assert.equal(call.sslmode, 'require');
  assert.equal(call.appname, 'release-invariants');
  assert.deepEqual(call.optional, {
    PGSSLMODE: 'require',
    PGSSLCERT: '/tls/client.crt',
    PGSSLKEY: '/tls/client.key',
    PGSSLROOTCERT: '/tls/root.crt',
    PGSSLCRL: '/tls/root.crl',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'release-invariants',
    PGOPTIONS: '-c statement_timeout=30000',
  });
  assert.equal(call.hasBaseEnvironment, true);
  assert.equal(call.hasDatabaseUrl, false);
  assert.deepEqual(call.unexpectedKeys, []);
  assert.doesNotMatch(JSON.stringify(call.args), /postgres(?:ql)?:\/\/|secret-password/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-password|decoy-password/);
});

test('post-migration verifier requires human idempotency metadata at the current baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-current-human-idempotency-test-'));
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  writeFileSync(
    before,
    `table_name\trow_count\nActionOutbox\t0\nActionProposal\t0\nAgentClient\t0\nAgentCredential\t0\nAgentIdempotencyRecord\t0\nApprovalGrant\t0\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t1\nDerivedVisit\t0\nDiscoveredEvent\t0\nEventPreference\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t0\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t${expectedMigrationCount}\n`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /human-idempotency tables/);
});

test('post-migration verifier requires contact enrichment candidates at the current baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-current-contact-enrichment-test-'));
  const before = join(dir, 'before.tsv');
  const metadata = migrationTwelveMetadata.replace(
    '_prisma_migrations\t12\n',
    `EventCatalogFollow\t0\nEventCatalogListing\t49\n_prisma_migrations\t${currentMigrationCount}\n`,
  );
  writeFileSync(before, metadata);

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /contact-enrichment tables/);
});

test('post-migration verifier derives migration count and allows calendar location event tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-calendar-event-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const expectedMigrationCount = readdirSync(resolve(root, 'services/api/prisma/migrations'))
    .filter((name) => existsSync(resolve(root, 'services/api/prisma/migrations', name, 'migration.sql')))
    .length;
  writeFileSync(
    before,
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDungeonMasterScenario\t3\nMutationAuditEvent\t8\n_prisma_migrations\t7\n',
  );
  executable(
    bin,
    'psql',
    `printf 'table_name\\trow_count\\nActionOutbox\\t1\\nActionProposal\\t2\\nAgentClient\\t3\\nAgentCredential\\t3\\nAgentIdempotencyRecord\\t4\\nApprovalGrant\\t1\\nCalendarEvent\\t0\\nCalendarSource\\t0\\nCalendarWatch\\t0\\nCityStay\\t0\\nContact\\t106\\nContactEnrichmentCandidate\\t0\\nDMSceneResponse\\t2\\nDMSession\\t1\\nDerivedVisit\\t0\\nDiscoveredEvent\\t0\\nDungeonMasterScenario\\t3\\nEventCatalogFollow\\t0\\nEventCatalogListing\\t49\\nEventPreference\\t0\\nEventSource\\t0\\nGoogleCalendarConnection\\t0\\nGoogleOAuthAttempt\\t0\\nHumanIdempotencyRecord\\t0\\nInteractionReceipt\\t0\\nLocationAlias\\t0\\nLocationDevice\\t0\\nLocationSample\\t0\\nMutationAuditEvent\\t8\\nPersonalDataDeletionAudit\\t0\\n_prisma_migrations\\t${expectedMigrationCount}\\n'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `migration_counts_status=preserved existing_tables=11 new_empty_tables=18 migrations=${expectedMigrationCount}`,
  );
});

test('post-migration verifier rejects nonzero introduced calendar location event tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-calendar-event-nonzero-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  writeFileSync(
    before,
    'table_name\trow_count\nActionOutbox\t0\nActionProposal\t0\nAgentClient\t0\nAgentCredential\t0\nAgentIdempotencyRecord\t0\nApprovalGrant\t0\nContact\t1\nMutationAuditEvent\t0\n_prisma_migrations\t7\n',
  );
  executable(
    bin,
    'psql',
    "printf 'table_name\\trow_count\\nActionOutbox\\t0\\nActionProposal\\t0\\nAgentClient\\t0\\nAgentCredential\\t0\\nAgentIdempotencyRecord\\t0\\nApprovalGrant\\t0\\nCalendarEvent\\t1\\nContact\\t1\\nMutationAuditEvent\\t0\\n_prisma_migrations\\t10\\n'",
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects unexpected post-migration tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-unexpected-table-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const metadata = migrationTwelveMetadata.replace(
    '_prisma_migrations\t12\n',
    'ContactEnrichmentCandidate\t0\nEventCatalogFollow\t0\nEventCatalogListing\t49\n_prisma_migrations\t15\n',
  );
  writeFileSync(before, metadata);
  executable(
    bin,
    'psql',
    `printf '${metadata
      .replace(
        '_prisma_migrations\t15',
        `UnexpectedPersonalTable\t0\n_prisma_migrations\t${currentMigrationCount}`,
      )
      .replaceAll('\n', '\\n')}'`,
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      ...backupPgEnvironment,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Post-migration aggregate verification failed/);
});

test('post-migration verifier rejects metadata without migration history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-missing-history-test-'));
  const before = join(dir, 'before.tsv');
  writeFileSync(before, 'table_name\trow_count\nContact\t106\n');

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /migration history/i);
});

test('post-migration verifier rejects count-eight metadata missing calendar-location tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-missing-calendar-location-metadata-test-'));
  const before = join(dir, 'before.tsv');
  writeFileSync(
    before,
    'table_name\trow_count\nActionOutbox\t0\nActionProposal\t0\nAgentClient\t0\nAgentCredential\t0\nAgentIdempotencyRecord\t0\nApprovalGrant\t0\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDerivedVisit\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nLocationAlias\t0\nLocationDevice\t0\nMutationAuditEvent\t0\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t8\n',
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /calendar-location tables/i);
});

test('post-migration verifier rejects count-nine metadata missing event-discovery tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-missing-event-metadata-test-'));
  const before = join(dir, 'before.tsv');
  writeFileSync(
    before,
    'table_name\trow_count\nActionOutbox\t0\nActionProposal\t0\nAgentClient\t0\nAgentCredential\t0\nAgentIdempotencyRecord\t0\nApprovalGrant\t0\nCalendarEvent\t0\nCalendarSource\t0\nCalendarWatch\t0\nCityStay\t0\nContact\t106\nDerivedVisit\t0\nDiscoveredEvent\t0\nEventSource\t0\nGoogleCalendarConnection\t0\nGoogleOAuthAttempt\t0\nLocationAlias\t0\nLocationDevice\t0\nLocationSample\t0\nMutationAuditEvent\t0\nPersonalDataDeletionAudit\t0\n_prisma_migrations\t9\n',
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /event-discovery tables/i);
});

test('post-migration verifier rejects count-seven metadata missing an agent table', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-incomplete-agent-metadata-test-'));
  const before = join(dir, 'before.tsv');
  writeFileSync(
    before,
    'table_name\trow_count\nActionProposal\t0\nAgentClient\t0\nAgentCredential\t0\nAgentIdempotencyRecord\t0\nApprovalGrant\t0\nContact\t106\nMutationAuditEvent\t0\n_prisma_migrations\t7\n',
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { ...backupPgEnvironment },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /agent-interface tables/i);
});

test('contact provenance migration is forward-only and owner-scoped', () => {
  const migration = resolve(
    root,
    'services/api/prisma/migrations/20260716120000_add_contact_provenance/migration.sql',
  );
  assert.equal(existsSync(migration), true, 'contact provenance migration is missing');
  const sql = readFileSync(migration, 'utf8');

  assert.match(sql, /ADD COLUMN "groups" TEXT\[\]/);
  assert.match(sql, /ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN "sourceSystem" TEXT/);
  assert.match(sql, /ADD COLUMN "sourceId" TEXT/);
  assert.match(sql, /ADD CONSTRAINT "Contact_source_pair_check" CHECK/);
  assert.match(sql, /CREATE UNIQUE INDEX "Contact_ownerId_sourceSystem_sourceId_key"/);
  assert.match(sql, /CREATE INDEX "Contact_ownerId_isDemo_idx"/);
  assert.doesNotMatch(sql, /UPDATE\s+"Contact"\s+SET\s+"isDemo"/i);
});

test('schema comparison rejects an unexpected Contact column without printing SQL or credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-schema-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const argsLog = join(dir, 'args.log');
  executable(bin, 'pnpm', `printf '%s\\n' "$*" > '${argsLog}'\nprintf '%s\\n' 'ALTER TABLE \"Contact\" ADD COLUMN \"unexpectedContactColumn\" TEXT;'`);

  const result = run('scripts/compare-schema.mjs', {
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout.trim(), 'schema_status=drift statements=1');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ALTER TABLE|secret-user|secret-password/);
  assert.doesNotMatch(readFileSync(argsLog, 'utf8'), /secret-user|secret-password|--from-url/);
  assert.match(readFileSync(argsLog, 'utf8'), /--from-schema-datasource/);
});

test('schema comparison succeeds when Prisma emits an empty migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-schema-empty-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  executable(bin, 'pnpm', "printf '%s\\n' '-- This is an empty migration.'");

  const result = run('scripts/compare-schema.mjs', {
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'schema_status=match statements=0');
});

test('applied migration baselines remain byte-for-byte unchanged', () => {
  const migrations = [
    [
      'services/api/prisma/migrations/20260327000000_initial_schema/migration.sql',
      '54bc51c615dcf13983aba12e9c88fecd142774a35fc2b1174298c68df7010701',
    ],
    [
      'services/api/prisma/migrations/20260331000000_add_celebrations/migration.sql',
      '3c907065378ea6d9a3464ccf21d7e8c025d0327e402f1bb566daba2e268585ce',
    ],
  ];

  for (const [path, expectedHash] of migrations) {
    const hash = execFileSync('shasum', ['-a', '256', resolve(root, path)], {
      encoding: 'utf8',
    }).split(' ')[0];
    assert.equal(hash, expectedHash, `${path} must never be edited after it has been applied`);
  }
});

test('forward-only reconciliation and migration-only startup are present', () => {
  const migration = resolve(
    root,
    'services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql',
  );
  assert.equal(existsSync(migration), true, 'forward-only reconciliation migration is missing');
  const migrationSql = readFileSync(migration, 'utf8');
  assert.match(migrationSql, /^BEGIN;\n/);
  assert.match(migrationSql, /Refusing to convert a populated legacy schema/);
  assert.match(migrationSql, /\nCOMMIT;\s*$/);

  const startup = readFileSync(resolve(root, 'services/api/start.sh'), 'utf8');
  assert.match(startup, /^#!\/bin\/sh\nset -eu\n/);
  assert.match(startup, /prisma migrate deploy/);
  assert.doesNotMatch(startup, /db push|accept-data-loss/);
  assert.match(startup, /exec node dist\/main\.js/);
});

test('off-host backup replication requires encryption-aware verification', () => {
  const script = readFileSync(resolve(root, 'scripts/offsite-backup.sh'), 'utf8');

  assert.match(script, /: "\$\{SOURCE_DIR:\?SOURCE_DIR is required\}"/);
  assert.match(script, /: "\$\{RCLONE_REMOTE:\?RCLONE_REMOTE is required\}"/);
  assert.match(script, /rclone copy/);
  assert.match(script, /rclone dedupe/);
  assert.match(script, /rclone cryptcheck/);
  assert.match(script, /--one-way/);
  assert.match(script, /rclone delete/);
  assert.match(script, /--include '\*\.dmp'/);
  assert.match(script, /--include '\*\.dump'/);
  assert.match(script, /--include '\*\.dump\.sha256'/);
  assert.match(script, /--include '\*\.dump\.metadata\.tsv'/);
  assert.match(
    script,
    /rclone copy[\s\S]*?--include '\*\.dump'[\s\S]*?--include '\*\.dump\.sha256'[\s\S]*?--include '\*\.dump\.metadata\.tsv'/,
  );
  assert.match(
    script,
    /rclone cryptcheck[\s\S]*?--include '\*\.dump'[\s\S]*?--include '\*\.dump\.sha256'[\s\S]*?--include '\*\.dump\.metadata\.tsv'/,
  );
  assert.match(
    script,
    /deletefile "\$RCLONE_REMOTE\/\$old_dump\.metadata\.tsv"[\s\S]*deletefile "\$RCLONE_REMOTE\/\$old_dump\.sha256"[\s\S]*deletefile "\$RCLONE_REMOTE\/\$old_dump"/,
  );
  assert.doesNotMatch(script, /password|token|access_key|secret_key/i);
});

function prepareOffsiteTest({
  backend = 'crypt',
  cryptcheckFails = false,
  extension = 'dmp',
  incompleteBundle = false,
  sidecarsOnly = false,
  remoteExpiredBundle = false,
  stale = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'socos-offsite-test-'));
  const bin = join(dir, 'bin');
  const source = join(dir, 'source');
  const log = join(dir, 'rclone.log');
  execFileSync('mkdir', ['-p', bin, source]);
  const dump = join(source, `backup.${extension}`);
  if (!sidecarsOnly) writeFileSync(dump, 'encrypted-offsite-fixture');
  if (extension === 'dump') {
    writeFileSync(`${dump}.sha256`, 'synthetic-checksum');
    if (!incompleteBundle) writeFileSync(`${dump}.metadata.tsv`, 'table_name\trow_count\n');
  }
  const age = stale ? 48 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const modified = new Date(Date.now() - age);
  for (const file of readdirSync(source)) utimesSync(join(source, file), modified, modified);
  executable(
    bin,
    'rclone',
    `printf '%s\\n' "$1" >> '${log}'
case "$1" in
  config) printf '[synthetic]\\ntype = ${backend}\\n' ;;
  cryptcheck) [ "${cryptcheckFails ? '1' : '0'}" = 0 ] ;;
  lsf) case "$*" in
    *--min-age*) if [ "${remoteExpiredBundle ? '1' : '0'}" = 1 ]; then printf 'expired.dump\\n'; fi ;;
    *) printf 'backup.dmp\\n' ;;
  esac ;;
esac`,
  );
  return { bin, source, log };
}

test('off-host backup rejects a plain remote before upload', () => {
  const fixture = prepareOffsiteTest({ backend: 'drive' });
  const result = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: fixture.source,
      RCLONE_REMOTE: 'plain-drive:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(fixture.log, 'utf8'), 'config\n');
});

test('off-host backup verifies before scoped retention', () => {
  const fixture = prepareOffsiteTest();
  const result = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: fixture.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(fixture.log, 'utf8').trim().split('\n'), [
    'config', 'mkdir', 'dedupe', 'copy', 'copy', 'dedupe', 'cryptcheck', 'cryptcheck',
    'delete', 'lsf', 'rmdirs', 'lsf',
  ]);
  assert.match(result.stdout, /offsite_backup_status=verified/);
});

test('off-host backup replicates an independently created dump artifact', () => {
  const fixture = prepareOffsiteTest({ extension: 'dump' });
  const result = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: fixture.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /offsite_backup_status=verified/);
});

test('off-host backup rejects incomplete dump bundles and orphaned sidecars', () => {
  for (const fixture of [
    prepareOffsiteTest({ extension: 'dump', incompleteBundle: true }),
    prepareOffsiteTest({ extension: 'dump', sidecarsOnly: true }),
  ]) {
    const result = run('scripts/offsite-backup.sh', {
      env: {
        SOURCE_DIR: fixture.source,
        RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
        MIN_SOURCE_AGE_MINUTES: '1',
        MAX_SOURCE_AGE_MINUTES: '120',
        PATH: `${fixture.bin}:${process.env.PATH}`,
      },
    });

    assert.equal(result.status, 67);
    assert.equal(existsSync(fixture.log), false);
  }
});

test('off-host backup rejects invalid dump artifacts beside a valid Coolify dump', () => {
  const fixture = prepareOffsiteTest();
  const incomplete = join(fixture.source, 'incomplete.dump');
  writeFileSync(incomplete, 'incomplete');
  writeFileSync(`${incomplete}.sha256`, 'checksum-only');
  const result = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: fixture.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 67);
  assert.equal(existsSync(fixture.log), false);
});

test('off-host backup rejects each orphan sidecar form before rclone', () => {
  for (const suffix of ['.dump.sha256', '.dump.metadata.tsv']) {
    const fixture = prepareOffsiteTest();
    writeFileSync(join(fixture.source, `orphan${suffix}`), 'orphan');
    const result = run('scripts/offsite-backup.sh', {
      env: {
        SOURCE_DIR: fixture.source,
        RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
        MIN_SOURCE_AGE_MINUTES: '1',
        MAX_SOURCE_AGE_MINUTES: '120',
        PATH: `${fixture.bin}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 67);
    assert.equal(existsSync(fixture.log), false);
  }
});

test('off-host backup expires remote bundles with a Coolify-only local source', () => {
  const fixture = prepareOffsiteTest({ remoteExpiredBundle: true });
  const result = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: fixture.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(fixture.log, 'utf8').trim().split('\n');
  assert.equal(commands.filter((command) => command === 'deletefile').length, 3);
});

test('off-host backup skips retention on stale source or failed verification', () => {
  const stale = prepareOffsiteTest({ stale: true });
  const staleResult = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: stale.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${stale.bin}:${process.env.PATH}`,
    },
  });
  assert.notEqual(staleResult.status, 0);
  assert.equal(existsSync(stale.log), false);

  const failed = prepareOffsiteTest({ cryptcheckFails: true });
  const failedResult = run('scripts/offsite-backup.sh', {
    env: {
      SOURCE_DIR: failed.source,
      RCLONE_REMOTE: 'encrypted:socos-postgres-backups',
      MIN_SOURCE_AGE_MINUTES: '1',
      MAX_SOURCE_AGE_MINUTES: '120',
      PATH: `${failed.bin}:${process.env.PATH}`,
    },
  });
  assert.notEqual(failedResult.status, 0);
  const commands = readFileSync(failed.log, 'utf8').trim().split('\n');
  assert.equal(commands.includes('delete'), false);
  assert.equal(commands.at(-1), 'cryptcheck');
});

test('production compose uses only the external Coolify database', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.prod.yml'), 'utf8');
  assert.doesNotMatch(compose, /^  db:\s*$/m);
  assert.doesNotMatch(compose, /^    depends_on:\s*$/m);
  assert.match(compose, /DATABASE_URL=\$\{DATABASE_URL:\?DATABASE_URL is required\}/);
});
