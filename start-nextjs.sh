#!/usr/bin/env bash
cd /home/z/my-project
if [ -f .env.local ]; then
  set -a
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    export "$key=$value"
  done < .env.local
  set +a
fi
PORT=3000 HOSTNAME=0.0.0.0 node node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
