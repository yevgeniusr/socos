#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATE = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const KNOWN_FAILURES = new Set([
  'invalid_candidate',
  'invalid_configuration',
  'busy',
  'candidate_untrusted',
  'worktree_failed',
  'coolify_request_failed',
  'backup_ambiguous',
  'backup_failed',
  'backup_invalid',
  'backup_timeout',
  'independent_backup_failed',
  'restore_create_failed',
  'restore_failed',
  'migration_failed',
  'prisma_validate_failed',
  'schema_drift',
  'release_invariants_failed',
  'cleanup_failed',
  'interrupted',
]);

export class GateFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function publicFailureReceipt(error) {
  const code = error instanceof GateFailure && KNOWN_FAILURES.has(error.code)
    ? error.code
    : 'internal_error';
  return { gate: 'socos-cloud-restore-release', version: 1, status: 'failed', code };
}

export function requireExactCandidate(candidateSha, trustedHead) {
  if (trustedHead !== `${candidateSha}\n`) throw new GateFailure('candidate_untrusted');
}

export function validateDatabaseBoundaryProofs(config, proof) {
  if (
    proof.production !== `${config.clusterId}|${config.productionRole}|${config.productionDatabase}|t\n`
    || proof.administration !== `${config.clusterId}|${config.adminRole}|${config.adminDatabase}|f\n`
    || proof.restore !== `${config.clusterId}|${config.restoreRole}|${config.restoreBaseDatabase}|t|t\n`
    || proof.restoreProductionBlocked !== true
    || proof.productionTemplateBlocked !== true
  ) throw new GateFailure('invalid_configuration');
}

export function databaseBoundaryQueries(config) {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const cluster = '(SELECT system_identifier::text FROM pg_control_system())';
  const roleSafe = `NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls`;
  const dangerousRoles = [
    config.productionRole,
    config.adminRole,
    'pg_execute_server_program',
    'pg_read_server_files',
    'pg_write_server_files',
    'pg_signal_backend',
    'pg_checkpoint',
  ].map(literal).join(',');
  const noMembership = `NOT EXISTS (SELECT 1 FROM pg_roles inherited WHERE inherited.rolname <> current_user AND pg_has_role(current_user, inherited.rolname, 'MEMBER'))`;
  const publicRelations = `FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`;
  const tableKinds = `c.relkind IN ('r','p','v','m','f')`;
  const noPublicWrites = `NOT EXISTS (SELECT 1 ${publicRelations} AND ${tableKinds} AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_table_privilege(current_user,c.oid,'TRIGGER') OR has_table_privilege(current_user,c.oid,'REFERENCES') OR has_any_column_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'UPDATE') OR has_any_column_privilege(current_user,c.oid,'REFERENCES')))`;
  const allPublicTablesReadable = `NOT EXISTS (SELECT 1 ${publicRelations} AND ${tableKinds} AND NOT has_table_privilege(current_user,c.oid,'SELECT'))`;
  const noPublicFunctionExecute = `NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege(current_user,p.oid,'EXECUTE'))`;
  const noSequenceWrites = `NOT EXISTS (SELECT 1 ${publicRelations} AND c.relkind='S' AND (has_sequence_privilege(current_user,c.oid,'USAGE') OR has_sequence_privilege(current_user,c.oid,'UPDATE')))`;
  const allSequencesReadable = `NOT EXISTS (SELECT 1 ${publicRelations} AND c.relkind='S' AND NOT has_sequence_privilege(current_user,c.oid,'SELECT'))`;
  return {
    production: `SELECT ${cluster}, current_user, current_database(), (${roleSafe} AND ${noMembership} AND NOT pg_has_role(current_user, ${literal(config.restoreRole)}, 'MEMBER') AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_database_privilege(current_user,current_database(),'TEMPORARY') AND NOT has_database_privilege(current_user,'template1','CONNECT') AND has_schema_privilege(current_user,'public','USAGE') AND NOT has_schema_privilege(current_user,'public','CREATE') AND ${noPublicWrites} AND ${noPublicFunctionExecute} AND ${noSequenceWrites} AND ${allPublicTablesReadable} AND ${allSequencesReadable}) FROM pg_roles r WHERE r.rolname=current_user;`,
    administration: `SELECT ${cluster}, current_user, current_database(), has_database_privilege(${literal(config.restoreRole)}, ${literal(config.productionDatabase)}, 'CONNECT');`,
    restore: `SELECT ${cluster}, current_user, current_database(), (${roleSafe} AND r.rolname NOT IN (${dangerousRoles}) AND ${noMembership} AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_schema_privilege(current_user,'public','CREATE') AND ${noPublicWrites}), NOT has_database_privilege(current_user,current_database(),'TEMPORARY') FROM pg_roles r WHERE r.rolname=current_user;`,
  };
}

