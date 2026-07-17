#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly ACCOUNT='socos-release-gate'
readonly DATABASE_CONTAINER='zwkk0scogckskkwss8oo48k4'
readonly APPLICATION_UUID='swwcg80gkw4k0k4oco8w8wgw'
readonly BACKUP_UUID='b85nxfljaz0xpo9xqa57lfr4'
readonly COOLIFY_URL='https://qed.quest'
readonly REMOTE_URL='https://github.com/yevgeniusr/socos.git'
readonly NETWORK='coolify'
readonly RUNTIME_IMAGE='socos-release-gate-runtime:node22-pnpm10.10.0-pg16-v2'

ROOT_PREFIX=${SOCOS_PROVISION_TEST_ROOT:-}
TEST_BIN=${SOCOS_PROVISION_TEST_BIN:-}
effective_euid=${SOCOS_PROVISION_TEST_EUID:-$EUID}
finished=0
input_file=''
build_context=''

cleanup() {
  [[ -z "$input_file" ]] || rm -f -- "$input_file"
  [[ -z "$build_context" ]] || rm -rf -- "$build_context"
  if [[ "$finished" -ne 1 ]]; then
    printf '%s\n' 'provision_status=failed' >&2
  fi
}
trap cleanup EXIT

fail() {
  exit 1
}

quiet() {
  "$@" >/dev/null 2>&1
}

root_path() {
  printf '%s%s' "$ROOT_PREFIX" "$1"
}

[[ "$effective_euid" == '0' ]] || fail
[[ "$#" -eq 0 ]] || fail

tmp_root=$(root_path '/var/lib/socos-release-gate')
quiet install -d -m 0700 "$tmp_root"
input_file=$(mktemp "$tmp_root/provision-input.XXXXXX")
head -c 16385 > "$input_file" || true
input_size=$(wc -c < "$input_file" | tr -d '[:space:]')
[[ "$input_size" =~ ^[0-9]+$ && "$input_size" -le 16384 ]] || fail

quiet jq -e '
  type == "object"
  and keys == ["authorized_key", "coolify_token"]
  and (.authorized_key | type == "string")
  and (.coolify_token | type == "string")
' "$input_file" || fail
authorized_key=$(jq -r '.authorized_key' "$input_file" 2>/dev/null) || fail
coolify_token=$(jq -r '.coolify_token' "$input_file" 2>/dev/null) || fail
rm -f -- "$input_file"
input_file=''

