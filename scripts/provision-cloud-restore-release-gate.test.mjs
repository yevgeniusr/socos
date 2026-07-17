import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
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
  writeFileSync(join(state, 'production-role-sql'), '');
  writeFileSync(join(state, 'acl-events'), '');

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
  chmod)
    if [[ " $* " == *'/socos-release-gate.env.'* ]]; then
      [[ $(wc -l < "\${!#}" | tr -d '[:space:]') == '13' ]] || exit 1
      printf '%s\\n' 'env_stage' >> "$SHIM_STATE/acl-events"
    fi
    /bin/chmod "$@"
    ;;
  mv)
    if [[ " \${!#} " == *'/etc/socos-release-gate.env '* ]]; then
      if [[ "\${SHIM_FAIL_ENV_MV_ONCE:-0}" == '1' && ! -f "$SHIM_STATE/env-mv-failed" ]]; then
        : > "$SHIM_STATE/env-mv-failed"
        exit 1
      fi
      printf '%s\\n' 'env_publish' >> "$SHIM_STATE/acl-events"
    fi
    /bin/mv "$@"
    ;;
  id)
    [[ " $* " == *' -gn socos-release-gate '* ]] && printf '%s\n' 'socos-release-gate'
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
    elif [[ " $* " == *' exec '* && " $* " == *'rolcanlogin'* ]]; then
      if [[ "\${SHIM_UNEXPECTED_LOGIN:-0}" == '1' ]]; then
        printf '%s\\n' 'f'
      else
        printf '%s\\n' 't'
      fi
    elif [[ " $* " == *' exec '* && " $* " == *'clock_timestamp'* ]]; then
      printf '%s\\n' 'cutoff' >> "$SHIM_STATE/acl-events"
      printf '%s\\n' "\${SHIM_ACL_CUTOFF_OUTPUT:-1784289600000000}"
    elif [[ " $* " == *' exec '* && " $* " == *'pg_stat_activity'* ]]; then
      printf '%s\\n' 'poll' >> "$SHIM_STATE/acl-events"
      poll_count=0
      [[ -f "$SHIM_STATE/acl-poll-count" ]] && poll_count=$(<"$SHIM_STATE/acl-poll-count")
      printf '%s' "$((poll_count + 1))" > "$SHIM_STATE/acl-poll-count"
      if [[ -n "\${SHIM_ACL_QUIESCENCE_OUTPUT:-}" ]]; then
        printf '%s\\n' "$SHIM_ACL_QUIESCENCE_OUTPUT"
      elif [[ "\${SHIM_ACL_QUIESCENCE_FAIL:-0}" == '1' ]]; then
        printf '%s\\n' 'f'
      else
        printf '%s\\n' 't'
      fi
    elif [[ " $* " == *' run '* && " $* " == *' --env-file '* && " $* " == *' psql '* ]]; then
      args=("$@")
      for ((index = 0; index < \${#args[@]}; index += 1)); do
        if [[ "\${args[$index]}" == '--env-file' ]]; then
          probe_env=\${args[$((index + 1))]}
          break
        fi
      done
      [[ -n "\${probe_env:-}" && -f "$probe_env" ]] || exit 1
      probe_user=$(sed -n 's/^PGUSER=//p' "$probe_env")
      probe_database=$(sed -n 's/^PGDATABASE=//p' "$probe_env")
      probe_password=$(sed -n 's/^PGPASSWORD=//p' "$probe_env")
      [[ "$probe_password" =~ ^[0-9a-f]{64}$ ]] || exit 1
      printf 'probe_%s\\n' "\${probe_user#socos_release_gate_}" >> "$SHIM_STATE/acl-events"
      if [[ "\${SHIM_FAIL_CREDENTIAL_PROBE:-}" == 'all' || "\${SHIM_FAIL_CREDENTIAL_PROBE:-}" == "$probe_user" ]]; then
        exit 1
      fi
      printf '%s|%s\\n' "$probe_user" "$probe_database"
    elif [[ " $* " == *' exec '* && " $* " == *' psql '* ]]; then
      if [[ " $* " == *' --dbname=socos '* ]]; then
        phase_count=0
        [[ -f "$SHIM_STATE/production-role-sql-count" ]] && phase_count=$(<"$SHIM_STATE/production-role-sql-count")
        phase_count=$((phase_count + 1))
        printf '%s' "$phase_count" > "$SHIM_STATE/production-role-sql-count"
        cat > "$SHIM_STATE/production-role-sql-$phase_count"
        cat "$SHIM_STATE/production-role-sql-$phase_count" >> "$SHIM_STATE/production-role-sql"
        printf 'phase_%s\\n' "$phase_count" >> "$SHIM_STATE/acl-events"
        if [[ "$phase_count" -eq 2 && "\${SHIM_FAIL_PHASE_B:-0}" == '1' ]]; then
          exit 1
        fi
      else
        role_phase_count=0
        [[ -f "$SHIM_STATE/role-sql-count" ]] && role_phase_count=$(<"$SHIM_STATE/role-sql-count")
        role_phase_count=$((role_phase_count + 1))
        printf '%s' "$role_phase_count" > "$SHIM_STATE/role-sql-count"
        cat > "$SHIM_STATE/role-sql-$role_phase_count"
        cat "$SHIM_STATE/role-sql-$role_phase_count" >> "$SHIM_STATE/role-sql"
        printf 'role_%s\\n' "$role_phase_count" >> "$SHIM_STATE/acl-events"
        if [[ "$role_phase_count" -eq 2 && "\${SHIM_UNCERTAIN_ROTATION:-0}" == '1' ]]; then
          exit 1
        fi
      fi
    elif [[ " $* " == *' run '* && " $* " == *' scripts/cloud-restore-release-gate.mjs '* ]]; then
      printf '%s\\n' '{"gate":"socos-cloud-restore-release","version":1,"status":"passed"}'
    fi
    ;;
  timeout)
    [[ "\${1:-}" == '--signal=TERM' ]] && shift
    [[ "\${1:-}" == '--kill-after=5s' ]] && shift
    timeout_seconds=\${1:-}
    shift
    if [[ "\${SHIM_HANG_ACL_QUERY:-}" == 'cutoff' && " $* " == *'clock_timestamp'* ]]; then
      exit 124
    fi
    if [[ "\${SHIM_HANG_ACL_QUERY:-}" == 'poll' && " $* " == *'pg_stat_activity'* ]]; then
      exit 124
    fi
    exec "$@"
    ;;
  sleep)
    ;;
  sudo)
    [[ "\${1:-}" == '-n' ]] && shift
    exec "$@"
    ;;
