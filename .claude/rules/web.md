---
globs:
  - 'apps/web/**'
---

# Web rules

- All user-visible strings use i18n keys from `src/i18n`.
- No business logic in components; use `packages/contracts` and the API client in `lib/`.
- Never import `apps/server` or `database`.
- Live shopping: SSE carries `{listId, seq}` only; refetch via REST. Checkoff is `setPicked`, never toggle.
