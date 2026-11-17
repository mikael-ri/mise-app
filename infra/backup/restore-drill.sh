#!/usr/bin/env bash
# Restore drill (A18): restores <dump-dir>/{mise,authelia}.dump into a THROWAWAY Postgres container and verifies the
# data. It never touches a real database: the container has no published port and is removed on exit.
# Usage: restore-drill.sh <dump-dir>
# Environment: SCRATCH_IMAGE (default postgres:18.6-alpine, the Authelia DB image; restores 17 and 18 dumps)
#              MIN_RECIPES / MIN_LISTS (default 1): fail if fewer rows are present
set -euo pipefail

dump_dir="${1:-}"
[ -f "$dump_dir/mise.dump" ] && [ -f "$dump_dir/authelia.dump" ] || { echo "usage: $0 <dump-dir containing mise.dump and authelia.dump>" >&2; exit 64; }
image="${SCRATCH_IMAGE:-postgres:18.6-alpine}"
min_recipes="${MIN_RECIPES:-1}"
min_lists="${MIN_LISTS:-1}"
name="mise-restore-drill-$$"
start=$(date +%s)
log() { printf '%s restore-drill: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
trap 'log "FAILED (exit $?)"' ERR

# Throwaway container, no published port, reachable only through docker exec: trust auth keeps any password off the command line.
docker run -d --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null
log "scratch database up ($image)"

psqlx() { docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atq "$@"; }
for db in mise authelia; do
  psqlx -d postgres -c "create database ${db}_restore"
  docker exec -i "$name" pg_restore -U postgres -d "${db}_restore" --no-owner --no-privileges --exit-on-error <"$dump_dir/$db.dump"
  log "$db: restored"
done

fail=0
count() { psqlx -d "$1" -c "select count(*) from $2"; }
check() { # check <label> <db> <table> <minimum>: a failing query aborts the drill with a clear message
  local n
  n=$(count "$2" "$3") || { log "check FAILED: cannot count $3 in $2"; exit 1; }
  if [ "$n" -ge "$4" ]; then log "check ok: $1 = $n"; else log "check FAILED: $1 = $n (need >= $4)"; fail=1; fi
}
check "recipes" mise_restore recipes "$min_recipes"
check "recipe_versions" mise_restore recipe_versions "$min_recipes"
check "shopping_lists" mise_restore shopping_lists "$min_lists"
check "users" mise_restore users 1
check "household_members" mise_restore household_members 1
check "applied migrations" mise_restore drizzle.__drizzle_migrations 1
check "authelia tables" authelia_restore "pg_tables where schemaname = 'public'" 1
items=$(count mise_restore shopping_items) && sessions=$(count mise_restore device_sessions)
log "info: shopping_items = $items, device_sessions = $sessions"
orphans=$(psqlx -d mise_restore -c "select count(*) from recipes r where not exists (select 1 from recipe_versions v where v.recipe_id = r.id)")
log "info: recipes without a version = $orphans (review if not 0)"

[ "$fail" -eq 0 ] || exit 1
log "DRILL OK in $(($(date +%s) - start))s"
