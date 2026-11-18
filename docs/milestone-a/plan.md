# Milestone A — Daily foundations: implementation plan

Sources: product spec section 11 and 15, technical design section 15 and 16.1, database design section 14 and 19. Repository layout: `docs/repository-structure.md`.

## Exit test (the definition of done for the milestone)
Both household members sign in through Authelia on phone and laptop, search and edit shared recipes (with version history and the servings converter), and use the same shopping list at the same time with live checkoffs. A revoked device is locked out immediately, including no silent re-entry through a live Authelia session. Everything restores from backup onto a clean environment. All of this works with AI switched off.

## Acceptance criteria covered
AC-02, AC-03, AC-08, AC-10, AC-11, AC-14, AC-18 (Finnish recipe names and search, English UI), and AC-12 for the tables that exist in A.

## In scope
- **Auth:** Authelia OIDC (code + PKCE), fresh authentication per new device session, per-device revocable sessions, device list/revoke, CLI to provision the two accounts.
- **Households:** household and member model, session-derived authorization, isolation test harness, audit and idempotency foundations.
- **Recipes:** CRUD, archive, immutable versions (cooking content only), `409` on stale edits, restore as new version, tags and notes, Finnish/English search, ephemeral servings converter, ingredient model v1 (groups, ranges, original units, scale policy).
- **Shopping:** multiple standalone lists, manual items including non-food, categories, picked state, per-item revision, list `change_seq`, SSE live sync, household ingredient settings scaffolding (staple flag, category overrides by normalized key).
- **Ops:** Compose stacks for Mise and Authelia, nginx example, backup with tested restore, hardening and go-live checklist.
- **Recipe export (JSON/Markdown):** FR-32 is P0 but is not assigned to a milestone in the documents. Proposed placement is A (card A17), because it also gives you a way to load your real recipes before the importer exists. Move it to B if you prefer.

## Out of scope for A (do not create tables, modules or UI)
Importer, assets and uploads (B). Cooking events, ratings, tested status, and the tested/rating filters from FR-02 (B). Profiles, schedules, nutrition, Fineli (C). Meal plans and the Today view (C). Any AI code, conversations, usage records (B/D). Plan-to-list import and reconciliation (D). Offline queue, cook mode, translated UI (P1). In A, a shopping item's normalized key is simply the lowercased, trimmed name; the ingredient dictionary arrives later.

## Gates (spec section 15) and where they are met
| Gate | Card | Output |
|---|---|---|
| Drizzle/PostgreSQL validation | A01 | ADR-002 addendum |
| Finnish search golden set | A02 | fixture + ADR-010 addendum |
| Authelia OIDC, fresh-auth, lost-device prototype | A03 | ADR-003 addendum, `infra/authelia/`, runbook draft |
| Ingredient and shopping-origin modelling, A API contracts, idempotency | A04 | schema, contracts, OpenAPI |

## Cards, order and dependencies
Cards are in `tasks/`. One card per Claude Code session. Tier: **S**trong model for security/concurrency/contract work, **R**egular model otherwise.

| # | Card | Depends on | Size | Tier |
|---|---|---|---|---|
| A00 | Repo scaffold and CI skeleton | none | M | R |
| A01 | Spike: Drizzle/PostgreSQL | A00 | M | R |
| A02 | Spike: Finnish/English search | A00 | M | R |
| A03 | Spike: Authelia OIDC and sessions | A00 | L | S |
| A04 | Contracts, schema, migration 0001 | A01, A02, A03 | L | S |
| A05 | Domain: quantities, units, scaling | A00 | M | R |
| A06 | Platform foundations | A04 | M | R |
| A07 | Auth and device sessions | A03, A04, A06 | L | S |
| A08 | Households and actor context | A04, A06 | S | R |
| A09 | Recipes API | A04, A05, A06, A08 | L | R |
| A10 | Recipe search | A02, A09 | M | R |
| A11 | Web shell, i18n, auth UI | A07 | M | R |
| A12 | Web recipes | A05, A09, A10, A11 | L | R |
| A13 | Shopping API | A04, A06, A08 | L | S |
| A14 | SSE live updates | A07, A13 | M | S |
| A15 | Web shopping UI | A11, A13, A14 | L | R |
| A16 | E2E acceptance suite | A07, A12, A15 | M | R |
| A17 | Recipe export and seed tooling | A09 | S | R |
| A18 | Backup and restore | A04, A03 | M | R |
| A19 | Deployment, hardening, go-live | all | L | S |

Parallel lanes once A00 is done: spikes (A01, A02, A03) and the pure domain package (A05) are independent. After A04: auth lane (A06, A07, A08), recipe lane (A09, A10, A12), shopping lane (A13, A14, A15).

## Working agreements
- Spike cards (A01–A03) end with a short addendum in `docs/adr/` and, only if they find a material blocker, a new ADR. They do not reopen frozen choices.
- Every card ends with tests, `pnpm check` green, and a short summary naming the FR/AC IDs covered.
- A04 is the review gate: nothing after it starts until the schema and contracts PR is reviewed by a human.
- UI cards (A11, A12, A15) follow the wireframes in `docs/ui/` (`conventions.md` plus one file per area). If a screen has no wireframe, keep it plain and ask.
- Keep a friction list while using the milestone; it shapes B–D.

## Open questions settled inside the cards
| Question | Settled in |
|---|---|
| Passkey and/or password + TOTP enabled; idle and absolute session lifetimes | A03 |
| E2E against real Authelia or a test identity provider | A03 |
| Enum strategy (PostgreSQL enum vs text + CHECK); search column strategy | A01, A02 |
| `409` vs `412` for stale writes | A04 |
| Decimal/rational helper | A05 |
| UI component library and server-state library | A11 |
| Backup tool and off-host target | A18 |
| Recipe export placement (A or B) | owner, before A17 |
