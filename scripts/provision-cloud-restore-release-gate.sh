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
readonly ACL_QUIESCENCE_ATTEMPTS=60
readonly ACL_QUIESCENCE_SLEEP_SECONDS=2
readonly ACL_QUERY_TIMEOUT_SECONDS=10
readonly PASSWORD_ROTATION_TIMEOUT_SECONDS=15
readonly CREDENTIAL_PROBE_TIMEOUT_SECONDS=15
readonly CREDENTIAL_PROBE_LABEL_KEY='com.socos.owner'
readonly CREDENTIAL_PROBE_LABEL_VALUE='socos-release-gate-credential-probe'
readonly CREDENTIAL_PROBE_LABEL="$CREDENTIAL_PROBE_LABEL_KEY=$CREDENTIAL_PROBE_LABEL_VALUE"

ROOT_PREFIX=${SOCOS_PROVISION_TEST_ROOT:-}
TEST_BIN=${SOCOS_PROVISION_TEST_BIN:-}
effective_euid=${SOCOS_PROVISION_TEST_EUID:-$EUID}
finished=0
input_file=''
build_context=''
env_path=''
env_tmp=''
credential_probe_tmp=''
credential_probe_cidfile=''
credentials_verified=0

cleanup_probe_container() {
  local probe_cid=''
  local probe_extra=''
  local probe_owner=''
  local probe_cleanup_status=0
  if [[ -n "$credential_probe_cidfile" && ( -e "$credential_probe_cidfile" || -L "$credential_probe_cidfile" ) ]]; then
    if [[ -f "$credential_probe_cidfile" && ! -L "$credential_probe_cidfile" ]]; then
      chmod 0600 "$credential_probe_cidfile" >/dev/null 2>&1 || probe_cleanup_status=1
      IFS= read -r probe_cid < "$credential_probe_cidfile" || probe_cleanup_status=1
      if IFS= read -r probe_extra < <(tail -n +2 "$credential_probe_cidfile"); then
        probe_cleanup_status=1
      fi
      if [[ "$probe_cid" =~ ^[0-9a-f]{64}$ ]]; then
        probe_owner=$(docker inspect --format "{{ index .Config.Labels \"$CREDENTIAL_PROBE_LABEL_KEY\" }}" "$probe_cid" 2>/dev/null) \
          || probe_cleanup_status=1
        if [[ "$probe_owner" == "$CREDENTIAL_PROBE_LABEL_VALUE" ]]; then
          docker rm -f -- "$probe_cid" >/dev/null 2>&1 || probe_cleanup_status=1
        else
          probe_cleanup_status=1
        fi
      else
        probe_cleanup_status=1
      fi
    else
      probe_cleanup_status=1
    fi
    rm -f -- "$credential_probe_cidfile" >/dev/null 2>&1 || probe_cleanup_status=1
  fi
  credential_probe_cidfile=''
  return "$probe_cleanup_status"
}

