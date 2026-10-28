---
globs:
  - 'apps/server/**'
---

# Server rules

- Flow: handler -> application service -> repository -> PostgreSQL. Handlers stay thin: parse with Zod, authenticate, call one service, map errors.
- Modules import each other only via `index.ts`.
- Error body: `{code, message, details?, correlationId}`. Stale writes return 409.
- Retriable mutations take an `Idempotency-Key`. No DB transaction across an external call.
- Create a module folder only when its milestone starts.
