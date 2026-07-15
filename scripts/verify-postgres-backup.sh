#!/bin/sh
set -eu

umask 077

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL is required}"
backup_file=${1:-${BACKUP_FILE:-}}
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "A readable backup file argument (or BACKUP_FILE) is required." >&2
  exit 64
fi

checksum_file="$backup_file.sha256"
metadata_file="$backup_file.metadata.tsv"
if [ ! -f "$checksum_file" ] || [ ! -f "$metadata_file" ]; then
  echo "Backup checksum and aggregate metadata sidecars are required." >&2
  exit 65
fi

backup_dir=$(CDPATH= cd -- "$(dirname -- "$backup_file")" && pwd)
backup_name=$(basename -- "$backup_file")
(
  cd "$backup_dir"
  shasum -a 256 --check "$(basename -- "$checksum_file")" >/dev/null
)

restore_db="socos_restore_$(date -u +%Y%m%d%H%M%S)_$$"
actual_metadata=$(mktemp "${TMPDIR:-/tmp}/socos-restore-counts.XXXXXX")

restore_url=$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = `/${process.argv[2]}`;
  url.search = "";
  console.log(url.toString());
' "$ADMIN_DATABASE_URL" "$restore_db")

created=0
cleanup() {
  rm -f "$actual_metadata"
  if [ "$created" -eq 1 ] && [ "${KEEP_RESTORE_DB:-0}" != "1" ]; then
    dropdb --if-exists --force --maintenance-db="$ADMIN_DATABASE_URL" "$restore_db" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM

createdb --maintenance-db="$ADMIN_DATABASE_URL" "$restore_db" >/dev/null
created=1
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$restore_url" "$backup_dir/$backup_name" >/dev/null

psql -X "$restore_url" \
  --set=ON_ERROR_STOP=1 \
  --no-align \
  --field-separator="$(printf '\t')" \
  --pset=footer=off \
  --command="
    SELECT c.relname AS table_name,
           ((xpath('/row/count/text()', query_to_xml(
             format('SELECT count(*) AS count FROM %I.%I', n.nspname, c.relname),
             false, true, ''
           )))[1]::text)::bigint AS row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname;
  " > "$actual_metadata"

if ! cmp -s "$metadata_file" "$actual_metadata"; then
  echo "Restored aggregate counts do not match backup metadata." >&2
  exit 66
fi

for expected_table in User Vault Contact Interaction Reminder; do
  if ! awk -F '\t' -v expected="$expected_table" 'NR > 1 && $1 == expected { found=1 } END { exit !found }' "$actual_metadata"; then
    echo "Restored database is missing an expected table." >&2
    exit 67
  fi
done

table_count=$(awk 'NR > 1 { count++ } END { print count + 0 }' "$actual_metadata")
printf 'restore_status=verified aggregate_counts=verified tables=%s\n' "$table_count"
if [ "${KEEP_RESTORE_DB:-0}" = "1" ]; then
  printf 'restore_database=%s\n' "$restore_db"
fi

