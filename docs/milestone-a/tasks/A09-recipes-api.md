# A09 — Recipes API

**Depends on:** A04, A05, A06, A08 · **Size:** L · **Model tier:** Regular
**Covers:** FR-01, FR-03, FR-04 (edit rules), FR-05; AC-02, AC-03
**Read only:** tech §5.1–5.2; DB §5, §10, §12; spec FR-01, 03, 05; rules server.md, database.md

## Goal
Recipe lifecycle with immutable versions.

## Do
- Create, read, update (`If-Match` expected version), archive.
- A new version only when cooking content changes (ingredients, steps, yield); tags, notes and archive flag update `recipes` without a version.
- Restore creates a new version copied from an old one; list versions; get a version.
- Validate ingredient content against schema v1 (groups, ranges, original text and unit, scale policy); never invent quantities.
- `search_document` updated in the same transaction as the version; idempotent create; audit events.

## Not in scope
- Search endpoint (A10), cooking events and rating/tested filters (B).

## Done when
- Service and API tests: AC-03 (400 g to 200 g keeps the old version accessible), stale edit returns `409`, restore and archive, household isolation.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
