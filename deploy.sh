#!/usr/bin/env bash
# deploy.sh — fast-forward pull, build, restart pm2. Mirrors the bot's deploy.
# Never disturbs port 3333 or the other PM2 services on this box.
set -euo pipefail

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy] ERROR: uncommitted changes to tracked files. Stash or reset first." >&2
  exit 1
fi

echo "[deploy] pulling (ff-only)..."
git pull --ff-only

echo "[deploy] installing + building..."
npm ci
npm run build

echo "[deploy] restarting pm2..."
pm2 startOrReload ecosystem.config.cjs --update-env

echo "[deploy] Deployed."
