---
globs:
  - 'database/**'
  - '**/*.sql'
  - 'apps/server/src/**/repository.ts'
---

# Database rules

- Migrations are additive; never edit an applied migration.
- `numeric` for quantities, `date` for local days, `timestamptz` for instants.
- Every repository query is household-scoped. All SQL for a module lives in its `repository.ts`.
- Only current-milestone tables exist in `database/schema/`. Hand-written SQL sits next to generated migrations.