esac
`);
  for (const name of ['getent', 'useradd', 'usermod', 'passwd', 'visudo', 'id', 'openssl', 'git', 'docker', 'flock', 'chown', 'chmod', 'mv', 'timeout', 'sudo', 'sleep']) {
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

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
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
  assert.equal(statSync(join(f.root, 'var/lib/socos-release-gate/.ssh')).mode & 0o777, 0o750);
  assert.equal(statSync(keyFile).mode & 0o777, 0o640);

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
  assert.match(
    envFile,
    /^SOCOS_RELEASE_GATE_DATABASE_URL=postgresql:\/\/socos_release_gate_read:[0-9a-f]{64}@zwkk0scogckskkwss8oo48k4:5432\/socos$/m,
  );
  assert.doesNotMatch(envFile, /synthetic-production-password|postgresql:\/\/socos_app:/);
  const gatePasswords = [...envFile.matchAll(/postgresql:\/\/socos_release_gate_(?:read|admin|restore):([0-9a-f]{64})@/g)]
    .map((match) => match[1]);
  assert.equal(gatePasswords.length, 3);
  assert.equal(new Set(gatePasswords).size, 3);
  assert.equal(statSync(join(f.root, 'etc/socos-release-gate.env')).mode & 0o777, 0o600);

  const sql = readFileSync(join(f.state, 'role-sql'), 'utf8');
  const rolePhaseA = readFileSync(join(f.state, 'role-sql-1'), 'utf8');
  const passwordPhase = readFileSync(join(f.state, 'role-sql-2'), 'utf8');
  const productionSql = readFileSync(join(f.state, 'production-role-sql'), 'utf8');
  const productionPhaseA = readFileSync(join(f.state, 'production-role-sql-1'), 'utf8');
  const productionPhaseB = readFileSync(join(f.state, 'production-role-sql-2'), 'utf8');
  assert.equal(
    readFileSync(join(f.state, 'acl-events'), 'utf8'),
    'role_1\nphase_1\ncutoff\npoll\nphase_2\nenv_stage\nrole_2\nprobe_read\nprobe_admin\nprobe_restore\nenv_publish\n',
  );
  const calls = readFileSync(f.log, 'utf8');
  const generatedPasswords = [1, 2, 3].map((value) => value.toString(16).padStart(64, '0'));
  for (const password of generatedPasswords) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(password), false);
    assert.equal(calls.includes(password), false);
  }
  assert.match(calls, /xact_start <= to_timestamp\(1784289600000000 \/ 1000000\.0\)/);
  assert.match(calls, /pg_prepared_xacts WHERE owner = 'socos_app'/);
  assert.doesNotMatch(calls, /pg_prepared_xacts WHERE[^;]*prepared/);
  assert.match(calls, /timeout <--signal=TERM> <--kill-after=5s> <10> <docker> <exec>/);
  assert.doesNotMatch(rolePhaseA, /\bPASSWORD\b/);
  assert.match(rolePhaseA, /ALTER ROLE socos_release_gate_read WITH LOGIN NOSUPERUSER/);
  assert.match(passwordPhase, /^BEGIN;[\s\S]*ALTER ROLE socos_release_gate_read WITH PASSWORD '[0-9a-f]{64}';/);
  assert.match(passwordPhase, /ALTER ROLE socos_release_gate_admin WITH PASSWORD '[0-9a-f]{64}';/);
  assert.match(passwordPhase, /ALTER ROLE socos_release_gate_restore WITH PASSWORD '[0-9a-f]{64}';[\s\S]*COMMIT;\n$/);
  const probeCalls = calls
    .split('\n')
    .filter((line) => line.startsWith('docker ') && line.includes('<--env-file>') && line.includes('<psql>'));
  assert.equal(probeCalls.length, 3);
  for (const call of probeCalls) {
    assert.match(
      call,
      /docker <run> <--rm> <--network> <coolify> <--cap-drop> <ALL> <--security-opt> <no-new-privileges:true> <--env-file> <[^>]+> <socos-release-gate-runtime:[^>]+> <psql>/,
    );
    assert.match(call, /<--command=SELECT current_user, current_database\(\);>/);
    assert.doesNotMatch(
      call,
      /postgresql:\/\/|PGPASSWORD|000000000000000000000000000000000000000000000000000000000000000[123]/,
    );
  }
  assert.match(productionPhaseA, /^BEGIN;[\s\S]*ALTER DEFAULT PRIVILEGES FOR ROLE socos_app/);
  assert.match(productionPhaseA, /COMMIT;\n$/);
  assert.doesNotMatch(productionPhaseA, /ON ALL (?:TABLES|SEQUENCES|ROUTINES)/);
  assert.match(productionPhaseB, /^BEGIN;[\s\S]*ON ALL TABLES[\s\S]*ON ALL SEQUENCES[\s\S]*ON ALL ROUTINES/);
  assert.match(productionPhaseB, /COMMIT;\n$/);
  assert.doesNotMatch(productionPhaseB, /ALTER DEFAULT PRIVILEGES/);
  assert.match(sql, /CREATE ROLE socos_release_gate_read LOGIN/);
  assert.match(sql, /ALTER ROLE socos_release_gate_admin .* CREATEDB /);
  assert.match(sql, /ALTER ROLE socos_release_gate_restore .* NOINHERIT NOCREATEDB /);
  assert.match(sql, /ALTER ROLE socos_release_gate_read .* NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(sql, /member_role\.rolname IN \([^)]*'socos_release_gate_read'[^)]*\)/);
  assert.match(sql, /REVOKE %I FROM socos_release_gate_read/);
  assert.match(sql, /REVOKE CONNECT ON DATABASE socos FROM PUBLIC/);
  assert.match(sql, /GRANT CONNECT ON DATABASE socos TO postgres, socos_app/);
  assert.match(sql, /REVOKE CONNECT ON DATABASE socos FROM socos_release_gate_admin, socos_release_gate_restore/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON DATABASE postgres FROM socos_release_gate_read/);
  assert.match(sql, /REVOKE CONNECT ON DATABASE postgres FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT CONNECT ON DATABASE postgres TO[^;]*socos_release_gate_read/);
  assert.match(sql, /REVOKE CONNECT ON DATABASE template1 FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON DATABASE template1 FROM socos_release_gate_read, socos_release_gate_admin, socos_release_gate_restore/);
  assert.doesNotMatch(sql, /GRANT CONNECT ON DATABASE template1 TO[^;]*socos_release_gate_(?:read|admin|restore)/);
  assert.match(sql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.match(sql, /REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC/);
  assert.match(productionSql, /REVOKE ALL PRIVILEGES ON DATABASE socos FROM socos_release_gate_read/);
  assert.match(productionSql, /REVOKE CREATE ON DATABASE socos FROM PUBLIC/);
  assert.match(productionSql, /app_had_temporary boolean := has_database_privilege\('socos_app', 'socos', 'TEMPORARY'\)/);
  assert.match(productionSql, /REVOKE TEMPORARY ON DATABASE socos FROM PUBLIC/);
  assert.match(productionSql, /IF app_had_temporary THEN[\s\S]*GRANT TEMPORARY ON DATABASE socos TO socos_app/);
  assert.match(productionSql, /GRANT CONNECT ON DATABASE socos TO socos_release_gate_read/);
  assert.match(productionSql, /REVOKE ALL PRIVILEGES ON SCHEMA public FROM socos_release_gate_read/);
  assert.match(productionSql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/);
  assert.match(productionSql, /GRANT USAGE ON SCHEMA public TO socos_release_gate_read/);
  assert.match(productionSql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM socos_release_gate_read/);
  assert.match(productionSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC/);
  assert.match(productionSql, /GRANT SELECT ON ALL TABLES IN SCHEMA public TO socos_release_gate_read/);
  assert.match(productionSql, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM socos_release_gate_read/);
  assert.match(productionSql, /GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO socos_release_gate_read/);
  assert.match(productionSql, /REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC/);
  assert.match(productionSql, /REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM socos_release_gate_read/);
  assert.match(productionSql, /ALTER DEFAULT PRIVILEGES FOR ROLE socos_app REVOKE EXECUTE ON ROUTINES FROM PUBLIC/);
  assert.doesNotMatch(productionSql, /ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM PUBLIC/);
  assert.match(productionSql, /ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON TABLES TO socos_release_gate_read/);
  assert.match(productionSql, /ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON SEQUENCES TO socos_release_gate_read/);
  const defaultAclEnd = Math.max(
    productionSql.indexOf('ALTER DEFAULT PRIVILEGES FOR ROLE socos_app REVOKE EXECUTE ON ROUTINES FROM PUBLIC;'),
    productionSql.indexOf('ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON TABLES TO socos_release_gate_read;'),
    productionSql.indexOf('ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON SEQUENCES TO socos_release_gate_read;'),
  );
  const currentObjectSweepStart = Math.min(
    productionSql.indexOf('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC;'),
    productionSql.indexOf('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM socos_release_gate_read;'),
    productionSql.indexOf('REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;'),
  );
  assert.ok(defaultAclEnd >= 0);
  assert.ok(currentObjectSweepStart > defaultAclEnd);
  assert.doesNotMatch(`${sql}\n${productionSql}`, /ALTER ROLE socos_app|ALTER FUNCTION|REVOKE [^;]+ FROM socos_app/);

  assert.match(calls, /usermod .*<--shell> <\/bin\/sh>/);
  assert.match(calls, /usermod .*<--groups> <>/);
  assert.match(calls, /passwd .*<--lock> <socos-release-gate>/);
  assert.match(calls, /git .*<fetch> <--no-tags> <--prune> <origin> <\+refs\/heads\/main:refs\/remotes\/origin\/main>/);
  assert.match(calls, /docker .*<build> .*<socos-release-gate-runtime:node22-pnpm10\.10\.0-pg16-v2>/);
  assert.match(calls, /docker .*<run> .*pg_dump psql pg_restore createdb dropdb.*16\./s);
  assert.match(calls, /docker .*<psql> .*<--username=postgres>/);
  assert.match(
    calls,
    /SELECT NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname NOT IN \('postgres', 'socos_app', 'socos_release_gate_read', 'socos_release_gate_admin', 'socos_release_gate_restore'\)\);/,
  );
  const runtimeDockerfile = readFileSync(join(f.state, 'runtime.Dockerfile'), 'utf8');
  assert.match(
    runtimeDockerfile,
    /rm -f \/usr\/local\/bin\/yarn \/usr\/local\/bin\/yarnpkg[\s\\]+&& corepack enable pnpm/,
  );
  assert.doesNotMatch(runtimeDockerfile, /corepack enable(?:\s*\\)?\s*&&/);
  assert.match(calls, /^chown <root:root> .*socos-release-gate-dispatch> <.*socos-release-gate-launcher>$/m);
  assert.match(
    calls,
    /^chown <root:socos-release-gate> <.*\/\.ssh> <.*\/\.ssh\/authorized_keys>$/m,
  );
  assert.match(calls, /flock <-x>/);
  assert.doesNotMatch(calls, new RegExp(`${token}|synthetic-production-password`));
});

test('provisioner rejects a shared database container before broad PUBLIC ACL changes', () => {
  const f = fixture();
  const result = run(f.input, { ...f.env, SHIM_UNEXPECTED_LOGIN: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'provision_status=failed\n');
  assert.equal(existsSync(join(f.state, 'role-sql')), false);
  assert.equal(readFileSync(join(f.state, 'production-role-sql'), 'utf8'), '');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /rolname|unexpected|socos_app/);
});

test('provisioner bounds ACL quiescence and never sweeps when pre-cutoff app transactions remain', () => {
  const f = fixture();
  const result = run(f.input, { ...f.env, SHIM_ACL_QUIESCENCE_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'provision_status=failed\n');
  assert.equal(readFileSync(join(f.state, 'acl-poll-count'), 'utf8'), '60');
  assert.equal(existsSync(join(f.state, 'production-role-sql-2')), false);
  assert.equal(existsSync(join(f.state, 'role-sql-2')), false);
  const phaseA = readFileSync(join(f.state, 'production-role-sql-1'), 'utf8');
  assert.match(phaseA, /ALTER DEFAULT PRIVILEGES/);
  assert.doesNotMatch(phaseA, /ON ALL (?:TABLES|SEQUENCES|ROUTINES)/);
});

test('provisioner rejects malformed ACL cutoff and quiescence results without sweeping', () => {
  for (const extraEnv of [
    { SHIM_ACL_CUTOFF_OUTPUT: 'not-a-timestamp' },
    { SHIM_ACL_CUTOFF_OUTPUT: '1784289600\n000000' },
    { SHIM_ACL_QUIESCENCE_OUTPUT: 'unexpected-row' },
  ]) {
    const f = fixture();
    const result = run(f.input, { ...f.env, ...extraEnv });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'provision_status=failed\n');
    assert.equal(existsSync(join(f.state, 'production-role-sql-2')), false);
    assert.equal(existsSync(join(f.state, 'role-sql-2')), false);
  }
});

test('provisioner externally times out hung ACL queries before sweep or password rotation', () => {
  for (const query of ['cutoff', 'poll']) {
    const f = fixture();
    const startedAt = performance.now();
    const result = run(f.input, { ...f.env, SHIM_HANG_ACL_QUERY: query });
    assert.ok(performance.now() - startedAt < 5_000);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'provision_status=failed\n');
    assert.equal(existsSync(join(f.state, 'production-role-sql-2')), false);
    assert.equal(existsSync(join(f.state, 'role-sql-2')), false);
    assert.match(readFileSync(f.log, 'utf8'), /timeout <--signal=TERM> <--kill-after=5s> <10> <docker> <exec>/);
  }
});

test('phase B failure preserves installed credentials and skips password rotation', () => {
  const f = fixture();
  const etc = join(f.root, 'etc');
  mkdirSync(etc);
  const envPath = join(etc, 'socos-release-gate.env');
  writeFileSync(envPath, 'installed-credentials-remain\n', { mode: 0o600 });
  const result = run(f.input, { ...f.env, SHIM_FAIL_PHASE_B: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'provision_status=failed\n');
  assert.equal(existsSync(join(f.state, 'production-role-sql-2')), true);
  assert.equal(existsSync(join(f.state, 'role-sql-2')), false);
  assert.equal(readFileSync(envPath, 'utf8'), 'installed-credentials-remain\n');
});

test('uncertain password rotation response publishes after all exact credential proofs succeed', () => {
  const f = fixture();
  const etc = join(f.root, 'etc');
  mkdirSync(etc);
  const envPath = join(etc, 'socos-release-gate.env');
  writeFileSync(envPath, 'installed-credentials-are-old\n', { mode: 0o600 });
  const result = run(f.input, { ...f.env, SHIM_UNCERTAIN_ROTATION: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(envPath, 'utf8'),
    /^SOCOS_RELEASE_GATE_DATABASE_URL=postgresql:\/\/socos_release_gate_read:/m,
  );
  assert.match(
    readFileSync(join(f.state, 'acl-events'), 'utf8'),
    /env_stage\nrole_2\nprobe_read\nprobe_admin\nprobe_restore\nenv_publish\n$/,
  );
});

test('failed credential proof preserves installed env and removes every credential temp', () => {
  const f = fixture();
  const etc = join(f.root, 'etc');
  mkdirSync(etc);
  const envPath = join(etc, 'socos-release-gate.env');
  writeFileSync(envPath, 'installed-credentials-remain\n', { mode: 0o600 });
  const result = run(f.input, { ...f.env, SHIM_FAIL_CREDENTIAL_PROBE: 'socos_release_gate_admin' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'provision_status=failed\n');
  assert.equal(readFileSync(envPath, 'utf8'), 'installed-credentials-remain\n');
  assert.equal(readdirSync(etc).some((name) => name.startsWith('socos-release-gate.env.')), false);
  assert.equal(
    readdirSync(join(f.root, 'var/lib/socos-release-gate')).some((name) => name.startsWith('credential-probe.')),
    false,
  );
  assert.match(readFileSync(join(f.state, 'acl-events'), 'utf8'), /probe_read\nprobe_admin\nprobe_restore\n$/);
});

test('post-verification normal failure publishes the staged env from EXIT cleanup', () => {
  const f = fixture();
  const etc = join(f.root, 'etc');
  mkdirSync(etc);
  const envPath = join(etc, 'socos-release-gate.env');
  writeFileSync(envPath, 'installed-credentials-are-old\n', { mode: 0o600 });
  const result = run(f.input, { ...f.env, SHIM_FAIL_ENV_MV_ONCE: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'provision_status=failed\n');
  assert.match(
    readFileSync(envPath, 'utf8'),
    /^SOCOS_RELEASE_GATE_DATABASE_URL=postgresql:\/\/socos_release_gate_read:/m,
  );
  assert.equal(readdirSync(etc).some((name) => name.startsWith('socos-release-gate.env.')), false);
  assert.match(readFileSync(join(f.state, 'acl-events'), 'utf8'), /probe_restore\nenv_publish\n$/);
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
    /bounded\(\)/,
    /\/usr\/bin\/perl -e/,
    /alarm \$seconds/,
    /exec \{ \$ARGV\[0\] \} @ARGV/,
    /exit 124/,
    /printf '%s\\n' 'invalid-candidate' \|\s*bounded 10 ssh[\s\S]*socos-release-gate 2>&1/,
    /\[ "\$auth_output" = 'launcher_status=failed' \]/,
    /auth_status=timeout/,
    /Permission denied/,
    /\/var\/lib\/socos-release-gate\/\.ssh \\/,
    /mode `750` and `640`/,
    /printf '%s\\n' "\$audit_candidate" \| audit_rejected remote-command/,
    /git fetch --no-tags --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main >\/dev\/null 2>&1/,
    /git checkout --detach refs\/remotes\/origin\/main >\/dev\/null 2>&1/,
    /sudo -l -U socos-release-gate/,
    /socos_release_gate_admin/,
    /socos_release_gate_restore/,
    /socos_release_gate_read/,
    /pg_auth_members/,
    /dedicated PostgreSQL container/i,
    /unexpected `LOGIN` role/i,
    /read role cannot connect to `template1`/i,
    /template1.*`PUBLIC CONNECT`/is,
    /pre-cutoff `socos_app` transaction/i,
    /pg_prepared_xacts/,
    /60 attempts.*two\s+seconds/is,
    /ten-second external timeout/i,
    /password rotation.*after Phase B/is,
    /root-only `--env-file`/i,
    /current_user.*current_database/is,
    /SIGKILL.*mandatory immediate\s+rerun/is,
    /token and role rotation/i,
    /rmdir \/var\/lock\/socos-release-gate\/gate\.lock/,
    /084b7addb0ccc765aa343c5412ed8f5fe5f6da0b.*ancestor/s,
  ]) assert.match(runbook, expected);
  const auditBlock = runbook.slice(
    runbook.indexOf('### Audit the forced command and role boundary'),
    runbook.indexOf('Audit role flags, memberships, and database ACLs'),
  );
  const rejectionHelper = auditBlock.slice(
    auditBlock.indexOf('audit_rejected()'),
    auditBlock.indexOf('git fetch --no-tags'),
  );
  assert.doesNotMatch(auditBlock, /\btimeout 10\b/);
  assert.match(rejectionHelper, /if bounded 10 "\$@"; then audit_code=0; else audit_code=\$\?; fi/);
  assert.doesNotMatch(rejectionHelper, /\bstatus=/);
  assert.ok(runbook.indexOf("'launcher_status=failed'") < runbook.indexOf('audit_rejected()'));
  assert.doesNotMatch(runbook, /exact trusted `origin\/main` is currently\s*`[0-9a-f]{40}`/);
  assert.doesNotMatch(runbook, /&& exit 1 \|\| true/);
});

test('runbook bounded helper terminates the command process group on deadline', () => {
  const runbook = readFileSync(join(repositoryRoot, 'docs/runbooks/database-backup-restore.md'), 'utf8');
  const helperStart = runbook.indexOf('bounded() {');
  const helperEnd = runbook.indexOf('\n}\n\nif auth_output', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helper = runbook.slice(helperStart, helperEnd + 2);
  assert.match(helper, /use POSIX qw\(setpgid\)/);
  assert.match(helper, /setpgid\(0, 0\)/);
  assert.match(helper, /kill "TERM", -\$pid/);
  assert.match(helper, /kill "KILL", -\$pid/);

  const normalFailure = spawnSync(
    '/bin/bash',
    ['-c', `${helper}\nbounded 10 /usr/bin/false`],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(normalFailure.status, 1, normalFailure.stderr);
  const signalFailure = spawnSync(
    '/bin/bash',
    ['-c', `${helper}\nbounded 10 /bin/sh -c 'kill -TERM $$'`],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(signalFailure.status, 143, signalFailure.stderr);

  const dir = mkdtempSync(join(tmpdir(), 'socos-bounded-helper-'));
  const command = join(dir, 'forking-command');
  const leaderFile = join(dir, 'leader.pid');
  const descendantFile = join(dir, 'descendant.pid');
  executable(command, `
