import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const wrapper = resolve(root, 'scripts/run-coolify-activation.mjs');
const commit = '1234567890abcdef1234567890abcdef12345678';
const coolifyToken = 'wrapper-coolify-token-secret';
const calendarId = 'wrapper-calendar-id.apps.googleusercontent.com';
const calendarSecret = 'wrapper-calendar-client-secret';

function executable(path, body) {
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'socos-activation-wrapper-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const securityLog = join(dir, 'security-argv.log');
  const activationArgv = join(dir, 'activation-argv.log');
  const configPath = join(dir, 'coolify.json');
  const activationPath = join(dir, 'fake-activation.mjs');
  writeFileSync(configPath, JSON.stringify({
    instances: [
      { name: 'wrong', fqdn: 'https://wrong.invalid' },
      { name: 'test-qed', fqdn: 'https://qed.test.invalid' },
    ],
  }));
  executable(join(bin, 'security'), `
const fs = require('node:fs');
fs.appendFileSync(process.env.SECURITY_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
const service = process.argv.at(-1);
if (service === 'coolify-cli-qed-token') process.stdout.write('${coolifyToken}\\n');
else if (service === 'socos-google-calendar-client-id') process.stdout.write('${calendarId}\\n');
else if (service === 'socos-google-calendar-client-secret') process.stdout.write('${calendarSecret}\\n');
else process.exit(9);
`);
  writeFileSync(activationPath, `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
assert.equal(process.env.COOLIFY_TOKEN, '${coolifyToken}');
assert.equal(process.env.COOLIFY_BASE_URL, 'https://qed.test.invalid');
assert.equal(input.operation, process.env.EXPECTED_OPERATION);
assert.equal(input.applicationUuid, 'swwcg80gkw4k0k4oco8w8wgw');
assert.equal(input.databaseUuid, 'zwkk0scogckskkwss8oo48k4');
assert.equal(input.backupUuid, 'b85nxfljaz0xpo9xqa57lfr4');
assert.equal(input.expectedCommit, '${commit}');
assert.equal(input.publicBaseUrl, 'https://socos.rachkovan.com');
if (input.operation === 'calendar-enable') {
  assert.deepEqual(input.values, {
    GOOGLE_CALENDAR_CLIENT_ID: '${calendarId}',
    GOOGLE_CALENDAR_CLIENT_SECRET: '${calendarSecret}',
  });
} else {
  assert.deepEqual(input.values, JSON.parse(process.env.EXPECTED_VALUES));
}
writeFileSync(process.env.ACTIVATION_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_ACTIVATION_EXIT) {
  process.stderr.write('{"activation_status":"failed","error_code":"synthetic"}\\n');
  process.exit(Number(process.env.FAKE_ACTIVATION_EXIT));
}
process.stdout.write('{"activation_status":"succeeded","operation":"synthetic"}\\n');
`);
  return { dir, bin, securityLog, activationArgv, configPath, activationPath };
}

function run(args, files, env = {}) {
  return spawnSync(process.execPath, [wrapper, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PATH: `${files.bin}:${process.env.PATH}`,
      SECURITY_LOG: files.securityLog,
      ACTIVATION_ARGV_LOG: files.activationArgv,
      SOCOS_ACTIVATION_TEST_CONFIG_PATH: files.configPath,
      SOCOS_ACTIVATION_TEST_CONTEXT: 'test-qed',
      SOCOS_ACTIVATION_TEST_CLI_PATH: files.activationPath,
      ...env,
    },
  });
}

