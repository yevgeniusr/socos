import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  configFromEnvironment,
  GateFailure,
  publicFailureReceipt,
  requireExactCandidate,
  runGate,
  validateDatabaseBoundaryProofs,
  validateFreshBackup,
} from './cloud-restore-release-gate.mjs';
import { parseSuccessReceipt } from './run-cloud-restore-release-gate.mjs';

const root = resolve(import.meta.dirname, '..');
const candidate = '1234567890abcdef1234567890abcdef12345678';
const dumpSha = 'a'.repeat(64);
const successReceipt = {
  gate: 'socos-cloud-restore-release',
  version: 1,
  status: 'passed',
  candidate_sha: candidate,
  backup_execution_uuid: 'backup_execution_1',
  backup_size_bytes: '173187',
  dump_sha256: dumpSha,
  aggregate_tables: '26',
  schema_statements: '0',
  migration_counts: 'preserved',
  cleanup: 'verified',
};

function executable(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function waitForFile(path, timeoutMs = 15_000) {
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  while (performance.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail(`Timed out after ${timeoutMs}ms waiting for readiness marker: ${path}`);
}

test('local wrapper validates the candidate before invoking ssh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-local-invalid-'));
  const called = join(dir, 'called');
  executable(dir, 'ssh', `touch '${called}'`);

  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/run-cloud-restore-release-gate.mjs'), 'ABC'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
  );

  assert.equal(result.status, 64);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '{"gate":"socos-cloud-restore-release","version":1,"status":"failed","code":"invalid_candidate"}\n');
  assert.throws(() => readFileSync(called));
});

test('cloud forced command validates stdin before required secret configuration', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/cloud-restore-release-gate.mjs')],
    { encoding: 'utf8', input: 'NOT-A-SHA\n', env: { PATH: process.env.PATH } },
  );

  assert.equal(result.status, 64);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '{"gate":"socos-cloud-restore-release","version":1,"status":"failed","code":"invalid_candidate"}\n');
});

test('cloud forced command survives repeated termination signals and completes cleanup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-cloud-signal-'));
  const bin = join(dir, 'bin');
  const work = join(dir, 'work');
  const repository = join(dir, 'repository');
  const lock = join(dir, 'lock');
  const ready = join(dir, 'ready');
  spawnSync('mkdir', ['-p', bin, work, repository]);
  executable(bin, 'git', `touch '${ready}'; trap '' TERM; sleep 30`);
  const child = spawn(process.execPath, [resolve(root, 'scripts/cloud-restore-release-gate.mjs')], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      SOCOS_RELEASE_GATE_REPOSITORY: repository,
      SOCOS_RELEASE_GATE_WORK_ROOT: work,
      SOCOS_RELEASE_GATE_LOCK_DIR: lock,
      SOCOS_RELEASE_GATE_DATABASE_URL: 'postgresql://prod:one@db.internal/socos',
      SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL: 'postgresql://admin:two@db.internal/postgres',
      SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL: 'postgresql://restore:three@db.internal/postgres',
      SOCOS_RELEASE_GATE_CLUSTER_ID: '7493810472398012345',
      SOCOS_RELEASE_GATE_COOLIFY_BASE_URL: 'https://coolify.invalid',
      SOCOS_RELEASE_GATE_COOLIFY_TOKEN: 'token',
      SOCOS_RELEASE_GATE_DATABASE_UUID: 'database',
      SOCOS_RELEASE_GATE_BACKUP_UUID: 'backup',
      SOCOS_RELEASE_GATE_TERMINATION_GRACE_MS: '200',
      SOCOS_RELEASE_GATE_CLEANUP_TIMEOUT_MS: '500',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(`${candidate}\n`);
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  await waitForFile(ready);
  child.kill('SIGTERM');
  await new Promise((resolveSignal) => setTimeout(resolveSignal, 30));
  child.kill('SIGTERM');
  const code = await new Promise((resolveCode) => child.once('close', resolveCode));
  assert.equal(code, 1);
  assert.equal(stderr, '{"gate":"socos-cloud-restore-release","version":1,"status":"failed","code":"interrupted"}\n');
  assert.equal(existsSync(lock), false);
});

