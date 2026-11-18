# B06: AI provider, adapter, usage and budgets

**Depends on:** B03 · **Size:** L · **Model tier:** Strong · **Autonomy:** auto

## Covers
ADR-008, technical sections 8 and 9.3, NFR-07, AC-10.

## Goal
A provider-neutral AI layer with enforced cost limits, fully testable without a real key.

## Do
- Interfaces `generateStructured`, `runToolTurn`, `extractFromImage`; the OpenAI adapter is the only place that imports the `openai` package.
- A fake provider with scripted responses and failure modes, used by all tests.
- Budget service: per-request, daily and monthly limits (defaults in `plan.md`), checked before each call, hard stop with a typed error; one usage record per call including failures; cost estimated from the pricing config.
- AI disabled by config or missing key: the layer reports unavailable and the rest of the app is unaffected.
- Versioned prompt files location and loader.

## Not in scope
Importer prompts (B07).

## Done when
Tests cover each limit, concurrent calls near the limit, failed calls recorded, AI-off behaviour, and a check that no other package imports the vendor SDK.

## Security review
Yes.
