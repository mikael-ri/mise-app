---
globs:
  - 'apps/server/src/ai/**'
  - 'apps/server/src/recipe-import/**'
  - 'apps/server/src/conversations/**'
---

# AI rules

- Call only the Mise-owned `AiProvider` contract (`generateStructured`, `runToolTurn`, `extractFromImage`), never a vendor SDK from workflows.
- OpenAI is the only adapter in P0. No provider selector, failover or second adapter.
- AI tools call the same application services as UI endpoints. Household ID comes from the session, never from the model.
- Validate all model output with Zod schemas from `packages/contracts`.
- Never log prompts, chat content or images. No DB transaction across a provider call.
