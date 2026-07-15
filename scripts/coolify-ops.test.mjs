import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('Coolify automation fails on HTTP errors and waits for deployments', () => {
  const script = readFileSync(resolve(root, 'scripts/coolify.sh'), 'utf8');

  assert.match(script, /--fail-with-body/);
  assert.match(script, /\/api\/v1\/deploy/);
  assert.match(script, /\/api\/v1\/deployments\/\$deployment_uuid/);
  assert.match(script, /finished\)/);
  assert.match(script, /failed\|cancelled\|cancelled-by-user/);
});
