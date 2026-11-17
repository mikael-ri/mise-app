#!/usr/bin/env bash
# Pre-backup step (A18, ADR-009): dumps the Mise and Authelia databases in pg_dump custom format into <dump-dir>.
# Your restic job then backs up <dump-dir>. This script configures neither restic nor monitoring.
#
# Usage: dump-databases.sh <dump-dir>
# Environment (no secrets are ever printed):
#   MISE_DUMP_DATABASE_URL       Mise DB as a NON-superuser read role (or the migrator). Put the password in ~/.pgpass / PGPASSFILE.
#   AUTHELIA_DUMP_USER           Non-superuser role on the Authelia DB with pg_read_all_data
#   AUTHELIA_DUMP_PASSWORD_FILE  File holding that role's password (sent to the container on stdin, not argv)
#   AUTHELIA_DB_CONTAINER        default: authelia_db (the compose.yaml project name is mise-authelia)
#   AUTHELIA_DB_NAME             default: authelia
#   METRICS_FILE                 optional: node_exporter textfile-collector file to write (e.g. /var/lib/node_exporter/textfile/mise_backup.prom)
# Exit code: 0 only if both dumps were written and verified; the previous good dumps stay in place on failure.
set -euo pipefail

dump_dir="${1:-}"
[ -n "$dump_dir" ] || { echo "usage: $0 <dump-dir>" >&2; exit 64; }
: "${MISE_DUMP_DATABASE_URL:?MISE_DUMP_DATABASE_URL is required}"
: "${AUTHELIA_DUMP_USER:?AUTHELIA_DUMP_USER is required}"
: "${AUTHELIA_DUMP_PASSWORD_FILE:?AUTHELIA_DUMP_PASSWORD_FILE is required}"
container="${AUTHELIA_DB_CONTAINER:-authelia_db}"
auth_db="${AUTHELIA_DB_NAME:-authelia}"
metrics_file="${METRICS_FILE:-}"

umask 077
start=$(date +%s)
step="start"
case "$MISE_DUMP_DATABASE_URL" in
  *://*:*@*) echo "MISE_DUMP_DATABASE_URL must not contain a password (it would show in ps); use ~/.pgpass or PGPASSFILE" >&2; exit 64 ;;
esac
last_success=0
prev_mise=0
prev_authelia=0
if [ -n "$metrics_file" ] && [ -f "$metrics_file" ]; then
  last_success=$(sed -n 's/^mise_backup_last_success_timestamp_seconds \([0-9]*\).*/\1/p' "$metrics_file" | head -n1)
  last_success=${last_success:-0}
  # Keep the last known-good sizes in the file when a run fails.
  prev_mise=$(sed -n 's/^mise_backup_dump_size_bytes{database="mise"} \([0-9]*\).*/\1/p' "$metrics_file" | head -n1)
  prev_authelia=$(sed -n 's/^mise_backup_dump_size_bytes{database="authelia"} \([0-9]*\).*/\1/p' "$metrics_file" | head -n1)
fi

mise_size=${prev_mise:-0}
authelia_size=${prev_authelia:-0}
log() { printf '%s mise-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

write_metrics() { # write_metrics <success 0|1>
  [ -n "$metrics_file" ] || return 0
  local tmp="${metrics_file}.$$"
  {
    echo '# HELP mise_backup_last_success_timestamp_seconds Unix time of the last fully successful dump run.'
    echo '# TYPE mise_backup_last_success_timestamp_seconds gauge'
    echo "mise_backup_last_success_timestamp_seconds $last_success"
    echo '# HELP mise_backup_last_run_success 1 if the most recent run succeeded, 0 if it failed.'
    echo '# TYPE mise_backup_last_run_success gauge'
    echo "mise_backup_last_run_success $1"
    echo '# HELP mise_backup_duration_seconds Duration of the most recent run.'
    echo '# TYPE mise_backup_duration_seconds gauge'
    echo "mise_backup_duration_seconds $(($(date +%s) - start))"
    echo '# HELP mise_backup_dump_size_bytes Size of the last successful dump per database.'
    echo '# TYPE mise_backup_dump_size_bytes gauge'
    echo "mise_backup_dump_size_bytes{database=\"mise\"} $mise_size"
    echo "mise_backup_dump_size_bytes{database=\"authelia\"} $authelia_size"
  } >"$tmp" && chmod 644 "$tmp" && mv "$tmp" "$metrics_file" # atomic; readable by the node_exporter user
}

on_exit() {
  local code=$?
  rm -f "$dump_dir"/.mise.dump.part "$dump_dir"/.authelia.dump.part
  if [ "$code" -ne 0 ]; then
    log "FAILED at step: $step (exit $code)"
    write_metrics 0 || true
  fi
}
trap on_exit EXIT

step="prepare dump dir"
mkdir -p "$dump_dir"
log "dump dir ready"

# --- Mise -------------------------------------------------------------------------------------------------
step="mise: role check"
is_super=$(psql "$MISE_DUMP_DATABASE_URL" -Atqc "select rolsuper from pg_roles where rolname = current_user")
[ "$is_super" = "f" ] || { log "refusing: Mise dump role is a superuser"; exit 1; }
log "mise: role is not a superuser"

step="mise: pg_dump"
pg_dump --format=custom --no-owner --dbname="$MISE_DUMP_DATABASE_URL" --file="$dump_dir/.mise.dump.part"
step="mise: verify archive"
pg_restore --list "$dump_dir/.mise.dump.part" >/dev/null
mv "$dump_dir/.mise.dump.part" "$dump_dir/mise.dump"
mise_size=$(stat -c %s "$dump_dir/mise.dump")
log "mise: dump written ($mise_size bytes)"

# --- Authelia (runs inside its Postgres container; its server version differs from the host client) -------
dexec() { docker exec -i "$container" sh -c "$1" sh "${@:2}"; }

step="authelia: role check"
is_super=$(dexec 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h 127.0.0.1 -U "$1" -d "$2" -Atqc "select rolsuper from pg_roles where rolname = current_user"' \
  "$AUTHELIA_DUMP_USER" "$auth_db" <"$AUTHELIA_DUMP_PASSWORD_FILE")
[ "$is_super" = "f" ] || { log "refusing: Authelia dump role is a superuser"; exit 1; }
log "authelia: role is not a superuser"

step="authelia: pg_dump"
dexec 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_dump -h 127.0.0.1 -U "$1" -d "$2" --format=custom --no-owner' \
  "$AUTHELIA_DUMP_USER" "$auth_db" <"$AUTHELIA_DUMP_PASSWORD_FILE" >"$dump_dir/.authelia.dump.part"
step="authelia: verify archive"
pg_restore --list "$dump_dir/.authelia.dump.part" >/dev/null
mv "$dump_dir/.authelia.dump.part" "$dump_dir/authelia.dump"
authelia_size=$(stat -c %s "$dump_dir/authelia.dump")
log "authelia: dump written ($authelia_size bytes)"

step="metrics"
last_success=$(date +%s)
write_metrics 1
log "OK in $((last_success - start))s"