function backupId(execution) {
  const value = execution?.uuid ?? execution?.id;
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

export function validateFreshBackup(before, current, startedAt) {
  if (!Array.isArray(before) || !Array.isArray(current)) throw new GateFailure('backup_invalid');
  const known = new Set(before.map(backupId).filter(Boolean));
  const added = current.filter((execution) => {
    const id = backupId(execution);
    return id && !known.has(id);
  });
  if (added.length > 1) throw new GateFailure('backup_ambiguous');
  if (added.length === 0) throw new GateFailure('backup_pending');
  const execution = added[0];
  const createdAt = Date.parse(execution.created_at);
  if (!Number.isFinite(createdAt) || createdAt < Math.floor(startedAt / 1000) * 1000) {
    throw new GateFailure('backup_invalid');
  }
  if (['failed', 'cancelled', 'canceled'].includes(execution.status)) {
    throw new GateFailure('backup_failed');
  }
  if (execution.status !== 'success') throw new GateFailure('backup_pending');
  if (typeof execution.size !== 'string' || !/^[1-9][0-9]*$/.test(execution.size)) {
    throw new GateFailure('backup_invalid');
  }
  return { executionUuid: backupId(execution), sizeBytes: execution.size };
}

export async function runGate(candidateSha, deps) {
  let locked = false;
  let workspace;
  let restore;
  let worktreeCreated = false;
  let result;
  let failure;
  let cleanupFailed = false;
  try {
    await deps.acquireLock(candidateSha);
    locked = true;
    workspace = await deps.prepareWorkspace(candidateSha);
    await deps.verifyCandidate(candidateSha, workspace);
    worktreeCreated = true;
    await deps.createWorktree(candidateSha, workspace);
    await deps.verifyDatabaseBoundaries(candidateSha, workspace);
    const coolify = await deps.proveFreshCoolifyBackup(candidateSha, workspace);
    const independent = await deps.createIndependentBackup(candidateSha, workspace);
    restore = await deps.reserveRestoreDatabase(candidateSha, workspace, independent);
    await deps.createRestoreDatabase(candidateSha, workspace, independent, restore);
    await deps.restoreBackup(candidateSha, workspace, independent, restore);
    await deps.migrateCandidate(candidateSha, workspace, restore);
    await deps.validatePrisma(candidateSha, workspace, restore);
    await deps.verifyZeroDrift(candidateSha, workspace, restore);
    await deps.verifyReleaseInvariants(candidateSha, workspace, independent, restore);
    result = {
      gate: 'socos-cloud-restore-release',
      version: 1,
      status: 'passed',
      candidate_sha: candidateSha,
      backup_execution_uuid: coolify.executionUuid,
      backup_size_bytes: coolify.sizeBytes,
      dump_sha256: independent.dumpSha256,
      aggregate_tables: independent.tableCount,
      schema_statements: '0',
      migration_counts: 'preserved',
      cleanup: 'verified',
    };
  } catch (error) {
    failure = error;
  } finally {
    const phases = [];
    if (restore) phases.push(() => deps.dropRestoreDatabase(candidateSha, workspace, restore));
    if (worktreeCreated) phases.push(() => deps.removeWorktree(candidateSha, workspace));
    if (workspace) phases.push(() => deps.removeWorkspace(candidateSha, workspace));
    if (locked) phases.push(() => deps.releaseLock(candidateSha));
    const phaseTimeoutMs = Math.max(
      1,
      Math.floor((deps.cleanupTimeoutMs ?? 60_000) / Math.max(phases.length, 1)),
    );
    for (const phase of phases) {
      let timer;
      try {
        await Promise.race([
          phase(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new GateFailure('cleanup_failed')), phaseTimeoutMs);
          }),
        ]);
      } catch {
        cleanupFailed = true;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  if (cleanupFailed) throw new GateFailure('cleanup_failed');
  if (failure) throw failure;
  return result;
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value === '' || value.includes('\n') || value.includes('\r')) {
    throw new GateFailure('invalid_configuration');
  }
  return value;
}

