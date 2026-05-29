#!/usr/bin/env bash
# Start the embed sidecar, then everything else.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -d packages/embed/python/.venv ]; then
  pnpm --filter @clawmind/embed python:setup
fi
pnpm --filter @clawmind/embed python:serve &
EMBED_PID=$!
trap 'kill $EMBED_PID' EXIT
sleep 2
pnpm dev
