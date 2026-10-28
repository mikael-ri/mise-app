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
