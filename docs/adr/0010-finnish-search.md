# ADR-010 — Finnish and English search

**Status:** Accepted; quality spike · **Cards/milestone:** A02, A10 · **Baseline:** tech §16 (frozen)

## Decision
PostgreSQL `finnish` full-text search (stemming) for inflections, `pg_trgm` for compound words and typos, and a `simple` configuration for English content. Ranking: title, then ingredients, then directions and notes. a/o and a-umlaut/o-umlaut stay distinct in the primary index; folding is only allowed in the trigram fallback.

## Guardrails
- No external search service.
- Validated against a golden set of about 30 query/recipe pairs from the owner's real recipes.

## Read more
Spec FR-02, FR-07, AC-02, AC-18; tech §5.3; DB §5.3

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
