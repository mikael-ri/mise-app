# ADR-002 addendum — Drizzle/PostgreSQL spike (A01)

**Status:** Spike complete; no material blocker. Prisma/Kysely comparison stays closed.
**Evidence:** `database/spike/recipes.int.test.ts` (6 tests, real PostgreSQL 17), migrations `database/migrations/0000–0002`.

## Dependencies added to `@mise/database` (CLAUDE.md rule 10)
`drizzle-orm` (the ORM selected by ADR-002), `pg` (its node-postgres driver, also used by `rollback.ts`), `@types/pg` (types). `vitest` comes from the workspace root. `database` has no `test` script, so `pnpm check` does not run the integration tests; run `pnpm --filter @mise/database test:int` with `DATABASE_URL` set. A04 should decide how CI wires this in.

## What worked
- **Composite FK for the circular pointer.** `recipes(id, current_version_id)` → `recipe_versions(recipe_id, id)` (needs `UNIQUE(recipe_id, id)` on versions). Drizzle `foreignKey()` generates it natively. MATCH SIMPLE lets the pointer be NULL during the insert. A pointer to another recipe's version fails with the FK name.
- **Atomic create** (insert recipe with null pointer → insert version 1 → update pointer + `search_text`) in one `db.transaction`; a thrown error rolls everything back (`src/create-recipe.ts`, `src/transaction.ts`).
- **Search column strategy: generated column.** `search_text` is a plain flattened-text column written by the service in the same transaction; `search_document tsvector GENERATED ALWAYS AS (to_tsvector('finnish'::regconfig, search_text)) STORED`. Works because it reads only its own row (the regconfig literal keeps it immutable). The trigger alternative is not needed; it only helps if the projection must read other tables. Drizzle expresses it with `customType` + `.generatedAlwaysAs(sql\`…\`)`.
- **Indexes:** GIN on `search_document`; GIN `gin_trgm_ops` on `search_text` (Drizzle `.op('gin_trgm_ops')`). Finnish inflection (`lohi`→`lohta`) and trigram typo match (`lohikeito`) both verified. Full golden corpus is ADR-010's job.
- **Immutability: DB trigger.** BEFORE UPDATE/DELETE row trigger and BEFORE TRUNCATE statement trigger on `recipe_versions` raise `integrity_constraint_violation`. Also keep service-level discipline (never issue UPDATE).
- **Migrate up / roll back / re-migrate** verified manually (`db:migrate`, `db:rollback 3`, `db:migrate`, then the integration tests); not scripted in CI.

## Exceptions / gotchas
1. **Migration order.** Drizzle Kit does not know extensions. `0000_extensions.sql` (custom) must precede the migration with `gin_trgm_ops`. Create it with `drizzle-kit generate --custom --name=...` first.
2. **Circular table references break TS inference** (TS7022/7024). Fix: `.references((): AnyPgColumn => recipes.id)` and cast the composite `foreignColumns` to `[AnyPgColumn, AnyPgColumn]`.
3. **Errors are wrapped.** Drizzle throws `DrizzleQueryError`; the PostgreSQL message/code (`constraint`, `code`) is on `.cause`. Repositories must unwrap `cause` when mapping to 409/422.
4. **No down migrations.** Drizzle Kit has none. We keep hand-written `migrations/down/NNNN_name.down.sql` and `src/rollback.ts` (dev/scratch use; production is roll-forward only, per hard rule 6).
5. `drizzle-kit generate` in a folder with an empty `meta/` fails (missing `_journal.json`); do not leave an empty `meta/`.
6. Custom (hand-written) migrations are not reflected in the Drizzle snapshot. Triggers and extensions are therefore invisible to the drift check (see below).

## Notes for A04
- `search_text` is a denormalised copy of version content plus notes. Every service path that changes either must rewrite it in the same transaction, or search goes stale.
- `drift-check.sh` greps for "No schema changes"; if drizzle-kit changes that wording the check will report false drift. `rollback.ts` removes the latest journal row, so it only works for the newest N migrations.

## Migration conventions (for A04)
- `pnpm db:generate` for schema changes; `drizzle-kit generate --custom --name=<x>` for hand-written SQL; separate statements with `--> statement-breakpoint`.
- Never edit an applied migration. Hand-written SQL lives next to generated files in `migrations/`; extensions first.
- Every migration gets a `migrations/down/` file for local rollback.
- Integration tests (`*.int.test.ts`) use real PostgreSQL via `DATABASE_URL` (dev compose: port 5433).

