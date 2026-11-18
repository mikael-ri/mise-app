# A12 — Web recipes

**Depends on:** A05, A09, A10, A11 · **Size:** L · **Model tier:** Regular
**Covers:** FR-01, 02, 05, 06, 07; AC-02, AC-03, AC-14, AC-18
**Read only:** spec FR-01–07, AC-14; rules web.md, domain.md; `docs/ui/conventions.md`, `docs/ui/recipes.md`

## Goal
Everything recipe-related in the browser.

## Do
- List with search and tag filter; detail view.
- Servings converter: ephemeral, uses `packages/domain`, reset to canonical, never saves.
- Create and edit form: ingredient lines, groups, ranges, original units, scale policy.
- Version history and restore; archive.
- `409` conflict experience when someone else edited.

## Not in scope
- Import, cooking feedback, ratings.

## Done when
- Playwright tests for AC-02, AC-03, AC-14; Finnish names render correctly; checked at a phone viewport.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