[[ "$authorized_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,2}(\ [^[:cntrl:]]*)?$ ]] || fail
[[ -n "$coolify_token" && "$coolify_token" != *$'\n'* && "$coolify_token" != *$'\r'* ]] || fail
key_check=$(mktemp "$tmp_root/key-check.XXXXXX")
printf '%s\n' "$authorized_key" > "$key_check"
quiet ssh-keygen -l -f "$key_check" || fail
rm -f -- "$key_check"

home=$(root_path '/var/lib/socos-release-gate')
ssh_dir="$home/.ssh"
authorized_keys="$ssh_dir/authorized_keys"
etc_dir=$(root_path '/etc')
sudoers_dir=$(root_path '/etc/sudoers.d')
repository=$(root_path '/opt/socos-release-gate/repository')
work_root=$(root_path '/var/lib/socos-release-gate/work')
lock_root=$(root_path '/var/lock/socos-release-gate')
launcher_path=$(root_path '/usr/local/sbin/socos-release-gate-launcher')
env_path=$(root_path '/etc/socos-release-gate.env')

if quiet getent passwd "$ACCOUNT"; then
  :
else
  quiet useradd --system --home-dir /var/lib/socos-release-gate --shell /bin/sh "$ACCOUNT"
fi
quiet usermod --home /var/lib/socos-release-gate --shell /bin/sh --groups '' "$ACCOUNT"
quiet passwd --lock "$ACCOUNT"

quiet install -d -m 0755 "$home"
quiet install -d -m 0700 "$ssh_dir"
key_tmp=$(mktemp "$ssh_dir/authorized-keys.XXXXXX")
printf 'restrict,command="sudo -n /usr/local/sbin/socos-release-gate-launcher" %s\n' "$authorized_key" > "$key_tmp"
quiet chmod 0600 "$key_tmp"
quiet mv -f -- "$key_tmp" "$authorized_keys"

quiet install -d -m 0755 "$etc_dir" "$sudoers_dir" "$(dirname "$launcher_path")"
sudoers_tmp=$(mktemp "$sudoers_dir/socos-release-gate.XXXXXX")
cat > "$sudoers_tmp" <<'SUDOERS'
Defaults:socos-release-gate env_reset,!setenv,secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Defaults:socos-release-gate env_keep += "SSH_ORIGINAL_COMMAND"
socos-release-gate ALL=(root) NOPASSWD: /usr/local/sbin/socos-release-gate-launcher
SUDOERS
quiet chmod 0440 "$sudoers_tmp"
quiet visudo -cf "$sudoers_tmp" || fail
quiet mv -f -- "$sudoers_tmp" "$sudoers_dir/socos-release-gate"
quiet visudo -cf "$sudoers_dir/socos-release-gate" || fail

quiet install -d -m 0755 "$(dirname "$repository")"
quiet install -d -m 0700 "$repository" "$work_root" "$lock_root"
exec 8>"$lock_root/updater.lock"
quiet flock -x 8
if [[ ! -d "$repository/.git" ]]; then
  quiet git -C "$repository" init
  quiet git -C "$repository" remote add origin "$REMOTE_URL"
fi
configured_remote=$(git -C "$repository" remote get-url origin 2>/dev/null) || fail
[[ "$configured_remote" == "$REMOTE_URL" ]] || fail
tracked_state=$(git -C "$repository" status --porcelain --untracked-files=no 2>/dev/null) || fail
[[ -z "$tracked_state" ]] || fail
quiet git -C "$repository" fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main
trusted_sha=$(git -C "$repository" rev-parse refs/remotes/origin/main 2>/dev/null) || fail
[[ "$trusted_sha" =~ ^[0-9a-f]{40}$ ]] || fail
quiet git -C "$repository" checkout --detach refs/remotes/origin/main
checked_out_sha=$(git -C "$repository" rev-parse HEAD 2>/dev/null) || fail
[[ "$checked_out_sha" == "$trusted_sha" ]] || fail
tracked_state=$(git -C "$repository" status --porcelain --untracked-files=no 2>/dev/null) || fail
[[ -z "$tracked_state" ]] || fail

build_context=$(mktemp -d "$tmp_root/runtime-build.XXXXXX")
cat > "$build_context/Dockerfile" <<'DOCKERFILE'
FROM node:22-bookworm-slim AS node-runtime
FROM postgres:16-bookworm
COPY --from=node-runtime /usr/local/ /usr/local/
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bash ca-certificates git util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10.10.0 --activate
WORKDIR /gate/repository
ENTRYPOINT []
CMD ["node"]
DOCKERFILE
if ! quiet docker image inspect "$RUNTIME_IMAGE"; then
  quiet docker build --pull --tag "$RUNTIME_IMAGE" "$build_context"
fi
quiet docker image inspect "$RUNTIME_IMAGE"
quiet docker run --rm --network none --entrypoint /bin/bash "$RUNTIME_IMAGE" -ceu '
for tool in pg_dump psql pg_restore createdb dropdb; do
  version=$($tool --version)
  case "$version" in *" 16."*) ;; *) exit 1 ;; esac
done
test "$(pnpm --version)" = "10.10.0"
case "$(node --version)" in v22.*) ;; *) exit 1 ;; esac
'
rm -rf -- "$build_context"
build_context=''

api_matches=$(docker ps --filter status=running --format '{{.Names}}' 2>/dev/null \
  | awk -v prefix="api-$APPLICATION_UUID" 'index($0, prefix) == 1 { print }') || fail
