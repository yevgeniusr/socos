#!/usr/bin/env node
import { isIP } from 'node:net';
import process from 'node:process';

const MANAGED_KEYS = [
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'CALENDAR_SYNC_ENABLED',
  'LOCATION_INGEST_ENABLED',
  'EVENT_SOURCE_ALLOWED_HOSTS',
  'EVENT_DISCOVERY_ENABLED',
  'EVENT_BRIEF_ENABLED',
];

const OPERATION_VALUES = {
  'calendar-enable': ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET'],
  'location-enable': [],
  'event-discovery-enable': ['EVENT_SOURCE_ALLOWED_HOSTS'],
  'event-brief-enable': [],
};

const PLACEHOLDER = /(?:placeholder|disabled[-_ ]*until|change[-_ ]*me|replace(?:d)?[-_ ]*(?:with|me)|your[-_ ]*(?:google|client|secret)|client[-_ ]*(?:id|secret)[-_ ]*(?:here|pending)|^todo$|^example$|^dummy$|^<.*>$)/i;

class ActivationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new ActivationError(code); };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function fixedInteger(name, fallback, minimum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) fail('invalid_configuration');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) fail('invalid_configuration');
  return value;
}

async function readInput() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 64 * 1024) fail('invalid_input');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') fail('invalid_input');
  try {
    return JSON.parse(raw);
  } catch {
    fail('invalid_input');
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactlyKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function configuredValue(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && !PLACEHOLDER.test(value);
}

function publicHostname(value) {
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()) return false;
  if (isIP(value) !== 0 || /(?:^|\.)(?:localhost|local|internal)$/.test(value)) return false;
  if (!/^[a-z0-9.-]+$/.test(value) || !value.includes('.') || value.endsWith('.')) return false;
  return value.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function validateInput(input) {
  const keys = [
    'operation',
    'applicationUuid',
    'databaseUuid',
    'backupUuid',
    'expectedCommit',
    'publicBaseUrl',
    'values',
  ];
  if (!hasExactlyKeys(input, keys) || !(input.operation in OPERATION_VALUES)) fail('invalid_input');
  for (const name of ['applicationUuid', 'databaseUuid', 'backupUuid']) {
    if (typeof input[name] !== 'string' || !/^[A-Za-z0-9_-]+$/.test(input[name])) fail('invalid_input');
  }
  if (typeof input.expectedCommit !== 'string' || !/^[0-9a-f]{40}$/.test(input.expectedCommit)) {
    fail('invalid_input');
  }
  let publicUrl;
  try {
    publicUrl = new URL(input.publicBaseUrl);
  } catch {
    fail('invalid_input');
  }
  if (
    publicUrl.protocol !== 'https:'
    || publicUrl.username !== ''
    || publicUrl.password !== ''
    || publicUrl.search !== ''
    || publicUrl.hash !== ''
    || !['', '/'].includes(publicUrl.pathname)
  ) fail('invalid_input');

  const allowedValues = OPERATION_VALUES[input.operation];
  if (!hasExactlyKeys(input.values, allowedValues)) fail('invalid_input');
  if (input.operation === 'calendar-enable') {
    if (!configuredValue(input.values.GOOGLE_CALENDAR_CLIENT_ID)) fail('invalid_input');
    if (!configuredValue(input.values.GOOGLE_CALENDAR_CLIENT_SECRET)) fail('invalid_input');
  }
  if (
    input.operation === 'event-discovery-enable'
    && !publicHostname(input.values.EVENT_SOURCE_ALLOWED_HOSTS)
  ) fail('invalid_input');
  return { ...input, publicBaseUrl: publicUrl.origin };
}

function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('invalid_configuration');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('invalid_configuration');
  }
  return url.toString().replace(/\/$/, '');
}

function createApi(baseUrl, token) {
  return async (path, options = {}) => {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'error',
      });
    } catch {
      fail('coolify_request_failed');
    }
    if (!response.ok) fail('coolify_request_failed');
    if (options.ignoreResponse === true) {
      await response.body?.cancel();
      return undefined;
    }
    try {
      return await response.json();
    } catch {
      fail('coolify_response_invalid');
    }
  };
}

function list(value, property) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value) && Array.isArray(value[property])) return value[property];
  if (isPlainObject(value) && Array.isArray(value.data)) return value.data;
  fail('coolify_response_invalid');
}

function recordValue(record) {
  const realValue = record.real_value;
  if (typeof realValue === 'string') {
    if (
      record.is_literal === true
      && typeof record.value === 'string'
      && realValue === `'${record.value}'`
    ) return record.value;
    return realValue;
  }
  const value = record.value;
  if (typeof value !== 'string') fail('environment_invalid');
  return value;
}