test('release configuration always rejects KEEP_RESTORE_DB', () => {
  assert.throws(() => configFromEnvironment({ KEEP_RESTORE_DB: '1' }), /invalid_configuration/);
});

test('candidate must equal the trusted origin/main head exactly', () => {
  assert.doesNotThrow(() => requireExactCandidate(candidate, `${candidate}\n`));
  assert.throws(() => requireExactCandidate(candidate, `${'b'.repeat(40)}\n`), /candidate_untrusted/);
});

test('configuration requires a cluster identity and three distinct database roles', () => {
  const base = {
    SOCOS_RELEASE_GATE_REPOSITORY: '/trusted/repo',
    SOCOS_RELEASE_GATE_WORK_ROOT: '/trusted/work',
    SOCOS_RELEASE_GATE_LOCK_DIR: '/trusted/lock',
    SOCOS_RELEASE_GATE_DATABASE_URL: 'postgresql://prod:one@db.internal/socos',
    SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL: 'postgresql://admin:two@db.internal/postgres',
    SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL: 'postgresql://restore:three@db.internal/postgres',
    SOCOS_RELEASE_GATE_CLUSTER_ID: '7493810472398012345',
    SOCOS_RELEASE_GATE_COOLIFY_BASE_URL: 'https://coolify.invalid',
    SOCOS_RELEASE_GATE_COOLIFY_TOKEN: 'token',
    SOCOS_RELEASE_GATE_DATABASE_UUID: 'database',
    SOCOS_RELEASE_GATE_BACKUP_UUID: 'backup',
  };
  assert.doesNotThrow(() => configFromEnvironment(base));
  assert.throws(
    () => configFromEnvironment({ ...base, SOCOS_RELEASE_GATE_CLUSTER_ID: undefined }),
    /invalid_configuration/,
  );
  assert.throws(
    () => configFromEnvironment({
      ...base,
      SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL: base.SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL,
    }),
    /invalid_configuration/,
  );
});

test('database boundary proof rejects a privileged restore role', () => {
  const config = {
    clusterId: '7493810472398012345',
    productionRole: 'socos_release_gate_read',
    productionDatabase: 'socos',
    adminRole: 'admin',
    adminDatabase: 'postgres',
    restoreRole: 'restore',
    restoreBaseDatabase: 'postgres',
  };
  const proof = {
    production: '7493810472398012345|socos_release_gate_read|socos|t\n',
    administration: '7493810472398012345|admin|postgres|f\n',
    restore: '7493810472398012345|restore|postgres|t|t\n',
    restoreProductionBlocked: true,
    productionTemplateBlocked: true,
  };
  assert.doesNotThrow(() => validateDatabaseBoundaryProofs(config, proof));
  assert.throws(
    () => validateDatabaseBoundaryProofs(config, { ...proof, restore: '7493810472398012345|restore|postgres|t|f\n' }),
    /invalid_configuration/,
  );
  assert.throws(
    () => validateDatabaseBoundaryProofs(config, { ...proof, productionTemplateBlocked: false }),
    /invalid_configuration/,
  );
  const gateSource = readFileSync(join(root, 'scripts/cloud-restore-release-gate.mjs'), 'utf8');
  assert.match(gateSource, /\.\.\.config\.productionPg, PGDATABASE: 'template1'/);
  assert.match(gateSource, /restoreProductionBlocked,\s+productionTemplateBlocked,/);
});

