# B11: Web cooking history, ratings, filters

**Depends on:** B09, B02 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Goal
The cooking UI in `docs/ui/cooking.md`.

## Do
- "I cooked this" sheet, history list on the recipe page, ratings display, list filters.
- Tested checkbox defaults on.
- All user-visible text goes through i18n keys in `en.json` only (no `fi.json` yet; backlog: translated UI). No hard-coded strings.

## Done when
Component tests and an e2e test for recording an event and filtering by it.
