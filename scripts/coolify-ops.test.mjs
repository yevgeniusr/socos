import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

function runDeploy(deployedCommit, expectedCommit, application = {
  git_branch: 'main',
  git_commit_sha: 'HEAD',
}) {
  const bin = mkdtempSync(join(tmpdir(), 'socos-coolify-test-'));
  const curl = join(bin, 'curl');
  const requests = join(bin, 'requests.log');
  writeFileSync(
    curl,
    `#!/bin/sh
printf '%s\n' "$*" >> '${requests}'
case "$*" in
  *'/api/v1/deployments/deployment-123'*) printf '%s' '${JSON.stringify({ status: 'finished', commit: deployedCommit })}' ;;
  *'/api/v1/applications/application-123'*) printf '%s' '${JSON.stringify(application)}' ;;
  *'/api/v1/deploy'*) printf '%s' '{"deployments":[{"deployment_uuid":"deployment-123"}]}' ;;
  *) exit 9 ;;
esac
`,
  );
  chmodSync(curl, 0o755);

  const result = spawnSync('bash', ['scripts/coolify.sh', 'deploy', 'application-123'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      COOLIFY_TOKEN: 'synthetic-coolify-token',
      COOLIFY_BASE_URL: 'https://coolify.example.invalid',
      COOLIFY_DEPLOY_POLL_SECONDS: '0',
      ...(expectedCommit ? { COOLIFY_EXPECTED_COMMIT_SHA: expectedCommit } : {}),
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  result.requests = existsSync(requests) ? readFileSync(requests, 'utf8') : '';
  return result;
}

test('Coolify deploy reports deployment UUID and exact commit identity', () => {
  const commit = '1234567890abcdef1234567890abcdef12345678';
  const result = runDeploy(commit, commit);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `deployment_preflight=main source_revision=HEAD verification=post-deploy\ndeployment_uuid=deployment-123\ndeployment_status=finished\ndeployment_commit=${commit}`,
  );
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-coolify-token/);
});

test('Coolify deploy rejects a non-main branch before activation', () => {
  const commit = '1234567890abcdef1234567890abcdef12345678';
  const result = runDeploy(commit, commit, { git_branch: 'develop', git_commit_sha: 'HEAD' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /main branch/);
  assert.doesNotMatch(result.requests, /\/api\/v1\/deploy(?:\s|$)/);
});

test('Coolify deploy rejects an exposed revision pin mismatch before activation', () => {
  const expected = '1234567890abcdef1234567890abcdef12345678';
  const result = runDeploy(expected, expected, {
    git_branch: 'main',
    git_commit_sha: 'abcdef1234567890abcdef1234567890abcdef12',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /revision pin/);
  assert.doesNotMatch(result.requests, /\/api\/v1\/deploy(?:\s|$)/);
});

test('Coolify deploy fails when the deployed commit is not the required commit', () => {
  const result = runDeploy(
    '1234567890abcdef1234567890abcdef12345678',
    'abcdef1234567890abcdef1234567890abcdef12',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match required commit/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-coolify-token/);
});

test('Coolify deploy without an expected SHA skips application preflight', () => {
  const commit = '1234567890abcdef1234567890abcdef12345678';
  const result = runDeploy(commit);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.requests, /\/api\/v1\/applications\/application-123/);
  assert.match(result.requests, /\/api\/v1\/deploy(?:\s|$)/);
});