## Enum choice: text + CHECK
Use `text` columns with `CHECK (col IN (...))`, not PostgreSQL enums. `ALTER TYPE … ADD VALUE` has transaction and rollback limits and values cannot be removed, which clashes with additive, rollback-able migrations. A CHECK is replaced in one transaction. In Drizzle, define the allowed values once in `packages/contracts` (Zod) and use `text('col', { enum: [...] })` plus an explicit `check()`. Not exercised by the spike tables (they have no enum column); this is a design decision, not a tested one.

## Drift check
`pnpm --filter @mise/database db:drift` (`database/scripts/drift-check.sh`): runs `drizzle-kit check` (journal/snapshot consistency), then `drizzle-kit generate` in a temp copy and fails unless it reports "No schema changes". Needs no live database for the comparison, though the config reads `DATABASE_URL`. Not covered: hand-written SQL (triggers, extensions); those are covered by the integration tests.

## Reusable snippets for A04
`database/schema/recipes.ts` (composite FK, generated tsvector, trigram index), `database/src/transaction.ts` (`createDb`, `withTransaction`), `database/src/create-recipe.ts` (atomic create), `database/migrations/0002_*.sql` (immutability trigger).

## Addendum (2026-11-12): migration baseline for Milestone A (card A04)
**Evidence:** `database/migrations/0000_prerequisites.sql`, `0001_milestone_a.sql`, `down/`; `database/scripts/migration-roundtrip.sh` (empty DB -> migrate -> roll back all -> no tables and no `pg_trgm` left -> migrate again; passed on PostgreSQL 17); `database/test/schema.int.test.ts`; `pnpm --filter @mise/database db:drift`.
**Finding:** The spike migrations `0000`-`0002` were applied only to scratch/dev databases, and their `search_text` design was superseded by the A02 search design.
**Decision / change (approved by the owner in A04):**
1. **Migration baseline reset.** The spike migrations were deleted and replaced by `0000_prerequisites` (hand-written: `pg_trgm` and the `fold()` function) and `0001_milestone_a` (generated A tables; the hand-written immutability trigger and the system-default shopping categories are appended below a marker line). From now on these are applied migrations: never edit them, only add new ones. Dev databases that hold the old spike migrations must reset the volume (`docker compose -f infra/compose.dev.yaml down -v`) before migrating.
2. **Search columns now, not in A10.** `recipes` uses the A02 design from the start: `search_title`, `search_ingredients`, `search_body` (written by the service), plus generated `search_document` (weighted `finnish` + `simple`) and `search_fold` with GIN and trigram indexes. A10 needs no search migration. It implements the query and the flattening.
3. **Household consistency.** Composite FKs `(household_id, member_id) -> household_members(household_id, id)` for every member reference on household-scoped tables. `shopping_items` carries a denormalised `household_id` so that its list and picker are tied to the same household. `recipe_versions.created_by_member_id` is a plain FK because the table has no `household_id`; the service always uses the session member.
4. **Shopping category scope.** That a household's settings or items reference only system categories or the household's own categories is enforced in the A13 service, not by a trigger (owner decision).
5. **Staples.** `household_ingredient_settings` exists in A, but there are no endpoints until generation needs them (owner decision; FR-05 staples matter for Milestone D generated rows).
6. **Enums.** `text` + CHECK, with values imported from `@mise/contracts` (`database` now depends on the contracts workspace package).
7. **Additions beyond the DB-design columns:** `shopping_items.note` (FR-35 notes); `recipes.created_by_member_id`, `created_at`, `updated_at` (tech §5); `shopping_categories.system_code`, which the web maps to i18n keys (hard rule 5).
8. **After the A04 security review (owner decisions):**
   - `household_members` has `UNIQUE(user_id)`, so in P0 a user belongs to exactly one household and the session resolves to one membership.
   - `recipes` has `UNIQUE(household_id, id)`, the target for later household-scoped composite FKs. It also replaces the plain `household_id` index.
   - `src/rollback.ts` refuses to run unless `MISE_ALLOW_DESTRUCTIVE=1` is set. The round-trip script sets it only after checking that the schema was empty.
   - The A02 search spike test drops its `spike_a02` schema after it runs.
**Consequences:** CI now runs the round-trip, the integration tests and the drift check against a PostgreSQL 17 service. `database/spike/recipes.int.test.ts` is superseded by `database/test/schema.int.test.ts`.
**Still to verify:** the composite-FK and immutability behaviour under the real services (A09, A13).
