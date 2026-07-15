import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
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
  execFileSync('mkdir', ['-p', bin]);
  executable(
    bin,
    'pg_dump',
    'case "$*" in *--snapshot=*) ;; *) exit 3;; esac; while [ "$#" -gt 0 ]; do if [ "$1" = "--file" ]; then shift; printf custom-dump > "$1"; exit; fi; shift; done; exit 2',
  );
  executable(
    bin,
    'psql',
    'if [ -n "${SOCOS_SNAPSHOT_FILE:-}" ]; then printf "00000003-0000001B-1" > "$SOCOS_SNAPSHOT_FILE"; : > "$SOCOS_SNAPSHOT_READY"; trap "exit 0" TERM; while :; do sleep 1; done; else case "$*" in *"SET TRANSACTION SNAPSHOT"*) printf "table_name\\trow_count\\nContact\\t106\\nInteraction\\t13\\n";; *) exit 4;; esac; fi',
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
});

test('backup never publishes partial artifacts when dump creation fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-backup-failure-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  executable(bin, 'pg_dump', 'exit 9');
  executable(
    bin,
    'psql',
    'printf "00000003-0000001B-1" > "$SOCOS_SNAPSHOT_FILE"; : > "$SOCOS_SNAPSHOT_READY"; trap "exit 0" TERM; while :; do sleep 1; done',
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

test('post-migration verifier preserves old counts and permits only known empty tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-post-migration-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  writeFileSync(before, 'table_name\trow_count\nContact\t106\nInteraction\t13\n');
  executable(
    bin,
    'psql',
    "printf 'table_name\\trow_count\\nContact\\t106\\nDMSceneResponse\\t0\\nDMSession\\t0\\nDungeonMasterScenario\\t0\\nInteraction\\t13\\n_prisma_migrations\\t3\\n'",
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
    'migration_counts_status=preserved existing_tables=2 new_empty_tables=3 migrations=3',
  );
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret-user|secret-password/);
});

test('post-migration verifier rejects changed rows and populated new tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-post-migration-failure-test-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  const before = join(dir, 'before.tsv');
  writeFileSync(before, 'table_name\trow_count\nContact\t106\nInteraction\t13\n');
  executable(
    bin,
    'psql',
    "printf 'table_name\\trow_count\\nContact\\t105\\nDMSceneResponse\\t1\\nDMSession\\t0\\nDungeonMasterScenario\\t0\\nInteraction\\t13\\n_prisma_migrations\\t3\\n'",
  );

  const result = run('scripts/verify-post-migration-counts.mjs', {
    args: [before],
    env: {
      DATABASE_URL: 'postgresql://secret-user:secret-password@example.invalid/socos',
      PATH: `${bin}:${process.env.PATH}`,
    },
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr.trim(), 'Post-migration aggregate verification failed.');
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

test('production compose uses only the external Coolify database', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.prod.yml'), 'utf8');
  assert.doesNotMatch(compose, /^  db:\s*$/m);
  assert.doesNotMatch(compose, /^    depends_on:\s*$/m);
  assert.match(compose, /DATABASE_URL=\$\{DATABASE_URL:\?DATABASE_URL is required\}/);
});
