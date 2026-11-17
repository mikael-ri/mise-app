# ADR-015 addendum: optional recipe yield

**Status:** Accepted (owner decision of 2026-11-17) · **Extends:** [ADR-015](0015-ingredient-model.md), relates to [ADR-005](0005-pin-version-at-approval.md) · **Cards:** A17

## Addendum (2026-11-17): a recipe may have no stated yield
**Finding:** Two real fixture recipes state no servings (`yield: null`). Schema v1 required a yield, which would have meant inventing one ("assume 4"), against hard rule 3.
**Decision / change:**
1. **Contract.** `RecipeContentV1.yield` becomes nullable (`{quantity, unit} | null`). No `schema_version` bump: every stored v1 document still parses. The yield lives only inside `recipe_versions.content` (JSONB), so there is no column, constraint or migration change. Search summaries already return `yield: null` when absent.
2. **Scaling semantics.** With no yield there is no servings base, so servings scaling is unavailable and no number is ever assumed. Plain factor scaling (x1/2, x2) still works through `scaleByFactor` in `packages/domain` (same rounding and policy rules as `scale`). The web shows "Servings not set" with a link to edit, disables the servings control and offers factor buttons. The recipe form may leave yield empty.
3. **Export and loader.** The Markdown export omits the Yield line; the loader keeps `null` as given.
4. **Planning rule (Milestone B, not built).** Plan approval pins version and target yield (ADR-005). When a recipe without a yield is added to a plan, the planner must ask for the servings (or an explicit factor), and the pinned target yield is then stored on the plan slot, never inferred.
**Consequences:** Consumers of content must handle `yield === null`. Old versions are unchanged.
**Change request:** the frozen spec and technical design describe the yield as part of recipe content without saying it can be absent; the owner decides whether to amend them at the next baseline revision.

## Backlog notes (A17 follow-ups, document only)
- **Locale:** the Markdown export uses fixed English headings. When localisation is built, the export should use the household's or user's locale.
- **Finnish strings:** only `en.json` exists. Add `fi.json` (including the optional-yield keys) with a locale key-parity test.
- **Dev-only reload:** loading an export into a household creates new version ids and timestamps (history is replayed, not copied). Accepted for development and seeding only, not a restore tool.
- **API notes:** invalid body, query and params return 400 `validation_failed` on every route (see `ERROR_STATUS` in `packages/contracts/src/errors.ts`).
