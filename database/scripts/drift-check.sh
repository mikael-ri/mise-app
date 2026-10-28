#!/usr/bin/env bash
# Fails if schema/*.ts differs from the committed migrations. Probes in a temp copy; never touches migrations/.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec drizzle-kit check
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r schema migrations drizzle.config.ts tsconfig.json "$tmp/"
ln -s "$PWD/node_modules" "$tmp/node_modules"
out=$(cd "$tmp" && ./node_modules/.bin/drizzle-kit generate --name=drift_probe 2>&1 || true)
if ! grep -q "No schema changes" <<<"$out"; then
  echo "$out" >&2
  echo "Schema drift: run pnpm db:generate and commit the migration." >&2
  exit 1
fi
