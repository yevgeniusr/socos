#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[startup] SOCOS API starting..."

echo "[startup] Migration baseline is not approved; refusing to mutate or start against the database." >&2
echo "[startup] Complete the migration baseline task before enabling prisma migrate deploy." >&2
exit 1
