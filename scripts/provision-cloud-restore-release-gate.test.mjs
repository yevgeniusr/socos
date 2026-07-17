import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { DEFAULT_SSH_TIMEOUT_MS } from './run-cloud-restore-release-gate.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const provisioner = join(repositoryRoot, 'scripts/provision-cloud-restore-release-gate.sh');
const trustedSha = '1b15d1a239fa5fdf992d2ee49deb6e191733ef0d';
const token = 'synthetic-coolify-token-that-must-not-leak';

function executable(path, body) {
  writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'socos-release-provision-'));
  const root = join(dir, 'root');
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  const log = join(dir, 'commands.log');
  mkdirSync(root);
  mkdirSync(bin);
  mkdirSync(state);

  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'synthetic@test', '-f', join(dir, 'key')]);
  const authorizedKey = readFileSync(join(dir, 'key.pub'), 'utf8').trim();

  const shim = join(bin, 'shim');
  executable(shim, `
name=$(basename "$0")
printf '%s' "$name" >> "$SHIM_LOG"
printf ' <%s>' "$@" >> "$SHIM_LOG"
printf '\\n' >> "$SHIM_LOG"
case "$name" in
  getent)
    [[ -f "$SHIM_STATE/account" ]] && printf '%s\\n' 'socos-release-gate:x:991:991::/var/lib/socos-release-gate:/bin/sh'
    ;;
  useradd)
    : > "$SHIM_STATE/account"
    ;;
  usermod|passwd|visudo)
    ;;
  openssl)
    count_file="$SHIM_STATE/random-count"
    count=0
    [[ -f "$count_file" ]] && count=$(<"$count_file")
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    printf '%064x\\n' "$count"
    ;;
  git)
    if [[ " $* " == *' remote get-url origin '* ]]; then
      printf '%s\\n' 'https://github.com/yevgeniusr/socos.git'
    elif [[ " $* " == *' rev-parse refs/remotes/origin/main '* || " $* " == *' rev-parse HEAD '* ]]; then
      printf '%s\\n' '${trustedSha}'
    elif [[ " $* " == *' status --porcelain --untracked-files=no '* && "\${SHIM_DIRTY:-0}" == '1' ]]; then
      printf '%s\\n' ' M package.json'
    fi
    ;;
  docker)
    if [[ " $* " == *' image inspect '* ]]; then
      [[ -f "$SHIM_STATE/runtime-image" ]]
    elif [[ " $* " == *' build '* ]]; then
      cp "\${!#}/Dockerfile" "$SHIM_STATE/runtime.Dockerfile"
      : > "$SHIM_STATE/runtime-image"
    elif [[ " $* " == *' run '* && " $* " == *' pnpm install --frozen-lockfile '* && "\${SHIM_FAIL_INSTALL:-0}" == '1' ]]; then
      exit 1
    elif [[ " $* " == *' ps '* ]]; then
      printf '%s\\n' 'api-swwcg80gkw4k0k4oco8w8wgw-current'
    elif [[ " $* " == *' exec '* && " $* " == *'DATABASE_URL'* ]]; then
      printf '%s' 'postgresql://socos_app:synthetic-production-password@zwkk0scogckskkwss8oo48k4:5432/socos?schema=public'
    elif [[ " $* " == *' exec '* && " $* " == *'pg_control_system'* ]]; then
      printf '%s\\n' '7493810472398012345'
    elif [[ " $* " == *' exec '* && " $* " == *' psql '* ]]; then
      cat >> "$SHIM_STATE/role-sql"
    elif [[ " $* " == *' run '* && " $* " == *' scripts/cloud-restore-release-gate.mjs '* ]]; then
      printf '%s\\n' '{"gate":"socos-cloud-restore-release","version":1,"status":"passed"}'
    fi
    ;;
  timeout)
    shift
    exec "$@"
    ;;
  sudo)
    [[ "\${1:-}" == '-n' ]] && shift
    exec "$@"
    ;;
esac
`);
  for (const name of ['getent', 'useradd', 'usermod', 'passwd', 'visudo', 'openssl', 'git', 'docker', 'flock', 'chown', 'timeout', 'sudo']) {
    execFileSync('ln', ['-s', shim, join(bin, name)]);
  }

  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    SHIM_LOG: log,
    SHIM_STATE: state,
    SOCOS_PROVISION_TEST_ROOT: root,
    SOCOS_PROVISION_TEST_EUID: '0',
    SOCOS_PROVISION_TEST_BIN: bin,
  };
  const input = `${JSON.stringify({ authorized_key: authorizedKey, coolify_token: token })}\n`;
  return { dir, root, bin, state, log, env, input, authorizedKey };
}

