#!/bin/sh
set -eu

umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-./backups/postgres}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$BACKUP_DIR/socos-$timestamp-$$.dump"
metadata_file="$backup_file.metadata.tsv"
checksum_file="$backup_file.sha256"

mkdir -p "$BACKUP_DIR"
work_dir=$(mktemp -d "$BACKUP_DIR/.socos-backup.XXXXXX")
work_backup="$work_dir/backup.dump"
work_metadata="$work_dir/backup.metadata.tsv"
work_checksum="$work_dir/backup.sha256"
snapshot_dir=$(mktemp -d "${TMPDIR:-/tmp}/socos-snapshot.XXXXXX")
snapshot_file="$snapshot_dir/id"
snapshot_ready="$snapshot_dir/ready"
snapshot_sql="$snapshot_dir/hold.sql"
snapshot_pid=
complete=0

cleanup_incomplete() {
  if [ -n "$snapshot_pid" ]; then
    kill "$snapshot_pid" >/dev/null 2>&1 || true
    wait "$snapshot_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir" "$snapshot_dir"
  if [ "$complete" -ne 1 ]; then
    rm -f "$backup_file" "$metadata_file" "$checksum_file"
  fi
}
trap cleanup_incomplete EXIT
trap 'exit 1' HUP INT TERM

cat > "$snapshot_sql" <<EOF
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot()
\g $snapshot_file
\! touch $snapshot_ready
SELECT pg_sleep(86400);
EOF

# Hold one repeatable-read transaction open while both the dump and aggregate
# query import its snapshot. This makes the metadata describe the dump exactly.
SOCOS_SNAPSHOT_FILE="$snapshot_file" SOCOS_SNAPSHOT_READY="$snapshot_ready" \
  psql -X "$DATABASE_URL" --set=ON_ERROR_STOP=1 --tuples-only --no-align \
    --file="$snapshot_sql" >/dev/null 2>&1 &
snapshot_pid=$!

attempt=0
while [ ! -f "$snapshot_ready" ]; do
  if ! kill -0 "$snapshot_pid" >/dev/null 2>&1; then
    echo "Could not export a consistent database snapshot." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    echo "Timed out exporting a consistent database snapshot." >&2
    exit 1
  fi
  sleep 0.1
done

snapshot_id=$(tr -d '[:space:]' < "$snapshot_file")
case "$snapshot_id" in
  ''|*[!0-9A-Fa-f-]*)
    echo "Database returned an invalid snapshot identifier." >&2
    exit 1
    ;;
esac

pg_dump --format=custom --no-owner --no-privileges \
  --snapshot="$snapshot_id" --file "$work_backup" "$DATABASE_URL" >/dev/null
chmod 0600 "$work_backup"

# query_to_xml lets PostgreSQL calculate exact counts for every public table
# without selecting or serializing row values.
psql -X "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --quiet \
  --no-align \
  --field-separator="$(printf '\t')" \
  --pset=footer=off \
  --command="
    BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET TRANSACTION SNAPSHOT '$snapshot_id';
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
    COMMIT;
  " > "$work_metadata"
chmod 0600 "$work_metadata"

kill "$snapshot_pid" >/dev/null 2>&1 || true
wait "$snapshot_pid" >/dev/null 2>&1 || true
snapshot_pid=

if command -v sha256sum >/dev/null 2>&1; then
  checksum=$(sha256sum "$work_backup" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  checksum=$(shasum -a 256 "$work_backup" | awk '{ print $1 }')
else
  echo "A SHA-256 checksum utility is required." >&2
  exit 1
fi
printf '%s  %s\n' "$checksum" "$(basename "$backup_file")" > "$work_checksum"
chmod 0600 "$work_checksum"

# The dump is the commit marker. Sidecars are renamed first and removed by the
# EXIT trap if the final rename cannot complete.
mv "$work_metadata" "$metadata_file"
mv "$work_checksum" "$checksum_file"
mv "$work_backup" "$backup_file"
complete=1

table_count=$(awk 'NR > 1 { count++ } END { print count + 0 }' "$metadata_file")
printf 'backup_status=created tables=%s\n' "$table_count"
printf 'backup_file=%s\n' "$backup_file"