test('rejects unknown operations, invalid commits, and incorrect host arity before secret access', () => {
  const files = fixture();
  const cases = [
    ['unknown-enable', commit],
    ['calendar-enable', 'HEAD'],
    ['calendar-enable', commit, 'events.example.com'],
    ['event-discovery-enable', commit],
    ['event-discovery-enable', commit, 'events.example.com', 'extra.example.com'],
  ];
  for (const args of cases) {
    const result = run(args, files);
    assert.equal(result.status, 64, args.join(' '));
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
  assert.equal(existsSync(files.securityLog), false);
  assert.equal(existsSync(files.activationArgv), false);
});

test('calendar activation reads only named Keychain services and sends secrets only in child stdin and env', () => {
  const files = fixture();
  const result = run(['calendar-enable', commit], files, {
    EXPECTED_OPERATION: 'calendar-enable',
    EXPECTED_VALUES: '{}',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '{"activation_status":"succeeded","operation":"synthetic"}\n');
  assert.equal(result.stderr, '');
  assert.deepEqual(
    readFileSync(files.securityLog, 'utf8').trim().split('\n').map(JSON.parse),
    [
      ['find-generic-password', '-w', '-a', 'socos', '-s', 'coolify-cli-qed-token'],
      ['find-generic-password', '-w', '-a', 'socos', '-s', 'socos-google-calendar-client-id'],
      ['find-generic-password', '-w', '-a', 'socos', '-s', 'socos-google-calendar-client-secret'],
    ],
  );
  assert.deepEqual(JSON.parse(readFileSync(files.activationArgv, 'utf8')), []);
  const exposed = `${[wrapper, 'calendar-enable', commit].join(' ')}${result.stdout}${result.stderr}${readFileSync(files.securityLog, 'utf8')}${readFileSync(files.activationArgv, 'utf8')}`;
  assert.doesNotMatch(exposed, new RegExp(`${coolifyToken}|${calendarId}|${calendarSecret}`));
});

test('non-calendar stages read only the Coolify token and produce exact empty or certified-host values', () => {
  const cases = [
    ['location-enable', [], {}],
    ['event-discovery-enable', ['events.example.com'], { EVENT_SOURCE_ALLOWED_HOSTS: 'events.example.com' }],
    ['event-brief-enable', [], {}],
  ];
  for (const [operation, extraArgs, values] of cases) {
    const files = fixture();
    const result = run([operation, commit, ...extraArgs], files, {
      EXPECTED_OPERATION: operation,
      EXPECTED_VALUES: JSON.stringify(values),
    });
    assert.equal(result.status, 0, `${operation}: ${result.stderr}`);
    assert.deepEqual(
      readFileSync(files.securityLog, 'utf8').trim().split('\n').map(JSON.parse),
      [['find-generic-password', '-w', '-a', 'socos', '-s', 'coolify-cli-qed-token']],
      operation,
    );
    assert.deepEqual(JSON.parse(readFileSync(files.activationArgv, 'utf8')), [], operation);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(coolifyToken), operation);
  }
});

test('propagates the activation child exit status and only its redacted receipt', () => {
  const files = fixture();
  const result = run(['location-enable', commit], files, {
    EXPECTED_OPERATION: 'location-enable',
    EXPECTED_VALUES: '{}',
    FAKE_ACTIVATION_EXIT: '7',
  });

  assert.equal(result.status, 7);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '{"activation_status":"failed","error_code":"synthetic"}\n');
  assert.doesNotMatch(result.stderr, new RegExp(coolifyToken));
});

test('runbook documents secure Keychain prompts and concrete commands for every stage', () => {
  const runbook = readFileSync(resolve(root, 'docs/runbooks/calendar-location-operations.md'), 'utf8');
  assert.match(runbook, /security add-generic-password -U -a socos -s socos-google-calendar-client-id -w/);
  assert.match(runbook, /security add-generic-password -U -a socos -s socos-google-calendar-client-secret -w/);
  assert.match(runbook, /security add-generic-password -U -a socos -s coolify-cli-qed-token -w/);
  assert.match(runbook, /Never pass a password after `-w`/);
  assert.match(runbook, /run-coolify-activation\.mjs calendar-enable "\$EXPECTED_COMMIT"/);
  assert.match(runbook, /run-coolify-activation\.mjs location-enable "\$EXPECTED_COMMIT"/);
  assert.match(runbook, /run-coolify-activation\.mjs event-discovery-enable "\$EXPECTED_COMMIT" events\.example\.com/);
  assert.match(runbook, /run-coolify-activation\.mjs event-brief-enable "\$EXPECTED_COMMIT"/);
});
