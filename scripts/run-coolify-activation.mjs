#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import process from 'node:process';

const APPLICATION_UUID = 'swwcg80gkw4k0k4oco8w8wgw';
const DATABASE_UUID = 'zwkk0scogckskkwss8oo48k4';
const BACKUP_UUID = 'b85nxfljaz0xpo9xqa57lfr4';
const PUBLIC_BASE_URL = 'https://socos.rachkovan.com';
const OPERATIONS = new Set([
  'calendar-enable',
  'location-enable',
  'event-discovery-enable',
  'event-brief-enable',
]);
const USAGE = 'Usage: ./scripts/run-coolify-activation.mjs <operation> <expected-40hex-commit> [certified-public-host]';

class WrapperError extends Error {
  constructor(code, status = 1) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new WrapperError(code, status);
}

function testOverride(name, fallback) {
  if (process.env.NODE_ENV === 'test' && process.env[name]) return process.env[name];
  return fallback;
}

function isCertifiedHost(value) {
  if (
    typeof value !== 'string'
    || value !== value.toLowerCase()
    || value.length > 253
    || isIP(value) !== 0
    || /(?:^|\.)(?:localhost|local|internal)$/.test(value)
    || !/^[a-z0-9.-]+$/.test(value)
    || !value.includes('.')
    || value.endsWith('.')
  ) return false;
  return value.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function parseArguments(argv) {
  const [operation, expectedCommit, host] = argv;
  const discovery = operation === 'event-discovery-enable';
  if (
    !OPERATIONS.has(operation)
    || !/^[0-9a-f]{40}$/.test(expectedCommit ?? '')
    || (discovery ? argv.length !== 3 || !isCertifiedHost(host) : argv.length !== 2)
  ) fail('usage', 64);
  return { operation, expectedCommit, host };
}

async function coolifyInstance() {
  const configPath = testOverride(
    'SOCOS_ACTIVATION_TEST_CONFIG_PATH',
    join(homedir(), '.config', 'coolify', 'config.json'),
  );
  const context = testOverride('SOCOS_ACTIVATION_TEST_CONTEXT', 'qed');
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    fail('configuration_unavailable');
  }
  if (!Array.isArray(config?.instances)) fail('configuration_invalid');
  const matches = config.instances.filter((instance) => instance?.name === context);
  if (matches.length !== 1) fail('configuration_invalid');
  const instance = matches[0];
  let baseUrl;
  try {
    const parsed = new URL(instance.fqdn);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) fail('configuration_invalid');
    baseUrl = parsed.origin;
  } catch (error) {
    if (error instanceof WrapperError) throw error;
    fail('configuration_invalid');
  }
  return { baseUrl };
}

function keychainValue(service) {
  return new Promise((resolveValue, rejectValue) => {
    execFile(
      'security',
      ['find-generic-password', '-w', '-a', 'socos', '-s', service],
      { encoding: 'utf8', maxBuffer: 16 * 1024 },
      (error, stdout) => {
        if (error) {
          rejectValue(new WrapperError('keychain_unavailable'));
          return;
        }
        const value = stdout.endsWith('\n') ? stdout.slice(0, -1).replace(/\r$/, '') : stdout;
        if (value.length === 0 || /[\r\n]/.test(value)) {
          rejectValue(new WrapperError('keychain_invalid'));
          return;
        }
        resolveValue(value);
      },
    );
  });
}

async function valuesFor(operation, host) {
  if (operation === 'calendar-enable') {
    const clientId = await keychainValue('socos-google-calendar-client-id');
    const clientSecret = await keychainValue('socos-google-calendar-client-secret');
    return {
      GOOGLE_CALENDAR_CLIENT_ID: clientId,
      GOOGLE_CALENDAR_CLIENT_SECRET: clientSecret,
    };
  }
  if (operation === 'event-discovery-enable') {
    return { EVENT_SOURCE_ALLOWED_HOSTS: host };
  }
  return {};
}

function runActivation(path, input, baseUrl, token) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [path], {
      env: {
        ...process.env,
        COOLIFY_TOKEN: token,
        COOLIFY_BASE_URL: baseUrl,
      },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.once('error', () => rejectChild(new WrapperError('activation_unavailable')));
    child.once('close', (code, signal) => {
      if (signal || !Number.isInteger(code)) {
        rejectChild(new WrapperError('activation_interrupted'));
        return;
      }
      resolveChild(code);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

try {
  const args = parseArguments(process.argv.slice(2));
  const instance = await coolifyInstance();
  const coolifyToken = await keychainValue('coolify-cli-qed-token');
  const values = await valuesFor(args.operation, args.host);
  const activationPath = testOverride(
    'SOCOS_ACTIVATION_TEST_CLI_PATH',
    resolve(import.meta.dirname, 'coolify-activate.mjs'),
  );
  const status = await runActivation(activationPath, {
    operation: args.operation,
    applicationUuid: APPLICATION_UUID,
    databaseUuid: DATABASE_UUID,
    backupUuid: BACKUP_UUID,
    expectedCommit: args.expectedCommit,
    publicBaseUrl: PUBLIC_BASE_URL,
    values,
  }, instance.baseUrl, coolifyToken);
  process.exitCode = status;
} catch (error) {
  const wrapperError = error instanceof WrapperError
    ? error
    : new WrapperError('internal_error');
  if (wrapperError.code === 'usage') process.stderr.write(`${USAGE}\n`);
  else process.stderr.write(`activation_wrapper_status=failed error_code=${wrapperError.code}\n`);
  process.exitCode = wrapperError.status;
}
