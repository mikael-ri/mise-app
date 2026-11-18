# Milestone B: import, provenance, cooking history and ratings

Scope (spec section 11): URL, text and image importer with explicit review, source provenance, cooking events and individual ratings.
Requirements: FR-02, FR-04, FR-10 to FR-14, FR-31, NFR-02 (SSRF), NFR-07 (cost), NFR-08, NFR-10. Acceptance: AC-01, AC-10, AC-12, AC-13.
Decisions: ADR-006 (images transient, EXIF stripped, resized), ADR-008 (provider-neutral AI, OpenAI only). Technical: section 8 (importer), 9.3 (usage and budgets). Database: section 14 (B tables), 5.4 (rating aggregation).

**Gate:** importer AI does not go live until the budget hard-stop and the importer safety and cost tests pass (B06, B12) and B13 is signed off by the owner.

## Cards

| Card | Title | Tier | Size | Autonomy | Depends on |
|---|---|---|---|---|---|
| B00 | Setup and approvals | n/a | S | human | none |
| B01 | Milestone A follow-ups, server | Regular | M | auto | B00 |
| B02 | Milestone A follow-ups, web | Regular | M | auto | B01 |
| B03 | Contracts, schema, migration 0002 | Strong | L | auto, human merge gate | B00 |
| B04 | Guarded URL fetcher | Strong | M | auto | B00 |
| B05 | Image preprocessing and upload validation | Regular | M | auto | B00 |
| B06 | AI provider, adapter, usage and budgets | Strong | L | auto | B03 |
| B07 | Extraction pipelines | Regular | L | auto | B04, B05, B06 |
| B08 | Import drafts API and confirm | Strong | L | auto | B03, B07 |
| B09 | Cooking events and ratings API | Regular | M | auto | B03, B01 |
| B10 | Web import flow | Regular | L | auto | B08, B02 |
| B11 | Web cooking history, ratings, filters | Regular | M | auto | B09, B02 |
| B12 | Safety, cost and acceptance suite | Regular | M | auto | B08, B09 |
| B13 | Real-provider calibration and gate sign-off | n/a | M | human | B12 |
| B14 | Assets backup, ops and release | Regular | M | supervised | B13 |

## Waves

- **Night 1.** Lane A: B03, B04, B05. Lane B: B01, B02. Morning: review and merge both PRs; B03 gets a careful read of schema and contracts.
- **Night 2.** Lane A: B06, B07, B08. Lane B: B09, B11. Morning: merge.
- **Night 3.** B10, then B12.
- **Day 4.** B13 (you, with a real key and your phone), then B14 supervised.

One lane is one branch and one PR with a commit per card. Lanes run in separate clones. A lane stops at the first card that fails verification, so cards later in a lane are not started on broken ground.

## Decisions

1. **Dependency allowlist** pre-installed in B00: `openai` (adapter only), `cheerio`, `sharp`, `@fastify/multipart`, `file-type`. Agents may not add others.
2. **AI budgets**: EUR 4 per request, EUR 10 per day, EUR 50 per month, hard stop, configurable.
3. **Images**: transient by default; keeping the photo is an explicit choice on the review screen (default off). Import drafts expire after 7 days.
4. **HEIC** is rejected on the server with a clear message; JPEG, PNG and WebP are accepted. Phones usually convert on upload.
5. **Duplicates**: warn only, never block. Exact normalized URL match, or pg_trgm title similarity at 0.6 or higher.
6. **Rating aggregation**: household average, with a member filter. Unrated is not zero.
7. **Cooking event**: "tested" checkbox defaults on when you record one.
8. **No egress proxy** in this milestone; the residual risk is documented in `docs/agentic-autonomy.md` and the importer's fetcher is the only outbound path for user URLs.
9. **Language**: source language and units are preserved verbatim.

## Closed for agents

Agents must not reopen these. If a card cannot be done within them, it stops with BLOCKED and says why.