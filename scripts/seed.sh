#!/usr/bin/env bash
# Ingest a folder of sample notes for first run demos.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SEED=${1:-"$ROOT/samples"}
pnpm clawmind ingest "$SEED"
