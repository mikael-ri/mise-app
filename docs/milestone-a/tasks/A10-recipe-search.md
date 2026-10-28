# A10 — Recipe search

**Depends on:** A02, A09 · **Size:** M · **Model tier:** Regular
**Covers:** FR-02, FR-07; AC-02, AC-18
**Read only:** tech §5.3; DB §5.3, §11; the ADR-010 addendum from A02

## Goal
Search that works for Finnish and English content.

## Do
- `GET /recipes?q=&tags=&maxTime=` with pagination; archived excluded by default.
- Ranking title, then ingredients, then directions and notes; trigram fallback as chosen in A02.
- Run the golden set from A02 in CI against real PostgreSQL.

## Not in scope
- Tested-status and rating filters (B).

## Done when
- The golden set passes (or documented exceptions); `carrot` finds English ingredients and Finnish terms find Finnish recipes.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
