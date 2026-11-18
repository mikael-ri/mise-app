# B03: Contracts, schema, migration 0002

**Depends on:** B00 · **Size:** L · **Model tier:** Strong · **Autonomy:** auto

## Covers
Database design section 14 (B tables), section 5.4. Technical section 8 and 9.3. ADR-006.

## Goal
All Milestone B data structures and API contracts exist, tested, with no behaviour yet.

## Do
- Drizzle schema and migration `0002` for `assets`, `import_drafts`, `cooking_events`, `ai_usage_records`, plus pricing config. Follow ADR 0018 roles: grants to the app role only as needed; DELETE only where listed.
- Zod contracts in the shared package for import (start, status, draft, confirm, discard), cooking events and ratings, and usage.
- Idempotency key handling for confirm.
- Error convention: invalid body, query or params return 400 `validation_failed` (see `ERROR_STATUS` in `packages/contracts/src/errors.ts`), never 422. Add any new error codes there.
- Migration tests against the test database, including rollback of a failed migration.

## Not in scope
Any endpoint logic, AI, fetching.

## Done when
Migration applies cleanly on an empty and on a Milestone A database; schema matches the design document; contract tests pass. The owner reviews the migration and contracts before merging.

## Security review
Yes.

## Merge gate
The owner reviews the migration and contracts before merging this lane.
