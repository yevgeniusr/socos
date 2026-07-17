import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'scripts/coolify-activate.mjs');
const expectedCommit = '1234567890abcdef1234567890abcdef12345678';
const token = 'coolify-token-must-stay-secret';
const calendarSecret = 'calendar-secret-must-stay-secret';
const managedKeys = [
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'CALENDAR_SYNC_ENABLED',
  'LOCATION_INGEST_ENABLED',
  'EVENT_SOURCE_ALLOWED_HOSTS',
  'EVENT_DISCOVERY_ENABLED',
  'EVENT_BRIEF_ENABLED',
];

const tlsKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDgPV8WLh4MwM3V
sArz5e6H/bZWLaEfCr7U7M8lyS6lU2u0/KCEQ4NzqF+F1fJpeizI+Tnq1OMxSG+n
0jlV1qPs00O0jPnS4UkcOOHyFIGPNwyKks6t1blQ1f7XFKeFqz3OOGGFEq5yVcGl
7+G0nGjUJ0o38U7Eol6ksYi2xTu9BA7g0cp6mqAIXNKocf/g+dZGljKpAotR4JuJ
xH/AqezyyV4jSmZ9Q10DmLD4RLK36lHM4yOvvcZLzVivjhRqUh6obI0Jv4w6D8du
YpvB+LxwW17WsrOkexhAxQBpnvf4oZ2qFVwkXm+qf9bzxnu54xMvl78qhZBXNllA
GwAGLJ2RAgMBAAECggEAA4e70D3UH8fGRcuydHIFfhMWtIcd3v78j54Vyca/yv8D
9lK21TY54s9/B3ydhx8TBuvzhzioRf2ZsmbrG6iYJpGR4o0IntMIo17a4cSEYKSR
eDoE8nQnqXfg/fJXi9FtFOrK0D1BzU9/z7S11THULajbsINGRe63djjMSfJTdS+M
X2PbTfyw5KdYSt1YXl8hW2DL+h03yeRSA/AMiAhozX6o2Zfxp4YuT5ykEAMItU5c
x2h1S7o+uT0cRrvBKuONzrtPnf8aon8m1j1xhumF/oNnCVgmXqcI5zJ63rn6+Nhi
UQFIJreHuJBijuDxXEB5hgeWisTLy7CiIOs/jT7ssQKBgQD2bqDO7TeUPQiLXvyH
hkSommIq3kS8+3YYqt08U86c/2MGCe+rqLR3UVGeFQs1IjQtw1ETkf0o5DpaFHJz
BygynuXqnNggxPXy2LakEDL7BSTCbrFscofDHCOQMtmHPu2G6xzargQ8/5HirNw8
BwxMMgw6n1T74RHyVsuNpYYMuQKBgQDo8ipb7Kq4lntu31o+LYy9ZTPBmHLF76qc
nIPGKlAIVE0DHc9JIuGv1+FM6QgPRayw51U48sFPMCj7C/7vUvsaLditJHWfib9+
Q9iQM4cgwCikSPGIAQg5HBlzY2iIB7YoY+KxuO2ZDoY1d7uaxexbjW2Z6vFqt+mE
nGxMWrObmQKBgCk96nu3B44viLaKdwjXV7Y/4B38hNR74Q/PyKbH/9QWiaQBFbNM
0KcHXPlv3ChQSRs/jNoRnKSzTXC161GE6R1PqnrRNPqG/AJgcnCSpXWNLtG7ZMYZ
hM8Kbok7eVxBE894maOfa+Ypf2jINTN2moBF//XvpHFjAXXlQLu77+tBAoGBAIIl
IiNfk3YzpNyp7tpESphaHVNxH9aUc0aybzDc3P/6UViHZBMhaOP8gcSdgUI/FB91
73g0sGnUp2CzMAh33RCgQqlhcFHk/NbHgwv1re5PTaWTl1X79aMqntGH3ZP6cvwX
6kSO5DgaFEN1FJyBLe9skapnx99uxwmu9xalqikpAoGBAO0enSxdmgvqVcpbBTuZ
RcQF/ZO8ct8jslZ24fz4hQoYD13bzj3MbtH4lCGImluK0tukc2LMhQKV3yQiGgag
KCU6wkVOcCjxu/B2/+m6ZWDYDCynp4Un9q++SMDf3oKBU21Jd7QNskpDeJUtQMcR
K3JocPh5kIm0LM66/vdQZxBO
-----END PRIVATE KEY-----`;

const tlsCert = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUZS+w4MtN0ZPiJOnFYn9/tkhiDSIwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDcxNzA3NTA1NloXDTI2MDcx
ODA3NTA1NlowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA4D1fFi4eDMDN1bAK8+Xuh/22Vi2hHwq+1OzPJckupVNr
tPyghEODc6hfhdXyaXosyPk56tTjMUhvp9I5Vdaj7NNDtIz50uFJHDjh8hSBjzcM
ipLOrdW5UNX+1xSnhas9zjhhhRKuclXBpe/htJxo1CdKN/FOxKJepLGItsU7vQQO
4NHKepqgCFzSqHH/4PnWRpYyqQKLUeCbicR/wKns8sleI0pmfUNdA5iw+ESyt+pR
zOMjr73GS81Yr44UalIeqGyNCb+MOg/HbmKbwfi8cFte1rKzpHsYQMUAaZ73+KGd
qhVcJF5vqn/W88Z7ueMTL5e/KoWQVzZZQBsABiydkQIDAQABo1MwUTAdBgNVHQ4E
FgQUWG5V9TCvtsA/0vAyA61RfVEX4OIwHwYDVR0jBBgwFoAUWG5V9TCvtsA/0vAy
A61RfVEX4OIwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAb+Ue
zoSevnu1ocH00XIu6vBP94x2nskzJMhcdZBKGnUUuWkVb2rN7DOuwzGGqp6XSGxj
Z+3jxpZQKxBKPXMlBAe5JVTLM7x4TmFRr4LsDnd4fX8+jYi4/i42Ee2Ks/3s0Dnb
5qbt8yECZn/afxSEeUFBjMPA+0Em9I5+59LD6T4UZjGTE/t1YTikN+7AY3Wl2qns
d2MpCuKAI65iUNGuTStmzzamYummFsbDNKk7KBxo9xFTqMN9ET4Bm2gDt7e25T1A
6JS2hKy6eNWls/pMD9FF/YlW9aiu+wucavX8CdZ8SkyWWgVfNaudsanS9gD6aJsK
Pkaf+8Z5OxlNWcBmgw==
-----END CERTIFICATE-----`;

