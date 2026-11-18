# A17 — Recipe export and seed tooling (proposed placement)

**Depends on:** A09 · **Size:** S · **Model tier:** Regular
**Covers:** FR-32 (recipes part)
**Read only:** spec FR-32; DB §13; tech §16.2

## Goal
Portable recipes, and a way to load your real recipes before the importer exists.

## Do
- Export recipes as JSON (with version references) and as Markdown, via CLI and endpoint.
- `pnpm db:seed` loads `tests/fixtures/recipes/*.json` for development.
- CLI loader for the same JSON format (an ops tool, not the importer).

## Not in scope
- Plans, profiles, lists exports (later).

## Done when
- Export then re-load round trip test; Markdown output is readable. Confirm placement with the owner first.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
