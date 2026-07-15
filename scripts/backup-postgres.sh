#!/bin/sh
set -eu

umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-./backups/postgres}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$BACKUP_DIR/socos-$timestamp.dump"
metadata_file="$backup_file.metadata.tsv"
checksum_file="$backup_file.sha256"

mkdir -p "$BACKUP_DIR"

cleanup_incomplete() {
  rm -f "$backup_file" "$metadata_file" "$checksum_file"
}
trap cleanup_incomplete HUP INT TERM

pg_dump --format=custom --no-owner --no-privileges --file "$backup_file" "$DATABASE_URL" >/dev/null
chmod 0600 "$backup_file"

# query_to_xml lets PostgreSQL calculate exact counts for every public table
# without selecting or serializing row values.
psql -X "$DATABASE_URL" \
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
  " > "$metadata_file"
chmod 0600 "$metadata_file"

(
  cd "$BACKUP_DIR"
  shasum -a 256 "$(basename "$backup_file")" > "$(basename "$checksum_file")"
)
chmod 0600 "$checksum_file"
trap - HUP INT TERM

table_count=$(awk 'NR > 1 { count++ } END { print count + 0 }' "$metadata_file")
printf 'backup_status=created tables=%s\n' "$table_count"
printf 'backup_file=%s\n' "$backup_file"

