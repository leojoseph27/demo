#!/usr/bin/env bash
# .zscripts/dev.sh - Runs as a managed child of the container's init system
# The container's /start.sh detects this script and runs it automatically.
set -e

cd /home/z/my-project

# Load environment variables from .env.local
if [ -f .env.local ]; then
  set -a
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    export "$key=$value"
  done < .env.local
  set +a
  echo "[DEV] Loaded .env.local"
fi

# Check for production build
if [ -d .next ] && [ -f node_modules/next/dist/bin/next ]; then
  echo "[DEV] Starting Next.js production server on port 3000..."
  exec node node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
else
  echo "[DEV] No build found, running Next.js dev server on port 3000..."
  exec npx next dev -p 3000 -H 0.0.0.0
fi
