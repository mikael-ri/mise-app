---
globs:
  - 'apps/server/src/auth/**'
  - 'apps/server/src/assets/**'
  - 'apps/server/src/recipe-import/**'
  - 'apps/server/src/ai/**'
  - 'apps/server/src/platform/http/**'
  - 'infra/**'
---

# Security rules

- Authorization comes from the session only; every query is household-scoped.
- Device sessions: opaque, hashed, per-device, revocable. Every new session needs fresh OIDC auth (`max_age=0`, verified `auth_time`). No bypass session minting.
- Never log secrets, tokens, profile data, chat content or images.
- Validate every boundary with Zod. Importers must guard against SSRF. Uploads are never publicly mounted.