function valueMap(overrides = {}) {
  return {
    GOOGLE_CALENDAR_CLIENT_ID: '',
    GOOGLE_CALENDAR_CLIENT_SECRET: '',
    CALENDAR_SYNC_ENABLED: 'false',
    LOCATION_INGEST_ENABLED: 'false',
    EVENT_SOURCE_ALLOWED_HOSTS: '',
    EVENT_DISCOVERY_ENABLED: 'false',
    EVENT_BRIEF_ENABLED: 'false',
    ...overrides,
  };
}

function envRecords(values = valueMap()) {
  return managedKeys.flatMap((key) => [false, true].map((is_preview) => ({
    uuid: `${key}-${is_preview ? 'preview' : 'production'}`,
    key,
    real_value: ['true', 'false'].includes(values[key]) ? `'${values[key]}'` : values[key],
    value: ['true', 'false'].includes(values[key]) ? values[key] : 'masked',
    is_preview,
    is_literal: true,
  })));
}

function effectiveValue(record) {
  return record.is_literal === true
    && typeof record.value === 'string'
    && record.real_value === `'${record.value}'`
    ? record.value
    : record.real_value;
}

function input(baseUrl, operation = 'calendar-enable', values = {
  GOOGLE_CALENDAR_CLIENT_ID: 'socos-client.apps.googleusercontent.com',
  GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
}) {
  return {
    operation,
    applicationUuid: 'application-123',
    databaseUuid: 'database-123',
    backupUuid: 'backup-config-123',
    expectedCommit,
    publicBaseUrl: baseUrl,
    values,
  };
}

