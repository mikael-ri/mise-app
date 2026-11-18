# B10: Web import flow

**Depends on:** B08, B02 · **Size:** L · **Model tier:** Regular · **Autonomy:** auto

## Goal
The import experience in `docs/ui/import.md`.

## Do
- Entry with URL, text and photo modes; progress with cancel; review screen with flagged uncertainties, duplicate banner and explicit Save or Discard; failure states and drafts list.
- Photo capture or pick on mobile; clear message for HEIC.
- Accessible and keyboard usable. All user-visible text goes through the existing i18n with keys in `en.json` only; there is no `fi.json` yet (backlog: translated UI), so do not add one and do not hard-code strings.

## Done when
Component tests for each state; an e2e test (AC-01) importing from pasted text with the fake provider configured by the test server.
