# A11 — Web shell, i18n and auth UI

**Depends on:** A07 · **Size:** M · **Model tier:** Regular
**Covers:** FR-30, NFR-05; AC-18 (English UI, translation-ready)
**Read only:** tech §2 (UI); spec NFR-05; rules web.md; `docs/ui/conventions.md`, `docs/ui/auth-and-devices.md`

## Goal
The app frame and the sign-in and device screens.

## Do
- Layout shell, router, server-state layer, generated API client from the contracts, i18n setup with extractable keys.
- Auth flow: redirect to sign-in, post-login landing, expired-session handling.
- Devices screen: list, current-device marker, revoke.
- Shared loading, empty, error and conflict states.
- Choose and record the component library and the server-state library.

## Not in scope
- Recipe and shopping screens.

## Done when
- Sign-in, sign-out and revoke work from the UI; a lint rule or test flags hard-coded strings; accessibility check on the shell.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