async function startFake(options = {}) {
  const state = {
    application: { uuid: 'application-123', git_branch: 'main', git_commit_sha: 'HEAD', is_auto_deploy_enabled: true },
    envs: envRecords(options.values),
    requests: [],
    bodies: [],
    backupExecutions: [{ uuid: 'backup-old', status: 'success', size: 100, created_at: '2020-01-01T00:00:00.000Z' }],
    deployments: [],
    envBulkCalls: 0,
    ...options.state,
  };

  const server = createServer({ key: tlsKey, cert: tlsCert }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const path = new URL(request.url, 'https://127.0.0.1').pathname;
    state.requests.push(`${request.method} ${path}`);
    if (rawBody) state.bodies.push({ path, rawBody, body: JSON.parse(rawBody) });

    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}` && path.startsWith('/api/v1/')) {
      json(401, { error: 'unauthorized' });
      return;
    }

    if (path === '/api/v1/applications/application-123' && request.method === 'GET') {
      json(200, options.minimalApplicationResponses ? {
        git_branch: state.application.git_branch,
        git_commit_sha: state.application.git_commit_sha,
      } : state.application);
    } else if (path === '/api/v1/applications/application-123' && request.method === 'PATCH') {
      Object.assign(state.application, JSON.parse(rawBody));
      json(200, options.minimalApplicationResponses
        ? { uuid: options.patchUuid ?? 'application-123' }
        : { ...state.application, ...(options.patchUuid ? { uuid: options.patchUuid } : {}) });
    } else if (path === '/api/v1/databases/database-123/backups/backup-config-123/executions' && request.method === 'GET') {
      json(200, state.backupExecutions);
    } else if (path === '/api/v1/databases/database-123/backups/backup-config-123' && request.method === 'PATCH') {
      const createdAt = options.backup === 'stale'
        ? '2020-01-01T00:00:00.000Z'
        : options.backup === 'same-second'
          ? new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString()
          : new Date(Date.now() + 1_000).toISOString();
      const status = options.backup === 'failed' ? 'failed' : options.backup === 'timeout' ? 'running' : 'success';
      state.backupExecutions.push({
        uuid: 'backup-new',
        status,
        size: Object.hasOwn(options, 'backupSize') ? options.backupSize : '321',
        created_at: createdAt,
      });
      if (options.backup === 'ambiguous') {
        state.backupExecutions.push({ uuid: 'backup-other', status: 'success', size: 222, created_at: createdAt });
      }
      response.writeHead(204);
      response.end();
    } else if (path === '/api/v1/applications/application-123/envs' && request.method === 'GET') {
      const records = structuredClone(state.envs);
      if (options.envVerificationFailure && state.envBulkCalls === 1) {
        records.find((record) => record.key === 'LOCATION_INGEST_ENABLED' && record.is_preview).real_value = 'false';
      }
      json(200, records);
    } else if (path === '/api/v1/applications/application-123/envs/bulk' && request.method === 'PATCH') {
      state.envBulkCalls += 1;
      const { data } = JSON.parse(rawBody);
      for (const update of data) {
        const record = state.envs.find((candidate) => (
          candidate.key === update.key
          && (candidate.is_preview === true) === update.is_preview
        ));
        if (record) {
          record.real_value = update.value;
          record.value = 'masked';
          record.is_literal = update.is_literal;
        }
      }
      json(200, { message: 'updated' });
    } else if (path === '/api/v1/deploy' && request.method === 'POST') {
      const uuid = `deployment-${state.deployments.length + 1}`;
      state.deployments.push(uuid);
      json(200, { deployments: [{ deployment_uuid: uuid }] });
    } else if (/^\/api\/v1\/deployments\/deployment-\d+$/.test(path) && request.method === 'GET') {
      json(200, { status: 'finished', commit: expectedCommit });
    } else if (path === '/api/health-check' && request.method === 'GET') {
      json(200, { status: 'ok' });
    } else if (path === '/api/integrations/google-calendar' && request.method === 'GET') {
      json(401, { code: 'unauthorized' });
    } else if (path === '/api/location/owntracks' && request.method === 'POST') {
      const enabled = effectiveValue(state.envs.find((record) => record.key === 'LOCATION_INGEST_ENABLED' && !record.is_preview)) === 'true';
      const status = options.smokeFailure && state.deployments.length === 1 && enabled ? 500 : enabled ? 401 : 503;
      json(status, {});
    } else if (path === '/api/integrations/google-calendar/webhook' && request.method === 'POST') {
      const enabled = effectiveValue(state.envs.find((record) => record.key === 'CALENDAR_SYNC_ENABLED' && !record.is_preview)) === 'true';
      json(enabled ? 400 : 503, {});
    } else {
      json(404, { error: 'not found' });
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  return {
    baseUrl: `https://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function runCli(document, baseUrl, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli], {
      cwd: root,
      env: {
        ...process.env,
        COOLIFY_TOKEN: token,
        COOLIFY_BASE_URL: baseUrl,
        COOLIFY_ACTIVATION_POLL_ATTEMPTS: '2',
        COOLIFY_ACTIVATION_POLL_MS: '0',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr, spawnargs: child.spawnargs }));
    child.stdin.end(typeof document === 'string' ? document : JSON.stringify(document));
  });
}

