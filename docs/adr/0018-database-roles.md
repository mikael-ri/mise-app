# ADR-018 — Database roles: migrator owns the schema, the app has least privilege

**Status:** Accepted (2026-11-15; the frozen baselines say nothing about database roles) · **Cards/milestone:** A19 (production setup), A09 follow-up (test setup) · **Baseline:** DB §5.1, §11 (frozen, silent)

## Decision
Two roles per database.
- **Migrator role** (production name `mise_migrator`). Owns every schema object (tables, sequences, functions, triggers). It is the only role the migrate command uses, through its own `MIGRATION_DATABASE_URL`. No running process other than the migrate command holds this URL.
- **App role** (production name `mise_app`). Used by the server and the admin CLIs through `DATABASE_URL`. It is not an owner and not a superuser.
  - `SELECT`, `INSERT`, `UPDATE` on all tables, `USAGE` on sequences, `USAGE` on schema `public`.
  - `DELETE` only on tables where the domain hard-deletes rows (table list below).
  - No DDL (no `CREATE` on the schema), no `TRUNCATE`, no `TRIGGER`, no `REFERENCES`. It cannot disable or drop triggers: only an owner can.
- `ALTER DEFAULT PRIVILEGES` (run as the migrator) grants the app role `SELECT, INSERT, UPDATE` on future tables and `USAGE` on future sequences, so a new migration needs no per-table grants. A new `DELETE` grant is a deliberate edit to the table list in `database/roles/` plus a review.
- Grants are applied by `database/roles/` (`applyAppGrants`, also behind `pnpm db:grants`) with the app role name as a parameter, because role names differ per environment. They are not in a numbered migration.
- A19 owns the production role setup and a check that the live database matches this ADR (owner, grants, no extra privileges).

**Tables where the app role gets `DELETE` (Milestone A):**

| Table | Why the domain deletes rows |
|---|---|
| `idempotency_keys` | expired keys are removed before a key is reused and by the sweep (ADR-013, A06) |
| `shopping_items` | a user removes an item from a list (`DELETE /shopping-items/{id}` is in the contract; the code arrives with A13, so today only `idempotency_keys` is deleted from) |

Everything else is insert/update only: recipes and plans are soft-archived (DB §10.2), device sessions are revoked with `revoked_at`, `recipe_versions` is immutable (trigger, DB §5.1), audit events are append-only. Later milestones add tables (for example conversation messages, import drafts) by amending this list.

## Guardrails
- Immutability of `recipe_versions` rests on this split: the app role cannot `DISABLE TRIGGER`, `DROP TRIGGER`, `TRUNCATE` or `DELETE` there. A test running as the app role proves it.
- Tests use the same layout with their own roles (`mise_test_owner`, `mise_test_app`) on a database whose name ends in `_test`, so a missing grant fails a test, not production.
- Backup (ADR-009) needs a role that can read everything; defining it is A18/A19 work, not the app role.
- Production setup (A19) must also `REVOKE ALL ON DATABASE <db> FROM PUBLIC` (no TEMP/CREATE for the app), run the grants as the migrator only (the grants code refuses to run as a superuser or non-owner), and add the startup check described under Consequences.
- `infra/postgres/provision-roles.sql` is dev/CI only (published passwords) and refuses to run without `-v allow_dev=1`.
- Ownership by a superuser (for example the bootstrap `POSTGRES_USER`) defeats this decision; production tables must be owned by the migrator.

## Consequences
- **Startup check (A19).** In production the server queries its own role at startup (`rolsuper` from `pg_roles`, and any table in `public` whose `tableowner` is its own role) and refuses to start if it is a superuser or owns any table. This makes the decision self-enforcing: a mis-set `DATABASE_URL` pointing at the migrator or the bootstrap superuser stops the deploy instead of silently defeating the trigger protection. The check is on the A19 card.
- **Commands.** `pnpm db:migrate` needs `MIGRATION_DATABASE_URL` (the migrator); the server and CLIs keep `DATABASE_URL` (the app role). After migrating, `pnpm --filter @mise/database db:grants` converges the app role's privileges. Nothing else holds the migrator URL.
- **Earlier spike addenda.** This ADR replaces the superuser connection (`mise` / `mise_dev_only`, used as `DATABASE_URL`) that the ADR-002 and ADR-010 spike addenda describe. Those addenda record what was true at the time of the spikes and are not edited; the two differ because the roles came later.
- **Tests.** Integration tests run as `mise_test_app` and reset the test database as `mise_test_owner` (schema drop and re-migrate, never `TRUNCATE` or a disabled trigger), so a missing grant fails a test.
- **New tables.** A table that needs hard deletes is a new row in the DELETE list above, reviewed like any other privilege change.

## Read more
DB §5.1, §10.2, §11; ADR-009, ADR-013; `database/roles/`; `docs/repository-structure.md` ("Test database and roles")
