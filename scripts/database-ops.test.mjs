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
  execFileSync('mkdir', ['-p', bin]);
  executable(
    bin,
    'pg_dump',
    'case "$*" in *--snapshot=*) ;; *) exit 3;; esac; while [ "$#" -gt 0 ]; do if [ "$1" = "--file" ]; then shift; printf custom-dump > "$1"; exit; fi; shift; done; exit 2',
  );
  nodeExecutable(
    bin,
    'psql',
    `const fs = require('node:fs');
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
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-user|secret-password/);
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
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
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
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      SNAPSHOT_CANCEL_GRACE_SECONDS: '0.05',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(signalLog, 'utf8'), 'INT\nTERM\n');
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

test('post-migration verifier supports the current agent-interface rollout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-agent-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  writeFileSync(
    before,
    'table_name\trow_count\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDungeonMasterScenario\t3\n_prisma_migrations\t6\n',
  );
  executable(
    bin,
    'psql',
    "printf 'table_name\\trow_count\\nActionOutbox\\t0\\nActionProposal\\t0\\nAgentClient\\t0\\nAgentCredential\\t0\\nAgentIdempotencyRecord\\t0\\nApprovalGrant\\t0\\nContact\\t106\\nDMSceneResponse\\t2\\nDMSession\\t1\\nDungeonMasterScenario\\t3\\nMutationAuditEvent\\t0\\n_prisma_migrations\\t7\\n'",
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'migration_counts_status=preserved existing_tables=4 new_empty_tables=7 migrations=7',
  );
});

test('post-migration verifier supports a seven-migration no-op and preserves counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-agent-noop-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  const metadata =
    'table_name\trow_count\nActionOutbox\t1\nActionProposal\t2\nAgentClient\t3\nAgentCredential\t3\nAgentIdempotencyRecord\t4\nApprovalGrant\t1\nContact\t106\nDMSceneResponse\t2\nDMSession\t1\nDungeonMasterScenario\t3\nMutationAuditEvent\t8\n_prisma_migrations\t7\n';
  writeFileSync(before, metadata);
  executable(bin, 'psql', `printf '${metadata.replaceAll('\n', '\\n')}'`);

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'migration_counts_status=preserved existing_tables=11 new_empty_tables=0 migrations=7',
  );
});

test('post-migration verifier rejects metadata without migration history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-missing-history-test-'));
  const before = join(dir, 'before.tsv');
  writeFileSync(before, 'table_name\trow_count\nContact\t106\n');

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: { DATABASE_URL: 'postgresql://example.invalid/socos' },
  });

  assert.equal(result.status, 65);
  assert.match(result.stderr, /migration history/i);
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
    env: { DATABASE_URL: 'postgresql://example.invalid/socos' },
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

test('schema comparison reports drift without printing migration SQL or credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-schema-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  executable(bin, 'pnpm', "printf '%s\\n' 'ALTER TABLE \\\"Contact\\\" ADD COLUMN \\\"bio\\\" TEXT;'");

  const result = run('scripts/compare-schema.mjs', {
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout.trim(), 'schema_status=drift statements=1');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ALTER TABLE|secret-user|secret-password/);
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