async function withFake(options, callback) {
  const fake = await startFake(options);
  try {
    return await callback(fake);
  } finally {
    await fake.close();
  }
}

test('rejects malformed and unknown input before contacting Coolify', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const malformed = await runCli('{', baseUrl);
    const unknown = await runCli(input(baseUrl, 'enable-everything', {}), baseUrl);

    assert.notEqual(malformed.status, 0);
    assert.notEqual(unknown.status, 0);
    assert.equal(state.requests.length, 0);
    assert.match(malformed.stderr, /invalid_input/);
    assert.match(unknown.stderr, /invalid_input/);
  });
});

test('rejects placeholder credentials without disclosing them', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl, 'calendar-enable', {
      GOOGLE_CALENDAR_CLIENT_ID: 'replace-me',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'placeholder',
    }), baseUrl);

    assert.notEqual(result.status, 0);
    assert.equal(state.requests.length, 0);
    assert.match(result.stderr, /invalid_input/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /replace-me|placeholder/);
  });
});

test('rejects disabled-until and embedded placeholder credentials but accepts realistic credentials', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const placeholders = [
      'disabled-until-google-oauth-client-is-created',
      'socos-placeholder-client.apps.googleusercontent.com',
      'replace-with-real-google-secret',
    ];
    for (const placeholder of placeholders) {
      const result = await runCli(input(baseUrl, 'calendar-enable', {
        GOOGLE_CALENDAR_CLIENT_ID: placeholder,
        GOOGLE_CALENDAR_CLIENT_SECRET: placeholder,
      }), baseUrl);
      assert.notEqual(result.status, 0, placeholder);
      assert.match(result.stderr, /invalid_input/, placeholder);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(placeholder));
    }
    assert.equal(state.requests.length, 0);
  });
});

test('rejects IP literals and local or internal event hostnames before contacting Coolify', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    for (const hostname of ['127.0.0.1', 'localhost', 'events.local', 'events.internal']) {
      const result = await runCli(input(baseUrl, 'event-discovery-enable', {
        EVENT_SOURCE_ALLOWED_HOSTS: hostname,
      }), baseUrl);
      assert.notEqual(result.status, 0, hostname);
      assert.match(result.stderr, /invalid_input/, hostname);
    }
    assert.equal(state.requests.length, 0);
  });
});

