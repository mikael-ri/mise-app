# B02: Milestone A follow-ups, web

**Depends on:** B01 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Goal
Use the new server fields and clean up known rough edges.

## Do
- Route-level lazy loading for the main routes.
- Persist recipe-form drafts in localStorage with try/catch around every access.
- Show yield, time and counts on list cards; use member names instead of "You" and "another member".
- Replace the `waitForTimeout` in the ac-03 e2e test with a condition-based wait.
- Follow `docs/ui/conventions.md`.

## Not in scope
Import and cooking UI.

## Done when
Component tests and the existing e2e suite pass; no new `waitForTimeout` anywhere.