function run(input, env, args = []) {
  return spawnSync('bash', [provisioner, ...args], { encoding: 'utf8', input, env });
}

test('local wrapper defaults to a one-hour end-to-end SSH timeout', () => {
  assert.equal(DEFAULT_SSH_TIMEOUT_MS, 3_600_000);
});

test('provisioner rejects non-root, arguments, invalid JSON, extra fields, and malformed credentials', () => {
  const f = fixture();
  const cases = [
    [f.input, { ...f.env, SOCOS_PROVISION_TEST_EUID: '1000' }, []],
    [f.input, f.env, ['unexpected']],
    ['not-json\n', f.env, []],
    [`${JSON.stringify({ authorized_key: f.authorizedKey, coolify_token: token, extra: true })}\n`, f.env, []],
    [`${JSON.stringify({ authorized_key: 'ssh-rsa invalid', coolify_token: token })}\n`, f.env, []],
    [`${JSON.stringify({ authorized_key: f.authorizedKey, coolify_token: 'bad\ntoken' })}\n`, f.env, []],
  ];
  for (const [input, env, args] of cases) {
    const result = run(input, env, args);
    assert.notEqual(result.status, 0, input);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /synthetic-coolify|ssh-(?:rsa|ed25519)|production-password/);
  }
});

test('provisioner renders the locked account, exact resources, database boundary, and root-only files without disclosure', () => {
  const f = fixture();
  const result = run(f.input, f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `provision_status=ready\ntrusted_sha=${trustedSha}\n`);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(`${token}|synthetic-production-password`));

  const keyFile = join(f.root, 'var/lib/socos-release-gate/.ssh/authorized_keys');
  const keyLines = readFileSync(keyFile, 'utf8').trim().split('\n');
  assert.equal(keyLines.length, 1);
  assert.equal(
    keyLines[0],
    `restrict,command="/usr/local/sbin/socos-release-gate-dispatch" ${f.authorizedKey}`,
  );
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);

  const sudoers = readFileSync(join(f.root, 'etc/sudoers.d/socos-release-gate'), 'utf8');
  assert.match(sudoers, /^Defaults:socos-release-gate env_reset,!setenv,/m);
  assert.doesNotMatch(sudoers, /env_keep|SSH_ORIGINAL_COMMAND/);
  assert.match(sudoers, /^socos-release-gate ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/socos-release-gate-launcher$/m);
  assert.equal(statSync(join(f.root, 'etc/sudoers.d/socos-release-gate')).mode & 0o777, 0o440);
  const dispatcherPath = join(f.root, 'usr/local/sbin/socos-release-gate-dispatch');
  assert.equal(statSync(dispatcherPath).mode & 0o777, 0o755);
  const dispatcher = readFileSync(dispatcherPath, 'utf8');
  assert.match(dispatcher, /^#!\/bin\/bash\n/);
  assert.match(dispatcher, /\[\[ "\$#" -eq 0 \]\] \|\| exit 1/);
  assert.ok(dispatcher.indexOf('SSH_ORIGINAL_COMMAND') < dispatcher.indexOf('exec sudo -n'));
  assert.doesNotMatch(dispatcher, /synthetic-coolify|production-password/);

  const envFile = readFileSync(join(f.root, 'etc/socos-release-gate.env'), 'utf8');
  for (const expected of [
    'SOCOS_RELEASE_GATE_COOLIFY_BASE_URL=https://qed.quest',
    'SOCOS_RELEASE_GATE_DATABASE_UUID=zwkk0scogckskkwss8oo48k4',
    'SOCOS_RELEASE_GATE_BACKUP_UUID=b85nxfljaz0xpo9xqa57lfr4',
    'SOCOS_RELEASE_GATE_OPERATION_TIMEOUT_MS=1800000',
    'SOCOS_RELEASE_GATE_CLEANUP_TIMEOUT_MS=120000',
  ]) assert.match(envFile, new RegExp(`^${expected}$`, 'm'));
  assert.equal(statSync(join(f.root, 'etc/socos-release-gate.env')).mode & 0o777, 0o600);

  const sql = readFileSync(join(f.state, 'role-sql'), 'utf8');
  assert.match(sql, /ALTER ROLE socos_release_gate_admin .* CREATEDB /);
  assert.match(sql, /ALTER ROLE socos_release_gate_restore .* NOINHERIT NOCREATEDB /);
  assert.match(sql, /REVOKE CONNECT ON DATABASE socos FROM PUBLIC/);
  assert.match(sql, /GRANT CONNECT ON DATABASE socos TO postgres, socos_app/);
  assert.match(sql, /REVOKE CONNECT ON DATABASE socos FROM socos_release_gate_admin, socos_release_gate_restore/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.match(sql, /REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC/);

  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /usermod .*<--shell> <\/bin\/sh>/);
  assert.match(calls, /usermod .*<--groups> <>/);
  assert.match(calls, /passwd .*<--lock> <socos-release-gate>/);
  assert.match(calls, /git .*<fetch> <--no-tags> <--prune> <origin> <\+refs\/heads\/main:refs\/remotes\/origin\/main>/);
  assert.match(calls, /docker .*<build> .*<socos-release-gate-runtime:node22-pnpm10\.10\.0-pg16-v2>/);
  assert.match(calls, /docker .*<run> .*pg_dump psql pg_restore createdb dropdb.*16\./s);
  assert.match(calls, /docker .*<psql> .*<--username=postgres>/);
  const runtimeDockerfile = readFileSync(join(f.state, 'runtime.Dockerfile'), 'utf8');
  assert.match(
    runtimeDockerfile,
    /rm -f \/usr\/local\/bin\/yarn \/usr\/local\/bin\/yarnpkg[\s\\]+&& corepack enable pnpm/,
  );
  assert.doesNotMatch(runtimeDockerfile, /corepack enable(?:\s*\\)?\s*&&/);
  assert.match(calls, /^chown <root:root> .*socos-release-gate-dispatch> <.*socos-release-gate-launcher>$/m);
  assert.match(calls, /flock <-x>/);
  assert.doesNotMatch(calls, new RegExp(`${token}|synthetic-production-password`));
});