test('rejects an HTTP Coolify base URL before making a request', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl, {
      COOLIFY_BASE_URL: 'http://127.0.0.1:65534',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid_configuration/);
    assert.equal(state.requests.length, 0);
  });
});

test('requires exactly one production and preview record for every managed key', async () => {
  for (const mode of ['missing', 'duplicate']) {
    const records = envRecords();
    if (mode === 'missing') records.pop();
    else records.push(structuredClone(records[0]));
    await withFake({ state: { envs: records } }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl), baseUrl);
      assert.notEqual(result.status, 0, mode);
      assert.match(result.stderr, /environment_invalid/, mode);
      assert.equal(state.envBulkCalls, 0, mode);
    });
  }
});

test('accepts null or absent is_preview as production and sends explicit false in bulk updates', async () => {
  for (const productionShape of ['null', 'absent']) {
    const records = envRecords();
    for (const record of records.filter((candidate) => candidate.is_preview === false)) {
      if (productionShape === 'null') record.is_preview = null;
      else delete record.is_preview;
    }
    await withFake({ state: { envs: records } }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl), baseUrl);
      assert.equal(result.status, 0, `${productionShape}: ${result.stderr}`);
      const updates = state.bodies.find((entry) => entry.path.endsWith('/envs/bulk')).body.data;
      assert.ok(updates.some((entry) => entry.is_preview === false), productionShape);
    });
  }
});

test('rejects non-boolean non-null preview markers', async () => {
  const records = envRecords();
  records[0].is_preview = 0;
  await withFake({ state: { envs: records } }, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /environment_invalid/);
    assert.equal(state.envBulkCalls, 0);
  });
});

test('aborts stale, ambiguous, failed, and timed-out backups before env mutation', async () => {
  for (const backup of ['stale', 'ambiguous', 'failed', 'timeout']) {
    await withFake({ backup }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl), baseUrl);
      assert.notEqual(result.status, 0, backup);
      assert.match(result.stderr, /backup_(?:stale|ambiguous|failed|timeout)/, backup);
      assert.equal(state.envBulkCalls, 0, backup);
    });
  }
});

test('triggers the configured backup with an empty successful PATCH and exact JSON body', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(state.requests.includes('PATCH /api/v1/databases/database-123/backups/backup-config-123'));
    assert.equal(state.requests.some((request) => request === 'POST /api/v1/databases/database-123/backups/backup-config-123/executions'), false);
    const trigger = state.bodies.find((entry) => (
      entry.path === '/api/v1/databases/database-123/backups/backup-config-123'
    ));
    assert.equal(trigger.rawBody, '{"backup_now":true}');
    assert.deepEqual(trigger.body, { backup_now: true });
  });
});

test('accepts canonical decimal string and positive safe-integer backup sizes', async () => {
  for (const backupSize of ['1', '9007199254740992', 1, Number.MAX_SAFE_INTEGER]) {
    await withFake({ backupSize }, async ({ baseUrl }) => {
      const result = await runCli(input(baseUrl), baseUrl);
      assert.equal(result.status, 0, `${String(backupSize)}: ${result.stderr}`);
    });
  }
});

test('rejects invalid backup size shapes before environment mutation', async () => {
  const invalidSizes = [
    ['zero number', 0],
    ['zero string', '0'],
    ['negative number', -1],
    ['negative string', '-1'],
    ['float number', 1.5],
    ['float string', '1.5'],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['noncanonical leading zero', '01'],
    ['noncanonical whitespace', ' 1'],
    ['exponent notation', '1e3'],
    ['null', null],
    ['boolean', true],
    ['object', { bytes: 1 }],
  ];
  for (const [shape, backupSize] of invalidSizes) {
    await withFake({ backupSize }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl), baseUrl);
      assert.notEqual(result.status, 0, shape);
      assert.match(result.stderr, /backup_invalid/, shape);
      assert.equal(state.envBulkCalls, 0, shape);
    });
  }
});

