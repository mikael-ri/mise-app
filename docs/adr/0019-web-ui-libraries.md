# ADR-019 — Web UI libraries: Radix UI + Tailwind, TanStack Query, React Router

**Status:** Accepted (2026-11-15; chosen in card A11 as required by `docs/ui/conventions.md` §9) · **Cards:** A11, A12, A15 · **Baseline:** tech §2 (UI row, frozen)

## Decision
- **Component library:** Radix UI primitives (`dialog`, `toast`, `dropdown-menu` in A11; more, such as `tabs`, are added by the card that needs them) styled with Tailwind CSS 4 and design tokens (CSS variables, light and dark via `prefers-color-scheme`). Accessible behaviour (focus trap, focus restore, keyboard) comes from Radix; nothing is hand-rolled.
- **Server state:** `@tanstack/react-query`. All REST data goes through it; SSE (A15) only invalidates queries.
- **Router:** `react-router`. Protected routes redirect to `/signin` with a same-origin `returnTo`.
- **API client:** a thin typed `fetch` wrapper in `apps/web/src/lib/` that parses responses with `packages/contracts` Zod schemas, sends `X-CSRF-Token` on mutations, is same-origin only (no CORS), and maps `401` to the session-ended state. No code generator: the contracts already hold the schemas.
- **i18n:** in-house typed `t()` over `en.json` with `feature.screen.element` keys, ICU-style plural forms and `Intl` formatting. No i18n library in P0 (one language). A custom ESLint rule flags hard-coded UI strings in `apps/web/src`.
- **Test tooling:** `jsdom`, Testing Library, `vitest-axe`.

## Consequences
- CSP: Tailwind compiles to a static stylesheet, so `style-src 'self'` holds. Radix may set inline `style` attributes at runtime; see the A11 CSP check in `platform/security.ts`.
- Replacing a primitive later is local: components wrap Radix in `components/`.
- A11 CSP check (2026-11-15): the production build has no `<style>` tags or `style` attributes in `index.html` and `style-src 'self'` is kept (locked by a test in `security.test.ts`). Inline `style` attributes that Radix and React set at runtime go through the CSSOM (`element.style.x = ...`), which CSP does not block; only `style` attributes parsed from HTML and injected `<style>` elements are blocked. Verified in Chromium against the built app with the real CSP: the only violation is the `<style>` element that `react-remove-scroll` (used by modal Dialog and DropdownMenu) injects for scroll locking. The dialog still works; `app.css` carries a static `body:has([data-modal-overlay]) { overflow: hidden }` rule instead. The scrollbar-gap padding compensation is lost and that loss is accepted: no nonce is used (it would need server-templated HTML), and `html { scrollbar-gutter: stable; }` replaces it so the layout does not shift when the lock applies.
