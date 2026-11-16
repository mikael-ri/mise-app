# ADR-015 — Ingredient, unit and category model

**Status:** Accepted · **Cards/milestone:** A04, A05 · **Baseline:** tech §16 (frozen)

## Decision
Each ingredient line has a stable ID, optional group, display name, normalized key, quantity as a range, canonical unit plus original text, scale policy, preparation note and optional alternatives. Quantities use decimal/rational arithmetic with friendly-fraction display. Finnish units are a maintained table. Shopping category is keyword dictionary first, LLM fallback later, manual override persisted per normalized key. The staple flag is per household and key.

## Guardrails
- Count, mass and volume are never converted into each other; package sizes are never invented.
- In Milestone A the normalized key is lowercased and trimmed; the dictionary arrives later.

## Read more
Spec FR-05; tech §5.1; DB §5.2

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.

## Addendum — A05 (domain package)

- **Rational helper:** `packages/domain` uses an in-house exact rational on `BigInt` (`rational.ts`) rather than a decimal library. Scaling is `value x target/base` with arbitrary yields (e.g. 3.5, 1/3 of a recipe); decimal libraries round at a fixed precision, so scaling by f then 1/f would not be exact. Rationals are exact, need no dependency, and the surface needed (parse, add, mul, div, compare, round, format) is small. Input accepts `1.5`, `1,5`, `1/2`, `1 1/2`. No floats are used for quantity arithmetic.
- **fast-check:** added as a devDependency of `@mise/domain` only, for the property test "scale by f then 1/f returns the original for linear lines". Not shipped at runtime.
- **Units table additions:** a `length` dimension with `cm` (for accompaniments such as `5 cm kurkkua`; never converted to anything), and `rs` (rasia) as a package unit. `cl` added as volume. Only volume and mass convert, within their own dimension; count, package and length never convert.
- **Rounding warning:** for `round_to_whole` lines, `scale()` emits a `rounding_changes_amount` warning when rounding changes a scaled value by more than 10% relative to the exact value (threshold `ROUNDING_WARNING_THRESHOLD`). Positive amounts never round to zero (minimum 1). Rounding is half-up.
- **Unit table location:** the table is embedded in `units.ts` (the package does no I/O); a test asserts it equals `tests/fixtures/units.json`.
- **Vague terms:** `ripaus` and `kourallinen` are included next to `maun mukaan` as vague amounts that are never scaled numerically.
- **Warnings are code-only:** `ScaleWarning` carries a code and numbers, no text; the web layer maps codes to i18n keys.

## Addendum (2026-11-16): shopping category resolution order (card A13)
**Evidence:** `apps/server/src/shopping/categorize.ts` (`CATEGORIZE_STEPS`), `apps/server/src/shopping/shopping.int.test.ts` ("FR-36: categories ..."); the quantity-text parser in `packages/domain/src/quantity-text.ts` with table tests.
**Finding:** The decision above says "keyword dictionary first, LLM fallback later, manual override persisted per normalized key" but does not fix where the override sits relative to the dictionary. A13 ships no dictionary, so the order has to be settled now so the dictionary can be added later without reworking the categorizer.
**Decision / change (owner, A13):**
- **Order.** Category resolution for a shopping item, first match wins:
  1. Explicit category chosen by the member in the request.
  2. Household override for the normalized key (`household_ingredient_settings.shopping_category_id`).
  3. Keyword dictionary (not built yet).
  4. LLM suggestion (later, never in the request path of a manual add; FR-39/AC-10).
  5. `Other`. This step always answers and stays last.
- **Shape.** The categorizer is an ordered list of steps, each returning a category ID or "no answer". New steps are inserted into the list; existing steps do not change.
- **Corrections.** An explicit category on add or edit is stored as the household override for the item's key. Clearing an item's category (`categoryId: null`) sets the item to `Other` and clears the override.
- **Household categories.** Households can create, rename and reorder their own categories. System defaults are read-only. Names are unique per household, ignoring case (`409`). Category PATCH is deliberately last-write-wins without `If-Match`. Ordering uses gapped `sortOrder` values, so moving a category is one PATCH of one row. There is no delete in A.
**Consequences:** Milestone D (generation) must insert the keyword-dictionary step between the household override and `Other`. A13's final report flags this. The milestone plan should carry the item.
**Still to verify:** dictionary coverage and its key normalization once the ingredient dictionary replaces the Milestone A lowercase+trim key.