test('normalizes exact single-quoted literal wrappers for production and preview', async () => {
  const records = envRecords(valueMap({
    GOOGLE_CALENDAR_CLIENT_ID: 'existing-client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
    CALENDAR_SYNC_ENABLED: 'true',
  }));
  const wrapped = records.filter((record) => record.key === 'CALENDAR_SYNC_ENABLED');
  assert.deepEqual(wrapped.map((record) => record.real_value), ["'true'", "'true'"]);
  assert.deepEqual(wrapped.map((record) => record.value), ['true', 'true']);

  await withFake({ state: { envs: records } }, async ({ baseUrl }) => {
    const result = await runCli(input(baseUrl, 'location-enable', {}), baseUrl);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('preserves secret real_value when value is masked', async () => {
  const records = envRecords(valueMap({
    GOOGLE_CALENDAR_CLIENT_ID: 'existing-client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
    CALENDAR_SYNC_ENABLED: 'true',
  }));
  for (const record of records.filter((candidate) => candidate.key === 'GOOGLE_CALENDAR_CLIENT_SECRET')) {
    record.value = 'placeholder';
  }

  await withFake({ state: { envs: records } }, async ({ baseUrl }) => {
    const result = await runCli(input(baseUrl, 'location-enable', {}), baseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(calendarSecret));
  });
});

test('rejects genuinely mismatched normalized production and preview values', async () => {
  const records = envRecords();
  const preview = records.find((record) => (
    record.key === 'LOCATION_INGEST_ENABLED' && record.is_preview === true
  ));
  preview.real_value = "'true'";
  preview.value = 'true';

  await withFake({ state: { envs: records } }, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /environment_invalid/);
    assert.equal(state.envBulkCalls, 0);
  });
});

test('enforces calendar, location, discovery, and allowlist dependency order', async () => {
  const cases = [
    ['location-enable', valueMap(), {}],
    ['event-discovery-enable', valueMap({
      GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
      GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
      CALENDAR_SYNC_ENABLED: 'true',
    }), { EVENT_SOURCE_ALLOWED_HOSTS: 'events.example.com' }],
    ['event-brief-enable', valueMap({
      GOOGLE_CALENDAR_CLIENT_ID: 'client-id',
      GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
      CALENDAR_SYNC_ENABLED: 'true',
      LOCATION_INGEST_ENABLED: 'true',
      EVENT_DISCOVERY_ENABLED: 'true',
    }), {}],
  ];
  for (const [operation, values, supplied] of cases) {
    await withFake({ values }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl, operation, supplied), baseUrl);
      assert.notEqual(result.status, 0, operation);
      assert.match(result.stderr, /dependency_not_satisfied/, operation);
      assert.equal(state.envBulkCalls, 0, operation);
    });
  }
});

test('pins main to the exact commit and disables auto deploy before env mutation', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.equal(result.status, 0, result.stderr);

    const appPatch = state.requests.indexOf('PATCH /api/v1/applications/application-123');
    const envPatch = state.requests.indexOf('PATCH /api/v1/applications/application-123/envs/bulk');
    assert.ok(appPatch >= 0 && appPatch < envPatch, state.requests.join('\n'));
    assert.equal(state.application.git_commit_sha, expectedCommit);
    assert.equal(state.application.is_auto_deploy_enabled, false);
  });
});

test('accepts minimal real Coolify PATCH and GET application response shapes', async () => {
  await withFake({ minimalApplicationResponses: true }, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.equal(result.status, 0, result.stderr);
    const patchBody = state.bodies.find((entry) => entry.path === '/api/v1/applications/application-123').body;
    assert.deepEqual(patchBody, { git_commit_sha: expectedCommit, is_auto_deploy_enabled: false });
  });
});