function integer(env, name, fallback, minimum) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new GateFailure('invalid_configuration');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new GateFailure('invalid_configuration');
  return value;
}

function postgresUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new GateFailure('invalid_configuration');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || !url.username
    || url.pathname.length < 2
    || url.hash
  ) throw new GateFailure('invalid_configuration');
  return url;
}

function pgEnvironment(url) {
  const allowed = new Map([
    ['sslmode', 'PGSSLMODE'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcrl', 'PGSSLCRL'],
    ['connect_timeout', 'PGCONNECT_TIMEOUT'],
    ['application_name', 'PGAPPNAME'],
    ['options', 'PGOPTIONS'],
  ]);
  const output = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  for (const [key, value] of url.searchParams) {
    const target = allowed.get(key);
    if (!target || target in output) throw new GateFailure('invalid_configuration');
    output[target] = value;
  }
  return output;
}

export function configFromEnvironment(env) {
  if (env.KEEP_RESTORE_DB !== undefined) throw new GateFailure('invalid_configuration');
  const repository = required(env, 'SOCOS_RELEASE_GATE_REPOSITORY');
  const workRoot = required(env, 'SOCOS_RELEASE_GATE_WORK_ROOT');
  const lockDir = required(env, 'SOCOS_RELEASE_GATE_LOCK_DIR');
  if (![repository, workRoot, lockDir].every(isAbsolute)) {
    throw new GateFailure('invalid_configuration');
  }
  const productionUrl = postgresUrl(required(env, 'SOCOS_RELEASE_GATE_DATABASE_URL'));
  const adminUrl = postgresUrl(required(env, 'SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL'));
  const restoreBaseUrl = postgresUrl(required(env, 'SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL'));
  const endpoints = [productionUrl, adminUrl, restoreBaseUrl].map((url) => `${url.hostname}:${url.port || '5432'}`);
  if (new Set(endpoints).size !== 1) throw new GateFailure('invalid_configuration');
  const productionRole = decodeURIComponent(productionUrl.username);
  const adminRole = decodeURIComponent(adminUrl.username);
  const restoreRole = decodeURIComponent(restoreBaseUrl.username);
  const roles = [productionRole, adminRole, restoreRole];
  if (roles.some((role) => !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) || new Set(roles).size !== 3) {
    throw new GateFailure('invalid_configuration');
  }
  if (adminUrl.toString() === restoreBaseUrl.toString()) throw new GateFailure('invalid_configuration');
  const productionDatabase = decodeURIComponent(productionUrl.pathname.slice(1));
  const adminDatabase = decodeURIComponent(adminUrl.pathname.slice(1));
  const restoreBaseDatabase = decodeURIComponent(restoreBaseUrl.pathname.slice(1));
  if ([productionDatabase, adminDatabase, restoreBaseDatabase].some((name) => !/^[A-Za-z0-9_-]{1,63}$/.test(name))) {
    throw new GateFailure('invalid_configuration');
  }
  const clusterId = required(env, 'SOCOS_RELEASE_GATE_CLUSTER_ID');
  if (!/^[0-9]{10,24}$/.test(clusterId)) throw new GateFailure('invalid_configuration');
  let coolifyBaseUrl;
  try {
    coolifyBaseUrl = new URL(required(env, 'SOCOS_RELEASE_GATE_COOLIFY_BASE_URL'));
  } catch {
    throw new GateFailure('invalid_configuration');
  }
  if (
    coolifyBaseUrl.protocol !== 'https:'
    || coolifyBaseUrl.username
    || coolifyBaseUrl.password
    || coolifyBaseUrl.search
    || coolifyBaseUrl.hash
  ) throw new GateFailure('invalid_configuration');
  const databaseUuid = required(env, 'SOCOS_RELEASE_GATE_DATABASE_UUID');
  const backupUuid = required(env, 'SOCOS_RELEASE_GATE_BACKUP_UUID');
  if (!SAFE_ID.test(databaseUuid) || !SAFE_ID.test(backupUuid)) {
    throw new GateFailure('invalid_configuration');
  }
  return {
    repository,
    workRoot,
    lockDir,
    productionUrl: productionUrl.toString(),
    productionPg: pgEnvironment(productionUrl),
    productionRole,
    productionDatabase,
    adminPg: pgEnvironment(adminUrl),
    adminRole,
    adminDatabase,
    restoreBaseUrl,
    restoreRole,
    restoreBaseDatabase,
    clusterId,
    coolifyBaseUrl: coolifyBaseUrl.toString().replace(/\/$/, ''),
    coolifyToken: required(env, 'SOCOS_RELEASE_GATE_COOLIFY_TOKEN'),
    databaseUuid,
    backupUuid,
    pollAttempts: integer(env, 'SOCOS_RELEASE_GATE_POLL_ATTEMPTS', 120, 1),
    pollMs: integer(env, 'SOCOS_RELEASE_GATE_POLL_MS', 5000, 0),
    operationTimeoutMs: integer(env, 'SOCOS_RELEASE_GATE_OPERATION_TIMEOUT_MS', 900_000, 100),
    httpTimeoutMs: integer(env, 'SOCOS_RELEASE_GATE_HTTP_TIMEOUT_MS', 30_000, 100),
    cleanupTimeoutMs: integer(env, 'SOCOS_RELEASE_GATE_CLEANUP_TIMEOUT_MS', 60_000, 100),
    terminationGraceMs: integer(env, 'SOCOS_RELEASE_GATE_TERMINATION_GRACE_MS', 5_000, 10),
  };
}

function listExecutions(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.executions)) return value.executions;
  throw new GateFailure('backup_invalid');
}

function commandEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/nonexistent',
    LANG: 'C',
    LC_ALL: 'C',
    ...extra,
  };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function killProcessGroup(child, signalName) {
  try { process.kill(-child.pid, signalName); } catch { try { child.kill(signalName); } catch {} }
}

function makeCommandRunner(signal, config) {
  return (command, args, options = {}) => new Promise((resolveCommand, rejectCommand) => {
    if (signal.aborted && !options.cleanup) {
      rejectCommand(new GateFailure('interrupted'));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let outputLength = 0;
    const limit = 64 * 1024;
    const collect = (target) => (chunk) => {
      outputLength += chunk.length;
      if (target) stdout += chunk.toString('utf8');
      if (outputLength > limit) terminate();
    };
    child.stdout.on('data', collect(true));
    child.stderr.on('data', collect(false));
    let timedOut = false;
    let killTimer;
    const terminate = () => {
      if (killTimer) return;
      killProcessGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), config.terminationGraceMs);
      killTimer.unref();
    };
    const abort = terminate;
    if (!options.cleanup) signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? (options.cleanup ? config.cleanupTimeoutMs : config.operationTimeoutMs));
    timeout.unref();
    const clear = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      if (!options.cleanup) signal.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      clear();
      rejectCommand(new GateFailure(signal.aborted ? 'interrupted' : timedOut ? 'operation_timeout' : 'command_failed'));
    });
    child.once('close', (code, childSignal) => {
      clear();
      if (signal.aborted && !options.cleanup) {
        rejectCommand(new GateFailure('interrupted'));
      } else if (timedOut) {
        rejectCommand(new GateFailure('operation_timeout'));
      } else if (code !== 0 || childSignal || outputLength > limit) {
        rejectCommand(new GateFailure('command_failed'));
      } else {
        resolveCommand(stdout);
      }
    });
    child.stdin.end(options.input ?? '');
  });
}