test('package wiring and runbook cover secure provisioning, audits, rotation, stale locks, and the exact candidate', () => {
  const pkg = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /scripts\/provision-cloud-restore-release-gate\.test\.mjs/);

  const runbook = readFileSync(join(repositoryRoot, 'docs/runbooks/database-backup-restore.md'), 'utf8');
  for (const expected of [
    /security find-generic-password -w -a socos -s coolify-cli-qed-token/,
    /jq -cn --arg authorized_key "\$authorized_key" --arg coolify_token "\$coolify_token"/,
    /StrictHostKeyChecking=yes/,
    /trap clear_provision_secrets EXIT\n/,
    /git fetch --no-tags --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main/,
    /git checkout --detach refs\/remotes\/origin\/main/,
    /git status --porcelain --untracked-files=no/,
    /audit_rejected remote-command/,
    /audit_rejected sftp sftp/,
    /audit_rejected\(\)/,
    /124\) printf '%s\\n' 'audit_status=timeout'/,
    /printf '%s\\n' "\$audit_candidate" \| audit_rejected remote-command/,
    /git fetch --no-tags --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main >\/dev\/null 2>&1/,
    /git checkout --detach refs\/remotes\/origin\/main >\/dev\/null 2>&1/,
    /sudo -l -U socos-release-gate/,
    /socos_release_gate_admin/,
    /socos_release_gate_restore/,
    /pg_auth_members/,
    /token and role rotation/i,
    /rmdir \/var\/lock\/socos-release-gate\/gate\.lock/,
    /084b7addb0ccc765aa343c5412ed8f5fe5f6da0b.*ancestor/s,
  ]) assert.match(runbook, expected);
  assert.doesNotMatch(runbook, /exact trusted `origin\/main` is currently\s*`[0-9a-f]{40}`/);
  assert.doesNotMatch(runbook, /&& exit 1 \|\| true/);
});

