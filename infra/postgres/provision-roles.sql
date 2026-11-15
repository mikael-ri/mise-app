-- Database roles for local development and CI (ADR-018). Idempotent: safe to run on every `up`.
-- Run as the bootstrap superuser against the `postgres` maintenance database:
--   psql -v ON_ERROR_STOP=1 -v allow_dev=1 -h <host> -U mise -d postgres -f provision-roles.sql
-- Refuses to run without `-v allow_dev=1`: it creates roles with PUBLISHED passwords and must never be
-- pointed at a production cluster (its role names match the production ones).
-- ALL PASSWORDS BELOW ARE THROWAWAY, LOCAL-ONLY VALUES. Production roles are created by hand in A19
-- with real secrets (see ADR-018); never reuse these.
--
-- Layout (two databases in one dev cluster, four roles):
--   database `mise`       owner mise_migrator   app role mise_app        (development data)
--   database `mise_test`  owner mise_test_owner app role mise_test_app   (integration tests; reset freely)
-- Neither pair can connect to the other's database (CONNECT is revoked from PUBLIC).

\if :{?allow_dev}
\else
  DO $$ BEGIN RAISE EXCEPTION 'dev/CI only: re-run with -v allow_dev=1 (this script uses published passwords)'; END $$;
\endif

SELECT 'CREATE ROLE mise_migrator LOGIN PASSWORD ''mise_dev_migrator_only'''
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mise_migrator') \gexec
SELECT 'CREATE ROLE mise_app LOGIN PASSWORD ''mise_dev_app_only'''
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mise_app') \gexec
-- The test owner may create databases, so MISE_TEST_DB_SUFFIX lanes (mise_test_a, ...) create themselves.
SELECT 'CREATE ROLE mise_test_owner LOGIN CREATEDB PASSWORD ''mise_test'''
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mise_test_owner') \gexec
SELECT 'CREATE ROLE mise_test_app LOGIN PASSWORD ''mise_test'''
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mise_test_app') \gexec

-- Development database: owned by the migrator. (A volume created before this file existed has tables
-- owned by the bootstrap superuser; recreate it with `docker compose -f infra/compose.dev.yaml down -v`.)
ALTER DATABASE mise OWNER TO mise_migrator;
REVOKE ALL ON DATABASE mise FROM PUBLIC;
GRANT CONNECT ON DATABASE mise TO mise_migrator, mise_app;

-- Test database for the shared test config (tests/support/test-database-config.ts).
SELECT 'CREATE DATABASE mise_test OWNER mise_test_owner'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mise_test') \gexec
REVOKE ALL ON DATABASE mise_test FROM PUBLIC;
GRANT CONNECT ON DATABASE mise_test TO mise_test_owner, mise_test_app;

-- Default privileges for the dev database, so the app role works right after `pnpm db:migrate`.
-- (`pnpm db:grants` then adds the few DELETE grants and converges everything else.)
\connect mise
ALTER DEFAULT PRIVILEGES FOR ROLE mise_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO mise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mise_migrator IN SCHEMA public GRANT USAGE ON SEQUENCES TO mise_app;
GRANT USAGE ON SCHEMA public TO mise_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
