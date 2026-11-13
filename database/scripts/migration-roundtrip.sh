#!/usr/bin/env bash
# A04 gate: migrations apply to an EMPTY database, roll back completely, and re-apply.
# Destructive: refuses to run unless the target database has no tables in `public`.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL must be set}"
q() { node -e '
  const pg = require("pg"); const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.query(process.argv[1])).then((r) => { console.log(r.rows[0]?.n ?? ""); return c.end(); })
   .catch((e) => { console.error(e.message); process.exit(1); });' "$1"; }
count_public="SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'"
count_ext="SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'"
n_migrations=$(ls migrations/*.sql | wc -l)

[ "$(q "$count_public")" = "0" ] || { echo "refusing: public schema is not empty" >&2; exit 1; }
pnpm exec drizzle-kit migrate
[ "$(q "$count_public")" = "12" ] || { echo "expected 12 tables after migrate" >&2; exit 1; }
MISE_ALLOW_DESTRUCTIVE=1 node src/rollback.ts "$n_migrations"  # guarded above: public schema was empty
[ "$(q "$count_public")" = "0" ] || { echo "tables left after rollback" >&2; exit 1; }
[ "$(q "$count_ext")" = "0" ] || { echo "pg_trgm left after rollback" >&2; exit 1; }
pnpm exec drizzle-kit migrate
[ "$(q "$count_public")" = "12" ] || { echo "expected 12 tables after re-migrate" >&2; exit 1; }
echo "migration round-trip OK ($n_migrations migrations)"
