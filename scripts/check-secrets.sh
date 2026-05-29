#!/usr/bin/env bash
# Refuse to commit obvious secrets.
set -euo pipefail
if git diff --cached | grep -E '(api_key|secret|password|BEGIN .* PRIVATE KEY)' -i >/dev/null; then
  echo "Possible secret in staged changes. Aborting."
  exit 1
fi