test('provisioner is idempotent and its launcher rejects command/input abuse before exact-ref execution', () => {
  const f = fixture();
  assert.equal(run(f.input, f.env).status, 0);
  assert.equal(run(f.input, f.env).status, 0);
  const keyFile = join(f.root, 'var/lib/socos-release-gate/.ssh/authorized_keys');
  assert.equal(readFileSync(keyFile, 'utf8').trim().split('\n').length, 1);
  const provisionCalls = readFileSync(f.log, 'utf8');
  assert.equal((provisionCalls.match(/docker <build>/g) ?? []).length, 1);

  const launcher = join(f.root, 'usr/local/sbin/socos-release-gate-launcher');
  const dispatcher = join(f.root, 'usr/local/sbin/socos-release-gate-dispatch');
  assert.equal(statSync(launcher).mode & 0o777, 0o755);
  const before = readFileSync(f.log, 'utf8');
  for (const [command, input, extraEnv] of [
    [launcher, `${trustedSha}\nextra\n`, {}],
    [dispatcher, `${trustedSha}\n`, { SSH_ORIGINAL_COMMAND: 'sh' }],
    [launcher, `${'a'.repeat(40)}\n`, {}],
  ]) {
    const result = spawnSync(command, { encoding: 'utf8', input, env: { ...f.env, ...extraEnv } });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic-coolify|production-password/);
    if (command === dispatcher) {
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    }
  }
  const dispatcherWithArgs = spawnSync(dispatcher, ['unexpected'], {
    encoding: 'utf8',
    input: `${trustedSha}\n`,
    env: f.env,
  });
  assert.notEqual(dispatcherWithArgs.status, 0);
  assert.equal(dispatcherWithArgs.stdout, '');
  assert.equal(dispatcherWithArgs.stderr, '');
  const after = readFileSync(f.log, 'utf8');
  assert.equal((after.slice(before.length).match(/scripts\/cloud-restore-release-gate\.mjs/g) ?? []).length, 0);

  const success = spawnSync(dispatcher, { encoding: 'utf8', input: `${trustedSha}\n`, env: f.env });
  assert.equal(success.status, 0, success.stderr);
  const launcherCalls = readFileSync(f.log, 'utf8').slice(after.length);
  assert.match(launcherCalls, /git .*<rev-parse> <refs\/remotes\/origin\/main>/);
  assert.match(launcherCalls, /docker .*<run> .*<--network> <coolify>/);
  assert.match(launcherCalls, /docker .*<run> .*<--cap-drop> <ALL> .*<no-new-privileges:true>/);
  const installCall = launcherCalls.split('\n').find((line) => line.includes('<pnpm> <install> <--frozen-lockfile>'));
  assert.ok(installCall);
  assert.match(installCall, /dst=\/gate\/runner/);
  assert.doesNotMatch(installCall, /dst=\/gate\/repository|<--env-file>/);
  assert.match(launcherCalls, /docker .*<run> <-i> .*<scripts\/cloud-restore-release-gate\.mjs>/);
  assert.match(launcherCalls, /git .*<worktree> <add> <--detach>/);
  assert.match(launcherCalls, /git .*<worktree> <remove> <--force>/);
  assert.match(launcherCalls, /sudo <-n> <.*socos-release-gate-launcher>/);
});

test('dirty trusted checkout fails closed and runner worktree cleanup runs after install failure', () => {
  const f = fixture();
  assert.equal(run(f.input, f.env).status, 0);
  assert.notEqual(run(f.input, { ...f.env, SHIM_DIRTY: '1' }).status, 0);
  const launcher = join(f.root, 'usr/local/sbin/socos-release-gate-launcher');

  const dirty = spawnSync(launcher, {
    encoding: 'utf8',
    input: `${trustedSha}\n`,
    env: { ...f.env, SHIM_DIRTY: '1' },
  });
  assert.notEqual(dirty.status, 0);

  const beforeFailure = readFileSync(f.log, 'utf8').length;
  const installFailure = spawnSync(launcher, {
    encoding: 'utf8',
    input: `${trustedSha}\n`,
    env: { ...f.env, SHIM_FAIL_INSTALL: '1' },
  });
  assert.notEqual(installFailure.status, 0);
  const failureCalls = readFileSync(f.log, 'utf8').slice(beforeFailure);
  assert.match(failureCalls, /git .*<worktree> <add> <--detach>/);
  assert.match(failureCalls, /timeout <120> <git> .*<worktree> <remove> <--force>/);
  assert.doesNotMatch(failureCalls, /scripts\/cloud-restore-release-gate\.mjs/);
});
