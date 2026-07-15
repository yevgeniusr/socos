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

if ! find "$SOURCE_DIR" -type f -name '*.dmp' \
  -mmin "+$MIN_SOURCE_AGE_MINUTES" \
  -mmin "-$MAX_SOURCE_AGE_MINUTES" \
  -print -quit | grep -q .; then
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
rclone dedupe "$RCLONE_REMOTE" --dedupe-mode newest --include '*.dmp'

rclone copy "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dmp' \
  --min-age "${MIN_SOURCE_AGE_MINUTES}m" \
  --checksum \
  --transfers 2 \
  --checkers 4

# Google Drive permits duplicate object names after an interrupted upload.
# Keep the newest encrypted object before the integrity comparison.
rclone dedupe "$RCLONE_REMOTE" --dedupe-mode newest --include '*.dmp'

# Verify plaintext source bytes against the encrypted remote without writing
# a decrypted dump outside the production host.
rclone cryptcheck "$SOURCE_DIR" "$RCLONE_REMOTE" \
  --include '*.dmp' \
  --min-age "${MIN_SOURCE_AGE_MINUTES}m" \
  --one-way

rclone delete "$RCLONE_REMOTE" --include '*.dmp' --min-age "${RETENTION_DAYS}d"
rclone rmdirs "$RCLONE_REMOTE" --leave-root

if ! rclone lsf "$RCLONE_REMOTE" --files-only --include '*.dmp' | grep -q .; then
  echo "Off-host retention left no verified PostgreSQL backup." >&2
  exit 69
fi

printf 'offsite_backup_status=verified retention_days=%s\n' "$RETENTION_DAYS"