function parseEnvironment(response) {
  const records = list(response, 'envs');
  const byKey = new Map();
  for (const key of MANAGED_KEYS) {
    const matches = records.filter((record) => record?.key === key);
    if (matches.some((record) => ![true, false, null, undefined].includes(record.is_preview))) {
      fail('environment_invalid');
    }
    const production = matches.filter((record) => record.is_preview !== true);
    const preview = matches.filter((record) => record.is_preview === true);
    if (matches.length !== 2 || production.length !== 1 || preview.length !== 1) fail('environment_invalid');
    const productionValue = recordValue(production[0]);
    const previewValue = recordValue(preview[0]);
    if (productionValue !== previewValue) fail('environment_invalid');
    byKey.set(key, { production: production[0], preview: preview[0], value: productionValue });
  }
  return byKey;
}

function requireDependencies(operation, environment) {
  const current = (key) => environment.get(key).value;
  const calendarReady = current('CALENDAR_SYNC_ENABLED') === 'true'
    && configuredValue(current('GOOGLE_CALENDAR_CLIENT_ID'))
    && configuredValue(current('GOOGLE_CALENDAR_CLIENT_SECRET'));
  if (operation === 'calendar-enable') return;
  if (!calendarReady) fail('dependency_not_satisfied');
  if (operation === 'location-enable') return;
  if (current('LOCATION_INGEST_ENABLED') !== 'true') fail('dependency_not_satisfied');
  if (operation === 'event-discovery-enable') return;
  if (
    current('EVENT_DISCOVERY_ENABLED') !== 'true'
    || current('EVENT_SOURCE_ALLOWED_HOSTS').trim() === ''
  ) fail('dependency_not_satisfied');
}

function targetValues(input) {
  if (input.operation === 'calendar-enable') {
    return {
      GOOGLE_CALENDAR_CLIENT_ID: input.values.GOOGLE_CALENDAR_CLIENT_ID,
      GOOGLE_CALENDAR_CLIENT_SECRET: input.values.GOOGLE_CALENDAR_CLIENT_SECRET,
      CALENDAR_SYNC_ENABLED: 'true',
    };
  }
  if (input.operation === 'location-enable') return { LOCATION_INGEST_ENABLED: 'true' };
  if (input.operation === 'event-discovery-enable') {
    return {
      EVENT_SOURCE_ALLOWED_HOSTS: input.values.EVENT_SOURCE_ALLOWED_HOSTS,
      EVENT_DISCOVERY_ENABLED: 'true',
    };
  }
  return { EVENT_BRIEF_ENABLED: 'true' };
}

function bulkData(environment, values) {
  return Object.entries(values).flatMap(([key, value]) => {
    const pair = environment.get(key);
    return [pair.production, pair.preview].map((record) => ({
      key,
      value,
      is_preview: record.is_preview === true,
      is_literal: typeof record.is_literal === 'boolean' ? record.is_literal : true,
    }));
  });
}

function snapshotValues(environment) {
  return Object.fromEntries(MANAGED_KEYS.map((key) => [key, environment.get(key).value]));
}

function verifyValues(environment, values, code = 'environment_verification_failed') {
  for (const [key, value] of Object.entries(values)) {
    if (environment.get(key).value !== value) fail(code);
  }
}

function executionId(execution) {
  const id = execution?.uuid ?? execution?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function validBackupSize(size) {
  return typeof size === 'string'
    ? /^[1-9][0-9]*$/.test(size)
    : typeof size === 'number' && Number.isSafeInteger(size) && size > 0;
}

async function createBackup(api, input, startedAt, attempts, pollMs) {
  const backupPath = `/api/v1/databases/${input.databaseUuid}/backups/${input.backupUuid}`;
  const executionsPath = `${backupPath}/executions`;
  const before = list(await api(executionsPath), 'executions');
  const known = new Set(before.map(executionId).filter(Boolean));
  await api(backupPath, {
    method: 'PATCH',
    body: { backup_now: true },
    ignoreResponse: true,
  });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const executions = list(await api(executionsPath), 'executions');
    const added = executions.filter((execution) => {
      const id = executionId(execution);
      return id && !known.has(id);
    });
    if (added.length > 1) fail('backup_ambiguous');
    if (added.length === 1) {
      const execution = added[0];
      const createdAt = Date.parse(execution.created_at);
      if (!Number.isFinite(createdAt) || createdAt < Math.floor(startedAt / 1_000) * 1_000) {
        fail('backup_stale');
      }
      if (['failed', 'cancelled', 'canceled'].includes(execution.status)) fail('backup_failed');
      if (execution.status === 'success') {
        if (!validBackupSize(execution.size)) fail('backup_invalid');
        return executionId(execution);
      }
    }
    if (attempt + 1 < attempts) await sleep(pollMs);
  }
  fail('backup_timeout');
}

async function deploy(api, input, attempts, pollMs) {
  const response = await api('/api/v1/deploy', {
    method: 'POST',
    body: { uuid: input.applicationUuid, force: true },
  });
  const deploymentUuid = response?.deployments?.[0]?.deployment_uuid;
  if (typeof deploymentUuid !== 'string' || deploymentUuid === '') fail('deployment_response_invalid');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const deployment = await api(`/api/v1/deployments/${deploymentUuid}`);
    if (deployment?.status === 'finished') {
      if (deployment.commit !== input.expectedCommit) fail('deployment_commit_mismatch');
      return { deploymentUuid, deploymentCommit: deployment.commit };
    }
    if (['failed', 'cancelled', 'cancelled-by-user', 'canceled'].includes(deployment?.status)) {
      fail('deployment_failed');
    }
    if (attempt + 1 < attempts) await sleep(pollMs);
  }
  fail('deployment_timeout');
}