test('requires the application PATCH response to identify the exact application', async () => {
  await withFake({ patchUuid: 'different-application' }, async ({ baseUrl, state }) => {
    const result = await runCli(input(baseUrl), baseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /application_pin_failed/);
    assert.equal(state.envBulkCalls, 0);
  });
});

test('accepts a successful backup timestamp rounded to the command start second', async () => {
  await withFake({ backup: 'same-second' }, async ({ baseUrl }) => {
    const waitForFreshSecond = (1_025 - (Date.now() % 1_000)) % 1_000;
    await new Promise((resolveWait) => setTimeout(resolveWait, waitForFreshSecond));
    const result = await runCli(input(baseUrl), baseUrl);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('updates paired calendar values, deploys the pinned commit, and emits only a redacted receipt', async () => {
  await withFake({}, async ({ baseUrl, state }) => {
    const document = input(baseUrl);
    const result = await runCli(document, baseUrl);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      activation_status: 'succeeded',
      operation: 'calendar-enable',
      backup_uuid: 'backup-new',
      deployment_uuid: 'deployment-1',
      deployment_commit: expectedCommit,
      health_status: 200,
      calendar_guard_status: 401,
      location_status: 503,
      calendar_webhook_status: 400,
    });
    const calendarUpdates = state.bodies.find((entry) => entry.path.endsWith('/envs/bulk')).body.data;
    assert.equal(calendarUpdates.length, 6);
    assert.deepEqual(new Set(calendarUpdates.map((entry) => entry.is_preview)), new Set([false, true]));
    assert.ok(calendarUpdates.every((entry) => entry.is_literal === true));
    assert.equal(state.deployments.length, 1);

    const exposed = `${result.spawnargs.join(' ')}\n${result.stdout}\n${result.stderr}\n${state.requests.join('\n')}`;
    assert.doesNotMatch(exposed, new RegExp(`${token}|${calendarSecret}`));
    assert.match(JSON.stringify(state.bodies), new RegExp(calendarSecret));
  });
});

for (const failure of ['envVerificationFailure', 'smokeFailure']) {
  test(`${failure} restores the snapshot, redeploys, and smokes the prior state`, async () => {
    const prior = valueMap({
      GOOGLE_CALENDAR_CLIENT_ID: 'existing-client-id',
      GOOGLE_CALENDAR_CLIENT_SECRET: calendarSecret,
      CALENDAR_SYNC_ENABLED: 'true',
    });
    await withFake({ values: prior, [failure]: true }, async ({ baseUrl, state }) => {
      const result = await runCli(input(baseUrl, 'location-enable', {}), baseUrl);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /"rollback_status":"succeeded"/);
      assert.equal(state.envBulkCalls, 2);
      assert.equal(state.deployments.length, failure === 'envVerificationFailure' ? 1 : 2);
      for (const key of managedKeys) {
        const records = state.envs.filter((record) => record.key === key);
        assert.deepEqual(records.map((record) => record.real_value), [prior[key], prior[key]], key);
      }
      assert.equal(state.requests.at(-4), 'GET /api/health-check');
      assert.deepEqual(state.requests.slice(-4), [
        'GET /api/health-check',
        'GET /api/integrations/google-calendar',
        'POST /api/location/owntracks',
        'POST /api/integrations/google-calendar/webhook',
      ]);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(`${token}|${calendarSecret}`));
    });
  });
}

test('runbook uses the checked-in wrapper and forbids secret-bearing intermediates', () => {
  const runbook = readFileSync(resolve(root, 'docs/runbooks/calendar-location-operations.md'), 'utf8');
  assert.match(runbook, /\.\/scripts\/run-coolify-activation\.mjs calendar-enable/);
  assert.doesNotMatch(runbook, /secret-runner/);
  assert.match(runbook, /Do not put the activation document[\s\S]*in a file, here-document, command argument/);
});
