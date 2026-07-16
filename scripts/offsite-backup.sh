#!/bin/sh
set -eu

umask 077

: "${SOURCE_DIR:?SOURCE_DIR is required}"
: "${RCLONE_REMOTE:?RCLONE_REMOTE is required}"

RETENTION_DAYS=${RETENTION_DAYS:-30}
MIN_SOURCE_AGE_MINUTES=${MIN_SOURCE_AGE_MINUTES:-2}
MAX_SOURCE_AGE_MINUTES=${MAX_SOURCE_AGE_MINUTES:-1560}

case "$RETENTION_DAYS:$MIN_SOURCE_AGE_MINUTES:$MAX_SOURCE_AGE_MINUTES" in
  *[!0-9:]*|:*|*::*|*:)
    echo "Backup retention and freshness settings must be positive integers." >&2
    exit 64
    ;;
esac
if [ "$RETENTION_DAYS" -lt 1 ] || [ "$RETENTION_DAYS" -gt 3650 ] \
  || [ "$MIN_SOURCE_AGE_MINUTES" -lt 1 ] \
  || [ "$MAX_SOURCE_AGE_MINUTES" -le "$MIN_SOURCE_AGE_MINUTES" ]; then
  echo "Backup retention or freshness settings are outside safe bounds." >&2
  exit 64
fi

case "$RCLONE_REMOTE" in
  *:socos-postgres-backups) ;;
  *)
    echo "RCLONE_REMOTE must use the dedicated socos-postgres-backups namespace." >&2
    exit 65
    ;;
esac

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Backup source directory does not exist." >&2
  exit 66
fi

invalid_bundle=$(find "$SOURCE_DIR" -type f \
  \( -name '*.dump' -o -name '*.dump.sha256' -o -name '*.dump.metadata.tsv' \) \
  -exec sh -c '
    for file do
      case "$file" in
        *.dump.sha256) base=${file%.sha256}; [ -f "$base" ] || printf "%s\n" "$file" ;;
        *.dump.metadata.tsv) base=${file%.metadata.tsv}; [ -f "$base" ] || printf "%s\n" "$file" ;;
        *.dump) [ -f "$file.sha256" ] && [ -f "$file.metadata.tsv" ] || printf "%s\n" "$file" ;;
      esac
    done
  ' sh {} +)
if [ -n "$invalid_bundle" ]; then
  echo "Every independent backup must be a complete dump bundle." >&2
  exit 67
fi

recent_dmp=$(find "$SOURCE_DIR" -type f -name '*.dmp' \
  -mmin "+$MIN_SOURCE_AGE_MINUTES" \
  -mmin "-$MAX_SOURCE_AGE_MINUTES" \
  -print -quit)
recent_dump=$(find "$SOURCE_DIR" -type f -name '*.dump' \
  -mmin "+$MIN_SOURCE_AGE_MINUTES" \
  -mmin "-$MAX_SOURCE_AGE_MINUTES" \
  -exec sh -c '[ -f "$1.sha256" ] && [ -f "$1.metadata.tsv" ]' sh {} \; \
  -print -quit)
if [ -z "$recent_dmp" ] && [ -z "$recent_dump" ]; then
  echo "No recent completed PostgreSQL backup is available; retention was skipped." >&2
  exit 67
fi

# Refuse to upload anything until rclone confirms the named backend is a crypt
# wrapper. This check has no data-transfer side effects.
remote_type=$(rclone config show "${RCLONE_REMOTE%%:*}" \
  | sed -n 's/^type = //p' \
  | head -1)
if [ "$remote_type" != "crypt" ]; then
  echo "Off-host destination is not an rclone crypt remote." >&2
  exit 68
fi

# Repair any duplicates left by an interrupted Google Drive upload before the
# copy operation tries to compare destination objects by name.
rclone mkdir "$RCLONE_REMOTE"
rclone dedupe "$RCLONE_REMOTE" --dedupe-mode newest \
  --include '*.dmp' --include '*.dump' \
  --include '*.dump.sha256' --include '*.dump.metadata.tsv'

rclone copy "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dmp' \
  --min-age "${MIN_SOURCE_AGE_MINUTES}m" \
  --checksum \
  --transfers 2 \
  --checkers 4

rclone copy "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dump' \
  --include '*.dump.sha256' \
  --include '*.dump.metadata.tsv' \
  --checksum \
  --transfers 2 \
  --checkers 4

# Google Drive permits duplicate object names after an interrupted upload.
# Keep the newest encrypted object before the integrity comparison.
rclone dedupe "$RCLONE_REMOTE" --dedupe-mode newest \
  --include '*.dmp' --include '*.dump' \
  --include '*.dump.sha256' --include '*.dump.metadata.tsv'

# Verify plaintext source bytes against the encrypted remote without writing
# a decrypted dump outside the production host.
rclone cryptcheck "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dmp' \
  --min-age "${MIN_SOURCE_AGE_MINUTES}m" \
  --one-way

rclone cryptcheck "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dump' \
  --include '*.dump.sha256' \
  --include '*.dump.metadata.tsv' \
  --one-way

rclone delete "$RCLONE_REMOTE" --include '*.dmp' --min-age "${RETENTION_DAYS}d"

# Expire independent backups as a bundle. Delete the dump last so an interrupted
# retention pass cannot leave sidecars without their dump.
rclone lsf "$RCLONE_REMOTE" --files-only \
  --include '*.dump' --min-age "${RETENTION_DAYS}d" |
  while IFS= read -r old_dump; do
    [ -n "$old_dump" ] || continue
    rclone deletefile "$RCLONE_REMOTE/$old_dump.metadata.tsv"
    rclone deletefile "$RCLONE_REMOTE/$old_dump.sha256"
    rclone deletefile "$RCLONE_REMOTE/$old_dump"
  done
rclone rmdirs "$RCLONE_REMOTE" --leave-root

if ! rclone lsf "$RCLONE_REMOTE" --files-only \
  --include '*.dmp' --include '*.dump' | grep -q .; then
  echo "Off-host retention left no verified PostgreSQL backup." >&2
  exit 69
fi

printf 'offsite_backup_status=verified retention_days=%s\n' "$RETENTION_DAYS"
