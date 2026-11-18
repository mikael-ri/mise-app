# A02 — Spike: Finnish and English search

**Depends on:** A00 · **Size:** M · **Model tier:** Regular
**Covers:** ADR-010 validation gate; FR-02, FR-07, AC-02, AC-18
**Read only:** tech §5.3; DB §5.3, §11; ADR-010

## Goal
Prove the search approach on your real recipes and fix the ranking and index design.

## Do
- Needs 10–15 of your real recipes as JSON (Finnish, some English).
- Write `tests/fixtures/search-golden.json`: about 30 query to expected-recipe pairs covering inflections (porkkana/porkkanaa/porkkanat), compounds, English words (`carrot`), typos, and a/o vs ä/ö.
- Build the `search_document` SQL: `finnish` and `simple` configurations, weights title > ingredients > directions/notes, `pg_trgm` fallback. Keep ä/ö distinct in the primary index.
- Measure results, tune, record misses.

## Not in scope
- API endpoints or UI.

## Done when
- Addendum `docs/adr/0010-addendum-search-spike.md` with final SQL, pass rate and known misses.
- Golden fixture committed and runnable against a real PostgreSQL.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
