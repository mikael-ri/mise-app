# A13 — Shopping API

**Depends on:** A04, A06, A08 · **Size:** L · **Model tier:** Strong
**Covers:** FR-34, FR-35, FR-36, FR-39; AC-08 (server side), AC-10
**Read only:** tech §10 (Shopping), §11; DB §8 (A subset), §12; ADR-013; rules server.md

## Goal
Standalone lists with safe concurrent checkoff.

## Do
- List create, rename, archive; items add, edit, delete (user origin only in A), including non-food items.
- Categories: system defaults, `Other` fallback, editable household categories.
- Per-item `revision` with `If-Match`; `setPicked(itemId, desiredState)` idempotent with server-time last-write-wins.
- `change_seq` incremented in the same transaction as the item change.
- Persist a category override per normalized key when a user recategorizes; store the staple flag (UI comes later).

## Not in scope
- Plan import, batches, sources, reconciliation (D).

## Done when
- Tests: concurrent `setPicked` converges; an unrelated edit does not conflict; stale edit returns `409`; no dependency on AI (AC-10); household isolation.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
