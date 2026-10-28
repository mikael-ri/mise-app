# A15 — Web shopping UI

**Depends on:** A11, A13, A14 · **Size:** L · **Model tier:** Regular
**Covers:** FR-34–37, FR-39, NFR-05; AC-08
**Read only:** spec FR-34–37, AC-08; rules web.md; `docs/ui/conventions.md`, `docs/ui/shopping.md`

## Goal
A shopping list that is pleasant one-handed in a shop.

## Do
- List index and list view grouped by category; sticky add-item; optional quantity, unit, note; non-food items; category edit; archive list.
- Optimistic checkoff with pending and rejected states; picked items collapse.
- SSE client with reconnect indicator and resync on visibility change.
- Touch targets of at least 44 px, high contrast, real checkbox semantics.

## Not in scope
- Plan-generated items, staple UI, offline writes.

## Done when
- Playwright two-context test for AC-08 including reconnect; manual check on a real phone.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