async function smoke(baseUrl, flags) {
  const checks = [
    ['health_status', '/api/health-check', 'GET', 200],
    ['calendar_guard_status', '/api/integrations/google-calendar', 'GET', 401],
    ['location_status', '/api/location/owntracks', 'POST', flags.location ? 401 : 503],
    ['calendar_webhook_status', '/api/integrations/google-calendar/webhook', 'POST', flags.calendar ? 400 : 503],
  ];
  const statuses = {};
  for (const [name, path, method, expected] of checks) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, redirect: 'error' });
    } catch {
      fail('smoke_failed');
    }
    statuses[name] = response.status;
    await response.body?.cancel();
    if (response.status !== expected) fail('smoke_failed');
  }
  return statuses;
}

function flags(values) {
  return {
    calendar: values.CALENDAR_SYNC_ENABLED === 'true',
    location: values.LOCATION_INGEST_ENABLED === 'true',
  };
}

function writeReceipt(stream, receipt) {
  stream.write(`${JSON.stringify(receipt)}\n`);
}

let operation = 'unavailable';
let api;
let input;
let snapshotEnvironment;
let snapshot;
let envMutationAttempted = false;

try {
  input = validateInput(await readInput());
  operation = input.operation;
  const token = process.env.COOLIFY_TOKEN;
  if (typeof token !== 'string' || token === '' || /[\r\n]/.test(token)) fail('invalid_configuration');
  const baseUrl = validateBaseUrl(process.env.COOLIFY_BASE_URL ?? 'https://qed.quest');
  const attempts = fixedInteger('COOLIFY_ACTIVATION_POLL_ATTEMPTS', 120, 1);
  const pollMs = fixedInteger('COOLIFY_ACTIVATION_POLL_MS', 5_000, 0);
  const startedAt = Date.now();
  api = createApi(baseUrl, token);

  const applicationPath = `/api/v1/applications/${input.applicationUuid}`;
  const application = await api(applicationPath);
  if (application?.git_branch !== 'main') fail('application_not_main');
  const patchResponse = await api(applicationPath, {
    method: 'PATCH',
    body: { git_commit_sha: input.expectedCommit, is_auto_deploy_enabled: false },
  });
  if (patchResponse?.uuid !== input.applicationUuid) fail('application_pin_failed');
  const pinned = await api(applicationPath);
  if (pinned?.git_branch !== 'main' || pinned.git_commit_sha !== input.expectedCommit) fail('application_pin_failed');

  const backupUuid = await createBackup(api, input, startedAt, attempts, pollMs);
  const envPath = `/api/v1/applications/${input.applicationUuid}/envs`;
  snapshotEnvironment = parseEnvironment(await api(envPath));
  requireDependencies(input.operation, snapshotEnvironment);
  snapshot = snapshotValues(snapshotEnvironment);
  const targets = targetValues(input);

  envMutationAttempted = true;
  await api(`${envPath}/bulk`, {
    method: 'PATCH',
    body: { data: bulkData(snapshotEnvironment, targets) },
  });
  verifyValues(parseEnvironment(await api(envPath)), targets);
  const deployment = await deploy(api, input, attempts, pollMs);
  const finalValues = { ...snapshot, ...targets };
  const smokeStatuses = await smoke(input.publicBaseUrl, flags(finalValues));

  writeReceipt(process.stdout, {
    activation_status: 'succeeded',
    operation: input.operation,
    backup_uuid: backupUuid,
    deployment_uuid: deployment.deploymentUuid,
    deployment_commit: deployment.deploymentCommit,
    ...smokeStatuses,
  });
} catch (error) {
  const errorCode = error instanceof ActivationError ? error.code : 'internal_error';
  if (!envMutationAttempted || !api || !input || !snapshotEnvironment || !snapshot) {
    writeReceipt(process.stderr, { activation_status: 'failed', operation, error_code: errorCode });
    process.exitCode = 1;
  } else {
    let rollbackStatus = 'succeeded';
    try {
      const envPath = `/api/v1/applications/${input.applicationUuid}/envs`;
      await api(`${envPath}/bulk`, {
        method: 'PATCH',
        body: { data: bulkData(snapshotEnvironment, snapshot) },
      });
      verifyValues(parseEnvironment(await api(envPath)), snapshot, 'rollback_verification_failed');
      await deploy(
        api,
        input,
        fixedInteger('COOLIFY_ACTIVATION_POLL_ATTEMPTS', 120, 1),
        fixedInteger('COOLIFY_ACTIVATION_POLL_MS', 5_000, 0),
      );
      await smoke(input.publicBaseUrl, flags(snapshot));
    } catch {
      rollbackStatus = 'failed';
    }
    writeReceipt(process.stderr, {
      activation_status: 'failed',
      operation,
      error_code: errorCode,
      rollback_status: rollbackStatus,
    });
    process.exitCode = 1;
  }
}
