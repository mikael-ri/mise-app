# Backlog

Follow-ups that belong to a later card. Each item names the card or feature that should pick it up and where it came from.

| Item | Pick up in | Origin |
|---|---|---|
| Give system shopping categories a stable key and a label per language. The category-name duplicate check (`409 category_name_taken`) must compare against all of those labels, not only the stored fallback name. | The card that introduces UI translations (translated UI, P1) | A13; ADR-015 addendum "correction write rule and category names"; `docs/ui/conventions.md` §7 |
| Manage categories screen (rename and reorder household categories via the existing A13 create/rename endpoints; wireframe S5 in `docs/ui/shopping.md`). Low priority. Add hide or archive if the category list gets cluttered; that needs a contract change first (no hide or delete exists today). | A later shopping UI card, low priority | A15 (owner decision: skipped, item sheet category select is enough) |
| Replace the two `waitForTimeout` calls in the keyboard-drag test (`tests/e2e/ac-03-recipe-versions.spec.ts`, FR-01 reorder) with a wait on something real: the drag library's live-region announcement, or the new item order via `expect.poll`. Do it if the test ever flakes. | A later test-maintenance pass, when the test flakes | A16 (owner decision) |
| Markdown recipe export uses fixed English headings. When localisation is built, the export should use the household's or user's locale. | The card that introduces UI translations (translated UI, P1) | A17 |
| Add `fi.json` (including the optional-yield keys) and a locale key-parity test; only `en.json` exists today. | The card that introduces UI translations (translated UI, P1) | A17; ADR-015 addendum "optional recipe yield" |
| Reloading an export into a household creates new version ids and timestamps (history is replayed, not copied). Accepted for development and seeding only; not a restore tool. | Backup and restore work, if a recipe restore tool is ever wanted | A17 |
| Convention note: invalid body, query and params return 400 `validation_failed` on every route (`ERROR_STATUS` in `packages/contracts/src/errors.ts`), never 422. | Next API contract notes revision | A17 |