api_count=$(printf '%s\n' "$api_matches" | awk 'NF { count += 1 } END { print count + 0 }')
[[ "$api_count" -eq 1 && "$api_matches" =~ ^[A-Za-z0-9_.-]+$ ]] || fail
api_container=$api_matches
production_url=$(docker exec "$api_container" /bin/sh -c 'printf %s "$DATABASE_URL"' 2>/dev/null) || fail
[[ -n "$production_url" && "$production_url" != *$'\n'* && "$production_url" != *$'\r'* ]] || fail
production_url=${production_url%\?schema=public}
[[ "$production_url" == postgresql://socos_app:*@*/socos || "$production_url" == postgres://socos_app:*@*/socos ]] || fail
database_endpoint=${production_url#*@}
database_endpoint=${database_endpoint%/socos}
[[ "$database_endpoint" =~ ^[A-Za-z0-9_.-]+(:[0-9]+)?$ ]] || fail

cluster_id=$(docker exec "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --username=postgres --command='SELECT system_identifier::text FROM pg_control_system();' 2>/dev/null | tr -d '[:space:]') || fail
[[ "$cluster_id" =~ ^[0-9]{10,24}$ ]] || fail
admin_password=$(openssl rand -hex 32 2>/dev/null) || fail
restore_password=$(openssl rand -hex 32 2>/dev/null) || fail
[[ "$admin_password" =~ ^[0-9a-f]{64}$ && "$restore_password" =~ ^[0-9a-f]{64}$ && "$admin_password" != "$restore_password" ]] || fail

if ! docker exec -i "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --username=postgres --dbname=postgres >/dev/null 2>&1 <<SQL
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socos_release_gate_admin') THEN
    CREATE ROLE socos_release_gate_admin LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socos_release_gate_restore') THEN
    CREATE ROLE socos_release_gate_restore LOGIN;
  END IF;
END
\$roles\$;

DO \$memberships\$
DECLARE inherited_role record;
BEGIN
  FOR inherited_role IN
    SELECT granted.rolname
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname IN ('socos_release_gate_admin', 'socos_release_gate_restore')
  LOOP
    EXECUTE format('REVOKE %I FROM socos_release_gate_admin', inherited_role.rolname);
    EXECUTE format('REVOKE %I FROM socos_release_gate_restore', inherited_role.rolname);
  END LOOP;
END
\$memberships\$;

ALTER ROLE socos_release_gate_admin WITH LOGIN PASSWORD '$admin_password' NOSUPERUSER NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE socos_release_gate_restore WITH LOGIN PASSWORD '$restore_password' NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT socos_release_gate_restore TO socos_release_gate_admin;

REVOKE CONNECT ON DATABASE socos FROM PUBLIC;
GRANT CONNECT ON DATABASE socos TO postgres, socos_app;
REVOKE CONNECT ON DATABASE socos FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM socos_release_gate_admin, socos_release_gate_restore;
GRANT CONNECT ON DATABASE postgres TO socos_release_gate_admin, socos_release_gate_restore;
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
SQL
then
  fail
fi

env_tmp=$(mktemp "$etc_dir/socos-release-gate.env.XXXXXX")
cat > "$env_tmp" <<ENV
SOCOS_RELEASE_GATE_REPOSITORY=/gate/repository
SOCOS_RELEASE_GATE_WORK_ROOT=/gate/work
SOCOS_RELEASE_GATE_LOCK_DIR=/gate/locks/gate.lock
SOCOS_RELEASE_GATE_DATABASE_URL=$production_url
SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL=postgresql://socos_release_gate_admin:$admin_password@$database_endpoint/postgres
SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL=postgresql://socos_release_gate_restore:$restore_password@$database_endpoint/postgres
SOCOS_RELEASE_GATE_CLUSTER_ID=$cluster_id
SOCOS_RELEASE_GATE_COOLIFY_BASE_URL=$COOLIFY_URL
SOCOS_RELEASE_GATE_COOLIFY_TOKEN=$coolify_token
SOCOS_RELEASE_GATE_DATABASE_UUID=$DATABASE_CONTAINER
SOCOS_RELEASE_GATE_BACKUP_UUID=$BACKUP_UUID
SOCOS_RELEASE_GATE_OPERATION_TIMEOUT_MS=1800000
SOCOS_RELEASE_GATE_CLEANUP_TIMEOUT_MS=120000
ENV
quiet chmod 0600 "$env_tmp"
quiet mv -f -- "$env_tmp" "$env_path"

launcher_tmp=$(mktemp "$(dirname "$launcher_path")/socos-release-gate-launcher.XXXXXX")
launcher_root=$ROOT_PREFIX
launcher_path_value='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
[[ -z "$TEST_BIN" ]] || launcher_path_value="$TEST_BIN:/usr/bin:/bin"
{
  cat <<'LAUNCHER_HEAD'
#!/usr/bin/env bash
set -euo pipefail
umask 077
LAUNCHER_HEAD
  printf 'ROOT_PREFIX=%q\n' "$launcher_root"
  printf 'PATH=%q\n' "$launcher_path_value"
  cat <<'LAUNCHER_BODY'
export PATH
readonly REMOTE_URL='https://github.com/yevgeniusr/socos.git'
readonly RUNTIME_IMAGE='socos-release-gate-runtime:node22-pnpm10.10.0-pg16-v2'
readonly NETWORK='coolify'
readonly REPOSITORY="$ROOT_PREFIX/opt/socos-release-gate/repository"
readonly WORK_ROOT="$ROOT_PREFIX/var/lib/socos-release-gate/work"
readonly LOCK_ROOT="$ROOT_PREFIX/var/lock/socos-release-gate"
readonly ENV_FILE="$ROOT_PREFIX/etc/socos-release-gate.env"
complete=0
runner_root=''
runner_worktree=''
cleanup() {
  original_status=$?
  trap - EXIT
  cleanup_failed=0
  if [[ -n "$runner_worktree" ]]; then
    timeout 120 git -C "$REPOSITORY" worktree remove --force "$runner_worktree" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if [[ -n "$runner_root" ]]; then
    timeout 120 rm -rf -- "$runner_root" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if [[ "$complete" -ne 1 || "$cleanup_failed" -ne 0 ]]; then
    printf "%s\n" "launcher_status=failed" >&2
  fi
  if [[ "$cleanup_failed" -ne 0 ]]; then
    exit 1
  fi
  exit "$original_status"
}
trap cleanup EXIT

[[ "$#" -eq 0 ]] || exit 1
[[ -z "${SSH_ORIGINAL_COMMAND:-}" ]] || exit 1
candidate=''
IFS= read -r candidate || exit 1
[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || exit 1
extra=''
if IFS= read -r extra || [[ -n "$extra" ]]; then
  exit 1
fi

exec 9>"$LOCK_ROOT/updater.lock"
flock -n 9 || exit 1
configured_remote=$(git -C "$REPOSITORY" remote get-url origin 2>/dev/null) || exit 1
[[ "$configured_remote" == "$REMOTE_URL" ]] || exit 1
tracked_state=$(git -C "$REPOSITORY" status --porcelain --untracked-files=no 2>/dev/null) || exit 1
[[ -z "$tracked_state" ]] || exit 1
git -C "$REPOSITORY" fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main >/dev/null 2>&1
trusted_sha=$(git -C "$REPOSITORY" rev-parse refs/remotes/origin/main 2>/dev/null) || exit 1
[[ "$trusted_sha" == "$candidate" ]] || exit 1
git -C "$REPOSITORY" checkout --detach refs/remotes/origin/main >/dev/null 2>&1
checked_out_sha=$(git -C "$REPOSITORY" rev-parse HEAD 2>/dev/null) || exit 1
[[ "$checked_out_sha" == "$candidate" ]] || exit 1
tracked_state=$(git -C "$REPOSITORY" status --porcelain --untracked-files=no 2>/dev/null) || exit 1
[[ -z "$tracked_state" ]] || exit 1

runner_root=$(mktemp -d "$WORK_ROOT/runner.XXXXXX")
runner_worktree="$runner_root/candidate"
git -C "$REPOSITORY" worktree add --detach "$runner_worktree" "$candidate" >/dev/null 2>&1
runner_sha=$(git -C "$runner_worktree" rev-parse HEAD 2>/dev/null) || exit 1
[[ "$runner_sha" == "$candidate" ]] || exit 1
runner_state=$(git -C "$runner_worktree" status --porcelain --untracked-files=no 2>/dev/null) || exit 1
[[ -z "$runner_state" ]] || exit 1

docker run --rm --network "$NETWORK" --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=bind,src=$runner_worktree,dst=/gate/runner" \
  --workdir /gate/runner \
  "$RUNTIME_IMAGE" pnpm install --frozen-lockfile >/dev/null 2>&1

runner_sha=$(git -C "$runner_worktree" rev-parse HEAD 2>/dev/null) || exit 1
[[ "$runner_sha" == "$candidate" ]] || exit 1
runner_state=$(git -C "$runner_worktree" status --porcelain --untracked-files=no 2>/dev/null) || exit 1
[[ -z "$runner_state" ]] || exit 1

docker run -i --rm --network "$NETWORK" --cap-drop ALL --security-opt no-new-privileges:true \
  --env-file "$ENV_FILE" \
  --mount "type=bind,src=$REPOSITORY,dst=/gate/repository" \
  --mount "type=bind,src=$runner_worktree,dst=/gate/runner" \
  --mount "type=bind,src=$WORK_ROOT,dst=/gate/work" \
  --mount "type=bind,src=$LOCK_ROOT,dst=/gate/locks" \
  --workdir /gate/runner \
  "$RUNTIME_IMAGE" node scripts/cloud-restore-release-gate.mjs <<<"$candidate"
complete=1
LAUNCHER_BODY
} > "$launcher_tmp"
quiet chmod 0755 "$launcher_tmp"
quiet mv -f -- "$launcher_tmp" "$launcher_path"

quiet chown -R root:root "$(root_path '/opt/socos-release-gate')" "$home" "$work_root" "$lock_root"
quiet chown root:root "$authorized_keys" "$sudoers_dir/socos-release-gate" "$env_path" "$launcher_path"

finished=1
printf '%s\n' 'provision_status=ready'
printf 'trusted_sha=%s\n' "$trusted_sha"
