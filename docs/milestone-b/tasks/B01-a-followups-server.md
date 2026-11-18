# B01: Milestone A follow-ups, server

**Depends on:** B00 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Covers
Open items from Milestone A reviews. Contract changes here are authorised for exactly the fields below.

## Goal
The web app can show member names, tag choices and list counts without extra requests, and sign-in is smoother.

## Do
- `GET /api/v1/household/members`: id and display name of the household's members.
- `GET /api/v1/tags`: tags in use with counts.
- Add yield and time fields to `RecipeSummary`; add item count and picked count to `ShoppingList`.
- Redirect to `/login?error=not_provisioned` when the OIDC user has no household member.
- Store a device label derived from the User-Agent on session creation.
- Revoke the previous session of the same device on re-login.
- Update contract tests and OpenAPI/Zod schemas accordingly.

## Not in scope
Any web change (B02), any schema migration.

## Done when
Contract and integration tests cover each item; `pnpm check` passes; report lists any contract-shape decisions.
