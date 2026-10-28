# A04 — Contracts, schema and migration 0001

**Depends on:** A01, A02, A03 · **Size:** L · **Model tier:** Strong
**Covers:** Milestone A gate: ingredient/shopping-origin modelling, API contracts, idempotency
**Read only:** DB §3, §5, §8 (A subset), §10, §12, §14; tech §5, §10, §11; spec FR-01–07, FR-34–39

## Goal
The single reviewed PR that fixes data shape and API shape for everything after it.

## Do
- Drizzle schema for A tables only: `users`, `households`, `household_members`, `device_sessions` (with `authenticated_at`), `recipes` (with `search_document`), `recipe_versions`, `household_ingredient_settings`, `shopping_categories`, `shopping_lists`, `shopping_items`, `idempotency_keys`, `audit_events`.
- `shopping_items` carries `origin`, `normalized_key`, `user_modified`, `revision` now, so D needs no destructive migration.
- Migration `0001`, including hand-written SQL from A01/A02.
- Zod contracts in `packages/contracts` for auth, recipes, shopping, health, plus the shared error shape and ID types; recipe content schema v1 with `schema_version`.
- Generate `docs/api/openapi.json` from the contracts; CI fails if it is stale.
- Record decisions: `409` vs `412` convention, `Idempotency-Key` header contract.

## Not in scope
- Tables for B–D (`shopping_import_batches`, `shopping_item_sources`, assets, cooking events, plans, AI tables).

## Done when
- Migration applies to an empty database, rolls back, passes the drift check.
- Contracts compile and generate OpenAPI. A human reviews the PR before merge.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
