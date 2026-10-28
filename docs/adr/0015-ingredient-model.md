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