test('production boundary query proves current read access and rejects every durable write path', async () => {
  const { databaseBoundaryQueries } = await import('./cloud-restore-release-gate.mjs');
  assert.equal(typeof databaseBoundaryQueries, 'function');
  const queries = databaseBoundaryQueries({
    productionRole: 'socos_release_gate_read',
    productionDatabase: 'socos',
    adminRole: 'socos_release_gate_admin',
    adminDatabase: 'postgres',
    restoreRole: 'socos_release_gate_restore',
    restoreBaseDatabase: 'postgres',
  });
  const production = queries.production;
  assert.match(production, /NOT EXISTS \(SELECT 1 FROM pg_roles inherited WHERE inherited\.rolname <> current_user AND pg_has_role\(current_user, inherited\.rolname, 'MEMBER'\)\)/);
  assert.doesNotMatch(production, /inherited\.rolsuper/);
  assert.match(production, /NOT has_database_privilege\(current_user,current_database\(\),'TEMPORARY'\)/);
  assert.match(production, /NOT has_database_privilege\(current_user,'template1','CONNECT'\)/);
  assert.match(production, /has_schema_privilege\(current_user,'public','USAGE'\)/);
  assert.match(production, /pg_proc p JOIN pg_namespace n ON n\.oid=p\.pronamespace/);
  assert.match(production, /has_function_privilege\(current_user,p\.oid,'EXECUTE'\)/);
  assert.match(production, /c\.relkind IN \('r','p','v','m','f'\)/);
  assert.match(production, /NOT has_table_privilege\(current_user,c\.oid,'SELECT'\)/);
  assert.match(production, /has_any_column_privilege\(current_user,c\.oid,'INSERT'\)/);
  assert.match(production, /has_any_column_privilege\(current_user,c\.oid,'UPDATE'\)/);
  assert.match(production, /has_any_column_privilege\(current_user,c\.oid,'REFERENCES'\)/);
  assert.match(production, /c\.relkind='S'.*has_sequence_privilege\(current_user,c\.oid,'USAGE'\)/);
  assert.match(production, /c\.relkind='S'.*has_sequence_privilege\(current_user,c\.oid,'UPDATE'\)/);
  assert.match(production, /c\.relkind='S'.*NOT has_sequence_privilege\(current_user,c\.oid,'SELECT'\)/);
});

test('local wrapper uses only the fixed BatchMode ssh host and sends the SHA on stdin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-local-success-'));
  const args = join(dir, 'args');
  const input = join(dir, 'input');
  executable(
    dir,
    'ssh',
    `printf '%s\\n' "$@" > '${args}'\ncat > '${input}'\nprintf '%s\\n' '${JSON.stringify(successReceipt)}'`,
  );

  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/run-cloud-restore-release-gate.mjs'), candidate],
    { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(args, 'utf8').trim().split('\n'), [
    '-o',
    'BatchMode=yes',
    '-o',
    'RequestTTY=no',
    '--',
    'socos-release-gate',
  ]);
  assert.equal(readFileSync(input, 'utf8'), `${candidate}\n`);
  assert.equal(result.stdout, `${JSON.stringify(successReceipt)}\n`);
  assert.equal(result.stderr, '');
});

test('local wrapper terminates a timed-out ssh process and emits only a fixed failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-local-timeout-'));
  executable(dir, 'ssh', "trap 'exit 0' TERM; cat >/dev/null; sleep 30");
  const child = spawn(
    process.execPath,
    [resolve(root, 'scripts/run-cloud-restore-release-gate.mjs'), candidate],
    {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        SOCOS_RELEASE_GATE_SSH_TIMEOUT_MS: '50',
        SOCOS_RELEASE_GATE_TERMINATION_GRACE_MS: '20',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolveCode) => child.once('close', resolveCode));
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, '{"gate":"socos-cloud-restore-release","version":1,"status":"failed","code":"ssh_timeout"}\n');
});

test('local wrapper handles an actual termination signal with a fixed receipt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-local-signal-'));
  const ready = join(dir, 'ready');
  executable(dir, 'ssh', `touch '${ready}'; trap 'exit 0' TERM; cat >/dev/null; sleep 30`);
  const child = spawn(process.execPath, [resolve(root, 'scripts/run-cloud-restore-release-gate.mjs'), candidate], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SOCOS_RELEASE_GATE_TERMINATION_GRACE_MS: '20' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  await waitForFile(ready);
  child.kill('SIGTERM');
  const code = await new Promise((resolveCode) => child.once('close', resolveCode));
  assert.equal(code, 70);
  assert.equal(stderr, '{"gate":"socos-cloud-restore-release","version":1,"status":"failed","code":"interrupted"}\n');
});

