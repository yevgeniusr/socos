#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[startup] SOCOS API starting..."

echo "[startup] Applying Prisma migrations..."
if [ -x ./node_modules/.bin/prisma ]; then
  ./node_modules/.bin/prisma migrate deploy
else
  echo "[startup] Prisma CLI is unavailable; refusing to start without migrations." >&2
  exit 1
fi

echo "[startup] Starting NestJS..."
exec node dist/main.js
