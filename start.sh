#!/usr/bin/env bash
# start.sh - Production server startup script
# Loads environment variables from .env.local before starting the standalone Next.js server
set -e

# Load .env.local (skip comments and empty lines)
if [ -f .env.local ]; then
  set -a
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Trim whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    export "$key=$value"
  done < .env.local
  set +a
  echo "✓ Loaded environment variables from .env.local"
else
  echo "⚠ Warning: .env.local not found"
fi

# Start the standalone server
exec node .next/standalone/server.js 2>&1 | tee server.log
