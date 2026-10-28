---
globs:
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - 'tests/**'
---

# Testing rules

- Unit tests beside code; E2E in `tests/e2e`, specs named after the AC they prove.
- Test names include the FR/AC ID when one applies.
- Integration tests (`*.int.test.ts`) use real PostgreSQL, not mocks of it.