cleanup() {
  original_status=$?
  trap - EXIT HUP INT TERM
  [[ -z "$input_file" ]] || rm -f -- "$input_file"
  [[ -z "$build_context" ]] || rm -rf -- "$build_context"
  cleanup_probe_container || true
  [[ -z "$credential_probe_tmp" ]] || rm -f -- "$credential_probe_tmp"
  credential_probe_tmp=''
  if [[ -n "$env_tmp" ]]; then
    if [[ "$credentials_verified" -eq 1 ]] && mv -f -- "$env_tmp" "$env_path" >/dev/null 2>&1; then
      env_tmp=''
    fi
    [[ -z "$env_tmp" ]] || rm -f -- "$env_tmp"
  fi
  if [[ "$finished" -ne 1 ]]; then
    printf '%s\n' 'provision_status=failed' >&2
  fi
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
[[ "$ACL_QUERY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail
[[ "$PASSWORD_ROTATION_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail
[[ "$CREDENTIAL_PROBE_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail

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
dispatcher_path=$(root_path '/usr/local/sbin/socos-release-gate-dispatch')
launcher_path=$(root_path '/usr/local/sbin/socos-release-gate-launcher')
env_path=$(root_path '/etc/socos-release-gate.env')

if quiet getent passwd "$ACCOUNT"; then
  :
else
  quiet useradd --system --home-dir /var/lib/socos-release-gate --shell /bin/sh "$ACCOUNT"
fi
quiet usermod --home /var/lib/socos-release-gate --shell /bin/sh --groups '' "$ACCOUNT"
quiet passwd --lock "$ACCOUNT"
account_group=$(id -gn "$ACCOUNT" 2>/dev/null) || fail
[[ "$account_group" =~ ^[a-z_][a-z0-9_-]*\$?$ ]] || fail

quiet install -d -m 0755 "$home"
quiet install -d -m 0750 "$ssh_dir"
key_tmp=$(mktemp "$ssh_dir/authorized-keys.XXXXXX")
printf 'restrict,command="/usr/local/sbin/socos-release-gate-dispatch" %s\n' "$authorized_key" > "$key_tmp"
quiet chmod 0640 "$key_tmp"
quiet mv -f -- "$key_tmp" "$authorized_keys"

quiet install -d -m 0755 "$etc_dir" "$sudoers_dir" "$(dirname "$launcher_path")"
sudoers_tmp=$(mktemp "$sudoers_dir/socos-release-gate.XXXXXX")
cat > "$sudoers_tmp" <<'SUDOERS'
Defaults:socos-release-gate env_reset,!setenv,secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
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

stale_probe_cids=()
stale_probe_cidfiles=()
stale_probe_cid_count=0
stale_probe_cidfile_count=0
append_stale_probe_cid() {
  local candidate_cid=$1
  local existing_cid=''
  local stale_probe_index=0
  [[ "$candidate_cid" =~ ^[0-9a-f]{64}$ ]] || fail
  for ((stale_probe_index = 0; stale_probe_index < stale_probe_cid_count; stale_probe_index += 1)); do
    existing_cid=${stale_probe_cids[$stale_probe_index]}
    [[ "$existing_cid" != "$candidate_cid" ]] || return 0
  done
  stale_probe_cids[$stale_probe_cid_count]=$candidate_cid
  stale_probe_cid_count=$((stale_probe_cid_count + 1))
}

labeled_probe_cids=$(docker ps --all --quiet --no-trunc --filter "label=$CREDENTIAL_PROBE_LABEL" 2>/dev/null) || fail
if [[ -n "$labeled_probe_cids" ]]; then
  while IFS= read -r stale_probe_cid; do
    append_stale_probe_cid "$stale_probe_cid"
  done <<< "$labeled_probe_cids"
fi

for stale_probe_cidfile in "$tmp_root"/credential-probe-cid.??????; do
  [[ -e "$stale_probe_cidfile" || -L "$stale_probe_cidfile" ]] || continue
  stale_probe_basename=${stale_probe_cidfile##*/}
  [[ "$stale_probe_basename" =~ ^credential-probe-cid\.[A-Za-z0-9]{6}$ ]] || fail
  [[ -f "$stale_probe_cidfile" && ! -L "$stale_probe_cidfile" ]] || fail
  quiet chmod 0600 "$stale_probe_cidfile"
  if [[ ! -s "$stale_probe_cidfile" ]]; then
    stale_probe_cidfiles[$stale_probe_cidfile_count]=$stale_probe_cidfile
    stale_probe_cidfile_count=$((stale_probe_cidfile_count + 1))
    continue
  fi
  stale_probe_cid=''
  stale_probe_extra=''
  IFS= read -r stale_probe_cid < "$stale_probe_cidfile" || fail
  if IFS= read -r stale_probe_extra < <(tail -n +2 "$stale_probe_cidfile"); then
    fail
  fi
  [[ "$stale_probe_cid" =~ ^[0-9a-f]{64}$ ]] || fail
  stale_probe_owner=''
  if stale_probe_owner=$(docker inspect --format "{{ index .Config.Labels \"$CREDENTIAL_PROBE_LABEL_KEY\" }}" "$stale_probe_cid" 2>/dev/null); then
    [[ "$stale_probe_owner" == "$CREDENTIAL_PROBE_LABEL_VALUE" ]] || fail
    append_stale_probe_cid "$stale_probe_cid"
  fi
  stale_probe_cidfiles[$stale_probe_cidfile_count]=$stale_probe_cidfile
  stale_probe_cidfile_count=$((stale_probe_cidfile_count + 1))
done

for ((stale_probe_index = 0; stale_probe_index < stale_probe_cid_count; stale_probe_index += 1)); do
  stale_probe_cid=${stale_probe_cids[$stale_probe_index]}
  quiet docker rm -f -- "$stale_probe_cid" || fail
done
remaining_probe_cids=$(docker ps --all --quiet --no-trunc --filter "label=$CREDENTIAL_PROBE_LABEL" 2>/dev/null) || fail
[[ -z "$remaining_probe_cids" ]] || fail
for ((stale_probe_index = 0; stale_probe_index < stale_probe_cidfile_count; stale_probe_index += 1)); do
  stale_probe_cidfile=${stale_probe_cidfiles[$stale_probe_index]}
  rm -f -- "$stale_probe_cidfile"
done

for stale_input_tmp in "$tmp_root"/provision-input.??????; do
  [[ -e "$stale_input_tmp" || -L "$stale_input_tmp" ]] || continue
  stale_input_basename=${stale_input_tmp##*/}
  [[ "$stale_input_basename" =~ ^provision-input\.[A-Za-z0-9]{6}$ ]] || fail
  [[ -f "$stale_input_tmp" && ! -L "$stale_input_tmp" ]] || continue
  rm -f -- "$stale_input_tmp"
done
for stale_env_tmp in "$etc_dir"/socos-release-gate.env.??????; do
  [[ -e "$stale_env_tmp" || -L "$stale_env_tmp" ]] || continue
  stale_env_basename=${stale_env_tmp##*/}
  [[ "$stale_env_basename" =~ ^socos-release-gate\.env\.[A-Za-z0-9]{6}$ ]] || fail
  [[ -f "$stale_env_tmp" && ! -L "$stale_env_tmp" ]] || fail
  rm -f -- "$stale_env_tmp"
done
for stale_probe_tmp in "$tmp_root"/credential-probe.??????; do
  [[ -e "$stale_probe_tmp" || -L "$stale_probe_tmp" ]] || continue
  stale_probe_basename=${stale_probe_tmp##*/}
  [[ "$stale_probe_basename" =~ ^credential-probe\.[A-Za-z0-9]{6}$ ]] || fail
  [[ -f "$stale_probe_tmp" && ! -L "$stale_probe_tmp" ]] || fail
  rm -f -- "$stale_probe_tmp"
done
unset stale_probe_cids stale_probe_cidfiles labeled_probe_cids remaining_probe_cids
unset stale_probe_cid_count stale_probe_cidfile_count stale_probe_index
unset stale_probe_cid stale_probe_cidfile stale_probe_owner stale_probe_extra
unset stale_probe_tmp stale_env_tmp stale_input_tmp
unset stale_probe_basename stale_env_basename stale_input_basename

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
 && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && corepack enable pnpm \
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
application_url=$(docker exec "$api_container" /bin/sh -c 'printf %s "$DATABASE_URL"' 2>/dev/null) || fail
[[ -n "$application_url" && "$application_url" != *$'\n'* && "$application_url" != *$'\r'* ]] || fail
application_url=${application_url%\?schema=public}
[[ "$application_url" == postgresql://socos_app:*@*/socos || "$application_url" == postgres://socos_app:*@*/socos ]] || fail
database_endpoint=${application_url#*@}
database_endpoint=${database_endpoint%/socos}
[[ "$database_endpoint" =~ ^[A-Za-z0-9_.-]+(:[0-9]+)?$ ]] || fail
unset application_url

cluster_id=$(docker exec "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --username=postgres --command='SELECT system_identifier::text FROM pg_control_system();' 2>/dev/null | tr -d '[:space:]') || fail
[[ "$cluster_id" =~ ^[0-9]{10,24}$ ]] || fail
login_roles_allowed=$(docker exec "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --username=postgres --dbname=postgres \
  --command="SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname NOT IN ('postgres', 'socos_app', 'socos_release_gate_read', 'socos_release_gate_admin', 'socos_release_gate_restore'));" \
  2>/dev/null | tr -d '[:space:]') || fail
[[ "$login_roles_allowed" == 't' ]] || fail
unset login_roles_allowed
if ! docker exec -i "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --username=postgres --dbname=postgres >/dev/null 2>&1 <<SQL
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socos_release_gate_read') THEN
    CREATE ROLE socos_release_gate_read LOGIN;
  END IF;
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
    WHERE member_role.rolname IN ('socos_release_gate_read', 'socos_release_gate_admin', 'socos_release_gate_restore')
  LOOP
    EXECUTE format('REVOKE %I FROM socos_release_gate_read', inherited_role.rolname);
    EXECUTE format('REVOKE %I FROM socos_release_gate_admin', inherited_role.rolname);
    EXECUTE format('REVOKE %I FROM socos_release_gate_restore', inherited_role.rolname);
  END LOOP;
END
\$memberships\$;

ALTER ROLE socos_release_gate_read WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE socos_release_gate_admin WITH LOGIN NOSUPERUSER NOINHERIT CREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE socos_release_gate_restore WITH LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT socos_release_gate_restore TO socos_release_gate_admin;

REVOKE CONNECT ON DATABASE socos FROM PUBLIC;
GRANT CONNECT ON DATABASE socos TO postgres, socos_app;
REVOKE CONNECT ON DATABASE socos FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM socos_release_gate_read;
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO socos_release_gate_admin, socos_release_gate_restore;
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE template1 FROM socos_release_gate_read, socos_release_gate_admin, socos_release_gate_restore;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM socos_release_gate_admin, socos_release_gate_restore;
SQL
then
  fail
fi

if ! docker exec -i "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --username=postgres --dbname=socos >/dev/null 2>&1 <<SQL
BEGIN;
REVOKE CREATE ON DATABASE socos FROM PUBLIC;
DO \$app_privileges\$
DECLARE
  app_had_temporary boolean := has_database_privilege('socos_app', 'socos', 'TEMPORARY');
BEGIN
  EXECUTE 'REVOKE TEMPORARY ON DATABASE socos FROM PUBLIC';
  IF app_had_temporary THEN
    EXECUTE 'GRANT TEMPORARY ON DATABASE socos TO socos_app';
  END IF;
END
\$app_privileges\$;
REVOKE ALL PRIVILEGES ON DATABASE socos FROM socos_release_gate_read;
GRANT CONNECT ON DATABASE socos TO socos_release_gate_read;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM socos_release_gate_read;
GRANT USAGE ON SCHEMA public TO socos_release_gate_read;
ALTER DEFAULT PRIVILEGES FOR ROLE socos_app REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON TABLES TO socos_release_gate_read;
ALTER DEFAULT PRIVILEGES FOR ROLE socos_app IN SCHEMA public GRANT SELECT ON SEQUENCES TO socos_release_gate_read;
COMMIT;
SQL
then
  fail
fi

acl_cutoff=$(timeout --signal=TERM --kill-after=5s "$ACL_QUERY_TIMEOUT_SECONDS" \
  docker exec "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
  --username=postgres --dbname=socos \
  --command='SELECT floor(extract(epoch FROM clock_timestamp()) * 1000000)::bigint;' \
  2>/dev/null) || fail
[[ "$acl_cutoff" =~ ^[0-9]{10,20}$ ]] || fail

acl_quiescent=0
for ((acl_attempt = 1; acl_attempt <= ACL_QUIESCENCE_ATTEMPTS; acl_attempt += 1)); do
  acl_quiescence=$(timeout --signal=TERM --kill-after=5s "$ACL_QUERY_TIMEOUT_SECONDS" \
    docker exec "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align \
    --username=postgres --dbname=socos \
    --command="SELECT NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'socos_app' AND xact_start IS NOT NULL AND xact_start <= to_timestamp($acl_cutoff / 1000000.0)) AND NOT EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE owner = 'socos_app');" \
    2>/dev/null) || fail
  case "$acl_quiescence" in
    t)
      acl_quiescent=1
      break
      ;;
    f)
      ;;
    *)
      fail
      ;;
  esac
  [[ "$acl_attempt" -eq "$ACL_QUIESCENCE_ATTEMPTS" ]] || quiet sleep "$ACL_QUIESCENCE_SLEEP_SECONDS"
done
[[ "$acl_quiescent" -eq 1 ]] || fail
unset acl_cutoff acl_quiescence

if ! docker exec -i "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 --username=postgres --dbname=socos >/dev/null 2>&1 <<SQL
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM socos_release_gate_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO socos_release_gate_read;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM socos_release_gate_read;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO socos_release_gate_read;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM socos_release_gate_read;
COMMIT;
SQL
then
  fail
fi

read_password=$(openssl rand -hex 32 2>/dev/null) || fail
admin_password=$(openssl rand -hex 32 2>/dev/null) || fail
restore_password=$(openssl rand -hex 32 2>/dev/null) || fail
[[ "$read_password" =~ ^[0-9a-f]{64}$ && "$admin_password" =~ ^[0-9a-f]{64}$ && "$restore_password" =~ ^[0-9a-f]{64}$ ]] || fail
[[ "$read_password" != "$admin_password" && "$read_password" != "$restore_password" && "$admin_password" != "$restore_password" ]] || fail

env_tmp=$(mktemp "$etc_dir/socos-release-gate.env.XXXXXX")
cat > "$env_tmp" <<ENV
SOCOS_RELEASE_GATE_REPOSITORY=/gate/repository
SOCOS_RELEASE_GATE_WORK_ROOT=/gate/work
SOCOS_RELEASE_GATE_LOCK_DIR=/gate/locks/gate.lock
SOCOS_RELEASE_GATE_DATABASE_URL=postgresql://socos_release_gate_read:$read_password@$database_endpoint/socos
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
staged_environment=()
while IFS= read -r environment_line; do
  staged_environment[${#staged_environment[@]}]=$environment_line
done < "$env_tmp"
expected_environment=(
  'SOCOS_RELEASE_GATE_REPOSITORY=/gate/repository'
  'SOCOS_RELEASE_GATE_WORK_ROOT=/gate/work'
  'SOCOS_RELEASE_GATE_LOCK_DIR=/gate/locks/gate.lock'
  "SOCOS_RELEASE_GATE_DATABASE_URL=postgresql://socos_release_gate_read:$read_password@$database_endpoint/socos"
  "SOCOS_RELEASE_GATE_ADMIN_DATABASE_URL=postgresql://socos_release_gate_admin:$admin_password@$database_endpoint/postgres"
  "SOCOS_RELEASE_GATE_RESTORE_DATABASE_URL=postgresql://socos_release_gate_restore:$restore_password@$database_endpoint/postgres"
  "SOCOS_RELEASE_GATE_CLUSTER_ID=$cluster_id"
  "SOCOS_RELEASE_GATE_COOLIFY_BASE_URL=$COOLIFY_URL"
  "SOCOS_RELEASE_GATE_COOLIFY_TOKEN=$coolify_token"
  "SOCOS_RELEASE_GATE_DATABASE_UUID=$DATABASE_CONTAINER"
  "SOCOS_RELEASE_GATE_BACKUP_UUID=$BACKUP_UUID"
  'SOCOS_RELEASE_GATE_OPERATION_TIMEOUT_MS=1800000'
  'SOCOS_RELEASE_GATE_CLEANUP_TIMEOUT_MS=120000'
)
[[ -f "$env_tmp" && ! -L "$env_tmp" && "${#staged_environment[@]}" -eq "${#expected_environment[@]}" ]] || fail
for ((environment_index = 0; environment_index < ${#expected_environment[@]}; environment_index += 1)); do
  [[ "${staged_environment[$environment_index]}" == "${expected_environment[$environment_index]}" ]] || fail
done
unset staged_environment expected_environment environment_line

# COMMIT may succeed even when its client response is lost; the TCP proofs below
# are the authority for whether the staged credentials can be published.
rotation_status=0
timeout --signal=TERM --kill-after=5s "$PASSWORD_ROTATION_TIMEOUT_SECONDS" \
  docker exec -i "$DATABASE_CONTAINER" psql -X --set=ON_ERROR_STOP=1 \
  --username=postgres --dbname=postgres >/dev/null 2>&1 <<SQL || rotation_status=$?
BEGIN;
ALTER ROLE socos_release_gate_read WITH PASSWORD '$read_password';
ALTER ROLE socos_release_gate_admin WITH PASSWORD '$admin_password';
ALTER ROLE socos_release_gate_restore WITH PASSWORD '$restore_password';
COMMIT;
SQL

database_host=$database_endpoint
database_port=5432
if [[ "$database_endpoint" == *:* ]]; then
  database_host=${database_endpoint%:*}
  database_port=${database_endpoint##*:}
fi
[[ "$database_host" =~ ^[A-Za-z0-9_.-]+$ && "$database_port" =~ ^[0-9]+$ ]] || fail
credential_probe_tmp=$(mktemp "$tmp_root/credential-probe.XXXXXX")
quiet chmod 0600 "$credential_probe_tmp"

probe_credential() {
  local probe_user=$1
  local probe_password=$2
  local probe_database=$3
  local probe_expectation=$4
  local probe_proof=''
  local probe_status=0
  local probe_cleanup_status=0
  credential_probe_cidfile=$(mktemp "$tmp_root/credential-probe-cid.XXXXXX") || return 1
  if ! rm -f -- "$credential_probe_cidfile"; then
    cleanup_probe_container || true
    return 1
  fi
  cat > "$credential_probe_tmp" <<PROBE_ENV
PGHOST=$database_host
PGPORT=$database_port
PGUSER=$probe_user
PGPASSWORD=$probe_password
PGDATABASE=$probe_database
PGCONNECT_TIMEOUT=10
PROBE_ENV
  quiet chmod 0600 "$credential_probe_tmp"
  probe_proof=$(timeout --signal=TERM --kill-after=5s "$CREDENTIAL_PROBE_TIMEOUT_SECONDS" \
    docker run --network "$NETWORK" --cap-drop ALL --security-opt no-new-privileges:true \
    --label "$CREDENTIAL_PROBE_LABEL" --cidfile "$credential_probe_cidfile" \
    --env-file "$credential_probe_tmp" "$RUNTIME_IMAGE" \
    psql -X --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
    --command='SELECT current_user, current_database();' 2>/dev/null) || probe_status=$?
  cleanup_probe_container || probe_cleanup_status=$?
  [[ "$probe_cleanup_status" -eq 0 ]] || return 1
  case "$probe_expectation" in
    reject)
      [[ "$probe_status" -eq 2 && -z "$probe_proof" ]]
      ;;
    exact)
      [[ "$probe_status" -eq 0 && "$probe_proof" == "$probe_user|$probe_database" ]]
      ;;
    *)
      return 1
      ;;
  esac
}

probe_credential_pair() {
  local probe_user=$1
  local correct_password=$2
  local probe_database=$3
  local wrong_password=''
  local pair_invalid=0
  if [[ "${correct_password:0:1}" == '0' ]]; then
    wrong_password="1${correct_password:1}"
  else
    wrong_password="0${correct_password:1}"
  fi
  [[ "$wrong_password" =~ ^[0-9a-f]{64}$ && "$wrong_password" != "$correct_password" ]] || return 1
  probe_credential "$probe_user" "$wrong_password" "$probe_database" reject || pair_invalid=1
  probe_credential "$probe_user" "$correct_password" "$probe_database" exact || pair_invalid=1
  unset wrong_password
  return "$pair_invalid"
}

credential_probes_valid=1
probe_credential_pair 'socos_release_gate_read' "$read_password" 'socos' || credential_probes_valid=0
probe_credential_pair 'socos_release_gate_admin' "$admin_password" 'postgres' || credential_probes_valid=0
probe_credential_pair 'socos_release_gate_restore' "$restore_password" 'postgres' || credential_probes_valid=0
rm -f -- "$credential_probe_tmp"
credential_probe_tmp=''
unset rotation_status database_host database_port
[[ "$credential_probes_valid" -eq 1 ]] || fail
credentials_verified=1
if quiet mv -f -- "$env_tmp" "$env_path"; then
  env_tmp=''
else
  fail
fi

dispatcher_tmp=$(mktemp "$(dirname "$dispatcher_path")/socos-release-gate-dispatch.XXXXXX")
dispatcher_path_value='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
dispatcher_launcher='/usr/local/sbin/socos-release-gate-launcher'
if [[ -n "$TEST_BIN" ]]; then
  dispatcher_path_value="$TEST_BIN:/usr/bin:/bin"
  dispatcher_launcher="$launcher_path"
fi
{
  cat <<'DISPATCH_HEAD'
#!/bin/bash
set -euo pipefail
umask 077
DISPATCH_HEAD
  printf 'PATH=%q\n' "$dispatcher_path_value"
  printf 'readonly LAUNCHER=%q\n' "$dispatcher_launcher"
  cat <<'DISPATCH_BODY'
export PATH
[[ "$#" -eq 0 ]] || exit 1
[[ -z "${SSH_ORIGINAL_COMMAND:-}" ]] || exit 1
exec sudo -n "$LAUNCHER"
DISPATCH_BODY
} > "$dispatcher_tmp"
quiet chmod 0755 "$dispatcher_tmp"
quiet mv -f -- "$dispatcher_tmp" "$dispatcher_path"

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
quiet chown root:"$account_group" "$ssh_dir" "$authorized_keys"
quiet chmod 0750 "$ssh_dir"
quiet chmod 0640 "$authorized_keys"
quiet chown root:root "$sudoers_dir/socos-release-gate" "$env_path" "$dispatcher_path" "$launcher_path"

finished=1
printf '%s\n' 'provision_status=ready'
printf 'trusted_sha=%s\n' "$trusted_sha"
