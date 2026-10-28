# A01 — Spike: Drizzle and PostgreSQL

**Depends on:** A00 · **Size:** M · **Model tier:** Regular
**Covers:** ADR-002 validation gate
**Read only:** DB §5.1, §5.3, §10.1, §12, §13; tech §5.2

## Goal
Prove the selected ORM handles the PostgreSQL-specific needs before the real schema.

## Do
- On a spike branch, model only `recipes` and `recipe_versions`.
- Composite FK or validated constraint so `current_version_id` must belong to the same recipe; atomic create of recipe + version 1 + pointer.
- A hand-written SQL migration: `pg_trgm`, a GIN index, and one search-column strategy (generated vs trigger-maintained).
- Immutability guard for `recipe_versions` (trigger or service-level) and a transaction helper.
- Migrate up, roll back, and a schema-drift check usable in CI.
- Decide enum strategy: PostgreSQL enums or text + CHECK.

## Not in scope
- The real schema (that is A04).

## Done when
- Addendum `docs/adr/0002-addendum-drizzle-spike.md` answers: what worked, exceptions found, migration conventions, enum choice, drift-check command.
- Reusable snippets are noted for A04. No material blocker, or a new ADR is drafted.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
