# B07: Extraction pipelines

**Depends on:** B04, B05, B06 · **Size:** L · **Model tier:** Regular · **Autonomy:** auto

## Goal
Turn a URL, pasted text or a photo into a structured recipe draft with flagged uncertainties.

## Do
- URL: guarded fetch, then JSON-LD `Recipe` first; if missing or incomplete, readable-text extraction with `cheerio` and the AI step.
- Text: AI step directly.
- Photo: B05 preprocessing, then `extractFromImage`.
- Versioned prompts; page text delimited as data; output validated with Zod; invalid output is a typed failure.
- Preserve source language and units verbatim; mark uncertain fields.
- All tests use fixtures and the fake provider. Use the Finnish recipe fixtures where they exist.

## Not in scope
Persisting drafts (B08).

## Done when
Pipelines return the draft contract for each input kind; prompt-injection text inside a page does not change behaviour in tests; no content is logged.

## Security review
Yes.