test('local wrapper rejects receipts with paths, extra fields, or a different SHA', () => {
  assert.throws(
    () => parseSuccessReceipt(`${JSON.stringify({ ...successReceipt, artifact_path: '/secret/dump' })}\n`, candidate),
    /invalid_receipt/,
  );
  assert.throws(
    () => parseSuccessReceipt(`${JSON.stringify({ ...successReceipt, candidate_sha: 'b'.repeat(40) })}\n`, candidate),
    /invalid_receipt/,
  );
});

test('fresh Coolify proof requires one exact new successful execution and positive decimal string size', () => {
  const startedAt = Date.parse('2026-07-17T01:00:00.000Z');
  assert.deepEqual(
    validateFreshBackup(
      [{ uuid: 'old', status: 'success', size: '1', created_at: '2026-07-16T00:00:00.000Z' }],
      [
        { uuid: 'old', status: 'success', size: '1', created_at: '2026-07-16T00:00:00.000Z' },
        {
          uuid: 'new_execution',
          status: 'success',
          size: '173187',
          created_at: '2026-07-17T01:00:01.000Z',
        },
      ],
      startedAt,
    ),
    { executionUuid: 'new_execution', sizeBytes: '173187' },
  );
  assert.throws(
    () => validateFreshBackup([], [{ uuid: 'new', status: 'success', size: 12, created_at: '2026-07-17T01:00:01.000Z' }], startedAt),
    /backup_invalid/,
  );
  assert.throws(
    () => validateFreshBackup([], [{ uuid: 'new', status: 'success', size: '0', created_at: '2026-07-17T01:00:01.000Z' }], startedAt),
    /backup_invalid/,
  );
  assert.deepEqual(
    validateFreshBackup(
      [],
      [{ uuid: 'same_second', status: 'success', size: '9', created_at: '2026-07-17T01:00:00.000Z' }],
      Date.parse('2026-07-17T01:00:00.900Z'),
    ),
    { executionUuid: 'same_second', sizeBytes: '9' },
  );
});

function fakeDependencies({ failAt } = {}) {
  const calls = [];
  const phase = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (failAt === name) throw new GateFailure(`${name}_failed`);
    return value;
  };
  return {
    calls,
    acquireLock: phase('acquireLock'),
    prepareWorkspace: phase('prepareWorkspace', { workspace: '/internal/work', worktree: '/internal/tree' }),
    verifyCandidate: phase('verifyCandidate'),
    createWorktree: phase('createWorktree'),
    verifyDatabaseBoundaries: phase('verifyDatabaseBoundaries'),
    proveFreshCoolifyBackup: phase('proveFreshCoolifyBackup', { executionUuid: 'backup_execution_1', sizeBytes: '173187' }),
    createIndependentBackup: phase('createIndependentBackup', { dumpFile: '/internal/dump', dumpSha256: dumpSha, tableCount: '26' }),
    reserveRestoreDatabase: phase('reserveRestoreDatabase', { databaseName: 'socos_release_gate_random', databaseUrl: 'postgresql://restricted.invalid/restore' }),
    createRestoreDatabase: phase('createRestoreDatabase'),
    restoreBackup: phase('restoreBackup'),
    migrateCandidate: phase('migrateCandidate'),
    validatePrisma: phase('validatePrisma'),
    verifyZeroDrift: phase('verifyZeroDrift'),
    verifyReleaseInvariants: phase('verifyReleaseInvariants'),
    dropRestoreDatabase: phase('dropRestoreDatabase'),
    removeWorktree: phase('removeWorktree'),
    removeWorkspace: phase('removeWorkspace'),
    releaseLock: phase('releaseLock'),
    cleanupTimeoutMs: 500,
  };
}

