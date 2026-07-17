#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CANDIDATE = /^[0-9a-f]{40}$/;
const SSH_HOST = 'socos-release-gate';
const RECEIPT_KEYS = [
  'gate',
  'version',
  'status',
  'candidate_sha',
  'backup_execution_uuid',
  'backup_size_bytes',
  'dump_sha256',
  'aggregate_tables',
  'schema_statements',
  'migration_counts',
  'cleanup',
];

function failure(code) {
  return { gate: 'socos-cloud-restore-release', version: 1, status: 'failed', code };
}

function invalidReceipt() {
  return new Error('invalid_receipt');
}

export function parseSuccessReceipt(raw, candidateSha) {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.endsWith('\n')) throw invalidReceipt();
  const line = raw.slice(0, -1);
  if (line.includes('\n') || line.includes('\r')) throw invalidReceipt();
  let receipt;
  try {
    receipt = JSON.parse(line);
  } catch {
    throw invalidReceipt();
  }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) throw invalidReceipt();
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_KEYS.length || !keys.every((key) => RECEIPT_KEYS.includes(key))) {
    throw invalidReceipt();
  }
  if (
    receipt.gate !== 'socos-cloud-restore-release'
    || receipt.version !== 1
    || receipt.status !== 'passed'
    || receipt.candidate_sha !== candidateSha
    || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.backup_execution_uuid)
    || !/^[1-9][0-9]*$/.test(receipt.backup_size_bytes)
    || !/^[0-9a-f]{64}$/.test(receipt.dump_sha256)
    || !/^[1-9][0-9]*$/.test(receipt.aggregate_tables)
    || receipt.schema_statements !== '0'
    || receipt.migration_counts !== 'preserved'
    || receipt.cleanup !== 'verified'
  ) throw invalidReceipt();
  return receipt;
}

function writeFailure(code, exitCode) {
  process.stderr.write(`${JSON.stringify(failure(code))}\n`);
  process.exitCode = exitCode;
}

function duration(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

function killProcessGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

async function main() {
  if (process.argv.length !== 3 || !CANDIDATE.test(process.argv[2])) {
    writeFailure('invalid_candidate', 64);
    return;
  }
  const candidateSha = process.argv[2];
  const timeoutMs = duration('SOCOS_RELEASE_GATE_SSH_TIMEOUT_MS', 900_000, 10);
  const graceMs = duration('SOCOS_RELEASE_GATE_TERMINATION_GRACE_MS', 5_000, 10);
  if (timeoutMs === undefined || graceMs === undefined) {
    writeFailure('invalid_configuration', 64);
    return;
  }
  const child = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'RequestTTY=no', '--', SSH_HOST],
    { stdio: ['pipe', 'pipe', 'pipe'], detached: true },
  );
  let stdout = '';
  let stderrLength = 0;
  let overflow = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 4096) {
      overflow = true;
      terminate();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrLength += chunk.length;
    if (stderrLength > 4096) terminate();
  });

  let interrupted = false;
  let timedOut = false;
  let killTimer;
  const terminate = () => {
    if (killTimer) return;
    killProcessGroup(child, 'SIGTERM');
    killTimer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), graceMs);
    killTimer.unref();
  };
  const stop = () => {
    interrupted = true;
    terminate();
  };
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.on(signal, stop);
  child.stdin.end(`${candidateSha}\n`);
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  timeout.unref();

  const result = await new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null, error: true }));
    child.once('close', (code, signal) => resolve({ code, signal, error: false }));
  });
  clearTimeout(timeout);
  clearTimeout(killTimer);
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.removeListener(signal, stop);

  if (interrupted) {
    writeFailure('interrupted', 70);
    return;
  }
  if (timedOut) {
    writeFailure('ssh_timeout', 1);
    return;
  }
  if (result.error || result.code !== 0 || result.signal || overflow || stderrLength !== 0) {
    writeFailure('remote_failed', 1);
    return;
  }
  try {
    const receipt = parseSuccessReceipt(stdout, candidateSha);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch {
    writeFailure('invalid_receipt', 1);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
