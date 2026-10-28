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