test('cloud gate binds every proof to the exact SHA and runs release checks in order', async () => {
  const deps = fakeDependencies();
  const receipt = await runGate(candidate, deps);

  assert.deepEqual(receipt, successReceipt);
  assert.deepEqual(deps.calls.map(([name]) => name), [
    'acquireLock',
    'prepareWorkspace',
    'verifyCandidate',
    'createWorktree',
    'verifyDatabaseBoundaries',
    'proveFreshCoolifyBackup',
    'createIndependentBackup',
    'reserveRestoreDatabase',
    'createRestoreDatabase',
    'restoreBackup',
    'migrateCandidate',
    'validatePrisma',
    'verifyZeroDrift',
    'verifyReleaseInvariants',
    'dropRestoreDatabase',
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
  for (const call of deps.calls.slice(2, 12)) assert.ok(call.includes(candidate), `${call[0]} was not SHA-bound`);
});

test('cloud gate fails closed on concurrency before creating any workspace', async () => {
  const deps = fakeDependencies({ failAt: 'acquireLock' });
  await assert.rejects(runGate(candidate, deps), /acquireLock_failed/);
  assert.deepEqual(deps.calls, [['acquireLock', candidate]]);
});

test('cloud gate drops the database and removes worktree and temp files after a failed invariant phase', async () => {
  const deps = fakeDependencies({ failAt: 'verifyReleaseInvariants' });
  await assert.rejects(runGate(candidate, deps), /verifyReleaseInvariants_failed/);
  assert.deepEqual(deps.calls.slice(-4).map(([name]) => name), [
    'dropRestoreDatabase',
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
});

test('cloud gate attempts drop after database creation has an uncertain failure', async () => {
  const deps = fakeDependencies({ failAt: 'createRestoreDatabase' });
  await assert.rejects(runGate(candidate, deps), /createRestoreDatabase_failed/);
  assert.deepEqual(deps.calls.slice(-4).map(([name]) => name), [
    'dropRestoreDatabase',
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
});

test('cloud gate attempts worktree cleanup when checkout verification fails', async () => {
  const deps = fakeDependencies({ failAt: 'createWorktree' });
  await assert.rejects(runGate(candidate, deps), /createWorktree_failed/);
  assert.deepEqual(deps.calls.slice(-3).map(([name]) => name), [
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
});

test('cloud gate cleanup is also guaranteed for interruption failures', async () => {
  const deps = fakeDependencies();
  const abortController = new AbortController();
  deps.migrateCandidate = async (...args) => {
    deps.calls.push(['migrateCandidate', ...args]);
    await new Promise((_, reject) => {
      abortController.signal.addEventListener(
        'abort',
        () => reject(new GateFailure('interrupted')),
        { once: true },
      );
      setTimeout(() => abortController.abort(), 10);
    });
  };
  await assert.rejects(runGate(candidate, deps), /interrupted/);
  assert.deepEqual(deps.calls.slice(-4).map(([name]) => name), [
    'dropRestoreDatabase',
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
});

test('cloud gate bounds a hung cleanup phase', async () => {
  const deps = fakeDependencies({ failAt: 'migrateCandidate' });
  deps.cleanupTimeoutMs = 30;
  deps.removeWorktree = async (...args) => {
    deps.calls.push(['removeWorktree', ...args]);
    await new Promise(() => {});
  };
  await assert.rejects(runGate(candidate, deps), /cleanup_failed/);
  assert.deepEqual(deps.calls.slice(-4).map(([name]) => name), [
    'dropRestoreDatabase',
    'removeWorktree',
    'removeWorkspace',
    'releaseLock',
  ]);
});

test('public failures use fixed codes and cannot expose raw child errors or paths', () => {
  const receipt = publicFailureReceipt(new Error('postgresql://secret@db /tmp/private.dump'));
  assert.deepEqual(receipt, {
    gate: 'socos-cloud-restore-release',
    version: 1,
    status: 'failed',
    code: 'internal_error',
  });
  assert.doesNotMatch(JSON.stringify(receipt), /secret|private|postgres|tmp/);
});
