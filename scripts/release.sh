#!/usr/bin/env bash
# Stamp a version and push a tag. Does not publish to npm.
set -euo pipefail
ver=${1:?version required}
jq ".version = \"$ver\"" package.json > package.json.tmp && mv package.json.tmp package.json
git commit -am "chore: release v$ver"
git tag "v$ver"
git push origin main "v$ver"