printf '%s' "$$" > "$1"
sleep 30 &
descendant=$!
printf '%s' "$descendant" > "$2"
wait "$descendant"
`);

  const result = spawnSync(
    '/bin/bash',
    ['-c', `${helper}\nbounded 1 "$1" "$2" "$3"`, 'bounded-test', command, leaderFile, descendantFile],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(result.status, 124, `${result.stdout}${result.stderr}`);
  const pids = [leaderFile, descendantFile].map((path) => Number.parseInt(readFileSync(path, 'utf8'), 10));
  assert.ok(pids.every(Number.isSafeInteger));
  try {
    const deadline = Date.now() + 2_000;
    while (pids.some(pidExists) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    assert.deepEqual(pids.map(pidExists), [false, false]);
  } finally {
    for (const pid of pids) {
      if (pidExists(pid)) process.kill(pid, 'SIGKILL');
    }
  }
});

test('provisioner is idempotent and its launcher rejects command/input abuse before exact-ref execution', () => {
  const f = fixture();
  assert.equal(run(f.input, f.env).status, 0);
  const firstEnvironment = readFileSync(join(f.root, 'etc/socos-release-gate.env'), 'utf8');
  assert.equal(run(f.input, f.env).status, 0);
  const secondEnvironment = readFileSync(join(f.root, 'etc/socos-release-gate.env'), 'utf8');
  const readUrl = (value) => value.match(/^SOCOS_RELEASE_GATE_DATABASE_URL=(.+)$/m)?.[1];
  assert.notEqual(readUrl(firstEnvironment), readUrl(secondEnvironment));
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