function replaceDatabase(url, databaseName) {
  const replaced = new URL(url);
  replaced.pathname = `/${databaseName}`;
  return replaced;
}

function containedFile(parent, path) {
  const parentReal = realpathSync(parent);
  const pathReal = realpathSync(path);
  const fromParent = relative(parentReal, pathReal);
  return fromParent !== '' && !fromParent.startsWith('..') && !isAbsolute(fromParent);
}

function createDependencies(config, signal) {
  const trustedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const run = makeCommandRunner(signal, config);
  const safe = commandEnvironment();
  const git = async (args, options = {}) => run('git', args, {
    ...options,
    env: safe,
  });
  const api = async (path, options = {}) => {
    let response;
    try {
      response = await fetch(`${config.coolifyBaseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          authorization: `Bearer ${config.coolifyToken}`,
          accept: 'application/json',
          ...(options.method ? { 'content-type': 'application/json' } : {}),
        },
        body: options.method ? '{}' : undefined,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.httpTimeoutMs)]),
      });
    } catch {
      throw new GateFailure(signal.aborted ? 'interrupted' : 'coolify_request_failed');
    }
    if (!response.ok) throw new GateFailure('coolify_request_failed');
    try {
      return await response.json();
    } catch {
      throw new GateFailure('coolify_request_failed');
    }
  };

  return {
    async acquireLock() {
      try {
        mkdirSync(config.lockDir, { mode: 0o700 });
      } catch (error) {
        if (error?.code === 'EEXIST') throw new GateFailure('busy');
        throw new GateFailure('invalid_configuration');
      }
    },
    async prepareWorkspace() {
      try {
        const workspace = mkdtempSync(join(config.workRoot, 'socos-release-gate-'));
        return { workspace, worktree: join(workspace, 'candidate'), backupDir: join(workspace, 'backup') };
      } catch {
        throw new GateFailure('invalid_configuration');
      }
    },
    async verifyCandidate(candidateSha) {
      try {
        await git(['-C', config.repository, 'cat-file', '-e', `${candidateSha}^{commit}`]);
        const trustedHead = await git(['-C', config.repository, 'rev-parse', 'refs/remotes/origin/main']);
        requireExactCandidate(candidateSha, trustedHead);
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('candidate_untrusted');
      }
    },
    async createWorktree(candidateSha, workspace) {
      try {
        await git(['-C', config.repository, 'worktree', 'add', '--detach', workspace.worktree, candidateSha]);
        const head = await git(['-C', workspace.worktree, 'rev-parse', 'HEAD']);
        if (head !== `${candidateSha}\n`) throw new Error('mismatch');
        const schema = join(workspace.worktree, 'services/api/prisma/schema.prisma');
        const migrations = join(workspace.worktree, 'services/api/prisma/migrations');
        if (!existsSync(schema) || !lstatSync(migrations).isDirectory()) throw new Error('missing');
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('worktree_failed');
      }
    },
    async verifyDatabaseBoundaries() {
      const q = async (pg, sql) => run('psql', ['-X', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', `--command=${sql}`], {
        env: commandEnvironment(pg),
      });
      const queries = databaseBoundaryQueries(config);
      try {
        const prod = await q(config.productionPg, queries.production);
        const admin = await q(config.adminPg, queries.administration);
        const restore = await q(pgEnvironment(config.restoreBaseUrl), queries.restore);
        const connectionBlocked = async (pg) => {
          try {
            await q(pg, 'SELECT 1;');
            return false;
          } catch (error) {
            if (error instanceof GateFailure && error.code === 'interrupted') throw error;
            return true;
          }
        };
        const restoreProductionBlocked = await connectionBlocked({
          ...pgEnvironment(config.restoreBaseUrl),
          PGDATABASE: config.productionDatabase,
        });
        const productionTemplateBlocked = await connectionBlocked({
          ...config.productionPg, PGDATABASE: 'template1',
        });
        validateDatabaseBoundaryProofs(config, {
          production: prod,
          administration: admin,
          restore,
          restoreProductionBlocked,
          productionTemplateBlocked,
        });
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('invalid_configuration');
      }
    },
    async proveFreshCoolifyBackup() {
      const path = `/api/v1/databases/${config.databaseUuid}/backups/${config.backupUuid}/executions`;
      const before = listExecutions(await api(path));
      const startedAt = Date.now();
      await api(path, { method: 'POST' });
      for (let attempt = 0; attempt < config.pollAttempts; attempt += 1) {
        const current = listExecutions(await api(path));
        try {
          return validateFreshBackup(before, current, startedAt);
        } catch (error) {
          if (!(error instanceof GateFailure) || error.code !== 'backup_pending') throw error;
        }
        if (attempt + 1 < config.pollAttempts) {
          await new Promise((resolveSleep, rejectSleep) => {
            const abort = () => {
              clearTimeout(timer);
              rejectSleep(new GateFailure('interrupted'));
            };
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', abort);
              resolveSleep();
            }, config.pollMs);
            signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
      throw new GateFailure('backup_timeout');
    },
    async createIndependentBackup(candidateSha, workspace) {
      void candidateSha;
      try {
        mkdirSync(workspace.backupDir, { mode: 0o700 });
        const output = await run(join(trustedRoot, 'scripts/backup-postgres.sh'), [], {
          cwd: trustedRoot,
          env: commandEnvironment({
            DATABASE_URL: config.productionUrl,
            BACKUP_DIR: workspace.backupDir,
            TMPDIR: workspace.workspace,
          }),
        });
        const match = output.match(/^backup_status=created tables=([1-9][0-9]*)\nbackup_file=(.+)\n$/);
        if (!match) throw new Error('output');
        const dumpFile = match[2];
        if (!containedFile(workspace.backupDir, dumpFile)) throw new Error('path');
        const dumpSha256 = await sha256(dumpFile);
        const checksum = readFileSync(`${dumpFile}.sha256`, 'utf8');
        if (checksum !== `${dumpSha256}  ${dumpFile.split('/').at(-1)}\n`) throw new Error('checksum');
        const metadata = readFileSync(`${dumpFile}.metadata.tsv`, 'utf8');
        const tables = metadata.trimEnd().split('\n');
        if (tables[0] !== 'table_name\trow_count' || tables.length - 1 !== Number(match[1])) {
          throw new Error('metadata');
        }
        return { dumpFile, dumpSha256, tableCount: match[1], metadataFile: `${dumpFile}.metadata.tsv` };
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('independent_backup_failed');
      }
    },
    async reserveRestoreDatabase(candidateSha) {
      void candidateSha;
      const databaseName = `socos_release_gate_${randomBytes(16).toString('hex')}`;
      return { databaseName, databaseUrl: replaceDatabase(config.restoreBaseUrl, databaseName).toString() };
    },
    async createRestoreDatabase(candidateSha, workspace, independent, restore) {
      void workspace;
      void independent;
      try {
        await run('createdb', [`--owner=${config.restoreRole}`, restore.databaseName], {
          env: commandEnvironment(config.adminPg),
        });
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('restore_create_failed');
      }
    },
    async restoreBackup(candidateSha, workspace, independent, restore) {
      void candidateSha;
      void workspace;
      try {
        await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', independent.dumpFile], {
          env: commandEnvironment(pgEnvironment(new URL(restore.databaseUrl))),
        });
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('restore_failed');
      }
    },
    async migrateCandidate(candidateSha, workspace, restore) {
      void candidateSha;
      const schema = join(workspace.worktree, 'services/api/prisma/schema.prisma');
      try {
        await run('pnpm', ['--filter', '@socos/api', 'exec', 'prisma', 'migrate', 'deploy', '--schema', schema], {
          cwd: trustedRoot,
          env: commandEnvironment({ DATABASE_URL: restore.databaseUrl }),
        });
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('migration_failed');
      }
    },
    async validatePrisma(candidateSha, workspace, restore) {
      void candidateSha;
      const schema = join(workspace.worktree, 'services/api/prisma/schema.prisma');
      try {
        await run('pnpm', ['--filter', '@socos/api', 'exec', 'prisma', 'validate', '--schema', schema], {
          cwd: trustedRoot,
          env: commandEnvironment({ DATABASE_URL: restore.databaseUrl }),
        });
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('prisma_validate_failed');
      }
    },
    async verifyZeroDrift(candidateSha, workspace, restore) {
      void candidateSha;
      try {
        const output = await run(process.execPath, [join(trustedRoot, 'scripts/compare-schema.mjs')], {
          cwd: trustedRoot,
          env: commandEnvironment({
            DATABASE_URL: restore.databaseUrl,
            PRISMA_SCHEMA: join(workspace.worktree, 'services/api/prisma/schema.prisma'),
          }),
        });
        if (output !== 'schema_status=match statements=0\n') throw new Error('drift');
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('schema_drift');
      }
    },
    async verifyReleaseInvariants(candidateSha, workspace, independent, restore) {
      void candidateSha;
      try {
        const output = await run(
          process.execPath,
          [join(trustedRoot, 'scripts/verify-post-migration-counts.mjs'), independent.metadataFile],
          {
            cwd: trustedRoot,
            env: commandEnvironment({
              DATABASE_URL: restore.databaseUrl,
              SOCOS_MIGRATIONS_ROOT: join(workspace.worktree, 'services/api/prisma/migrations'),
            }),
          },
        );
        if (!/^migration_counts_status=preserved existing_tables=[0-9]+ new_empty_tables=[0-9]+ migrations=[1-9][0-9]*\n$/.test(output)) {
          throw new Error('invariants');
        }
      } catch (error) {
        if (error instanceof GateFailure && error.code === 'interrupted') throw error;
        throw new GateFailure('release_invariants_failed');
      }
    },
    async dropRestoreDatabase(candidateSha, workspace, restore) {
      void candidateSha;
      void workspace;
      await run('dropdb', ['--if-exists', '--force', restore.databaseName], {
        env: commandEnvironment(config.adminPg),
        cleanup: true,
      });
    },
    async removeWorktree(candidateSha, workspace) {
      void candidateSha;
      if (existsSync(workspace.worktree)) {
        await git(['-C', config.repository, 'worktree', 'remove', '--force', workspace.worktree], { cleanup: true });
      }
      await git(['-C', config.repository, 'worktree', 'prune'], { cleanup: true });
    },
    async removeWorkspace(candidateSha, workspace) {
      void candidateSha;
      rmSync(workspace.workspace, { recursive: true, force: true });
    },
    async releaseLock() {
      rmdirSync(config.lockDir);
    },
    cleanupTimeoutMs: config.cleanupTimeoutMs,
  };
}

async function readCandidate() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 41) throw new GateFailure('invalid_candidate');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!/^[0-9a-f]{40}\n?$/.test(raw)) throw new GateFailure('invalid_candidate');
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

async function main() {
  let candidateSha;
  const abortController = new AbortController();
  const interrupt = () => abortController.abort();
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.on(signal, interrupt);
  try {
    if (process.argv.length !== 2 || (process.env.SSH_ORIGINAL_COMMAND || '') !== '') {
      throw new GateFailure('invalid_candidate');
    }
    candidateSha = await readCandidate();
    if (!CANDIDATE.test(candidateSha)) throw new GateFailure('invalid_candidate');
    const config = configFromEnvironment(process.env);
    const receipt = await runGate(candidateSha, createDependencies(config, abortController.signal));
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    const reported = abortController.signal.aborted ? new GateFailure('interrupted') : error;
    process.stderr.write(`${JSON.stringify(publicFailureReceipt(reported))}\n`);
    process.exitCode = reported instanceof GateFailure && reported.code === 'invalid_candidate' ? 64 : 1;
  } finally {
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
