# Mise

Private household app for two adults: shared recipe bank, meal planning, live shopping lists.
TypeScript pnpm monorepo, modular monolith, PostgreSQL. Recipes and AI chat are in Finnish; UI strings may be English.

**Current milestone: A (daily foundations).** Build only what the task card asks for. Do not build Milestone B–D features or anything marked P1.

## Commands
- `pnpm check` : typecheck + lint + unit tests. Must pass before you call a task done.
- `pnpm dev`, `pnpm test`, `pnpm e2e` (Playwright), `pnpm db:generate`, `pnpm db:migrate`
- If a script is missing or differs, say so. Do not invent commands.

## Layout (full tree and conventions: `docs/repository-structure.md`)
- `apps/server/src/<module>/`: one folder per backend module with `routes.ts`, `service.ts`, `repository.ts`, `index.ts` and tests. `platform/` is cross-cutting code, `cli/` is admin commands. Create a module only when its milestone starts.
- `apps/web/src/`: `features/<feature>/`, shared UI in `components/`, strings in `i18n/`, API/SSE clients in `lib/`.
- `packages/contracts` (Zod schemas, DTOs), `packages/domain` (pure logic, no I/O), `database/` (workspace package: `schema/`, `migrations/`, `seed/`).
- `docs/` (frozen baselines, `adr/`, `milestone-a/`, `ui/`, `api/openapi.json` generated, `runbooks/`), `infra/`, `tests/{e2e,fixtures,support}`.
- Flow: HTTP handler -> application service -> repository -> PostgreSQL. Modules import each other only via `index.ts`. UI endpoints and AI tools call the same services.

## Closed decisions (do not reopen or silently switch)
The docs in `docs/` are frozen baselines. Do not edit them to fit your code. If something blocks you, stop and propose an ADR amendment or change request.
- Stack: PostgreSQL, Drizzle ORM + Drizzle Kit, Fastify, React/Vite, Zod, Vitest, Playwright.
- Auth: self-hosted Authelia via OIDC (code + PKCE). Mise stores no passwords. Mise issues opaque, hashed, per-device, revocable sessions. Only provisioned OIDC subjects are accepted.
- Every new device session requires fresh OIDC authentication (`max_age=0` + verified `auth_time`, stored as `device_sessions.authenticated_at`). A live Authelia SSO session must never silently re-issue a revoked device. No break-glass or bypass session minting in P0.
- AI: workflows call a Mise-owned `AiProvider` contract (`generateStructured`, `runToolTurn`, `extractFromImage`), never a vendor SDK directly. OpenAI is the only adapter in P0. No provider selector, failover or second adapter. Details in `.claude/rules/ai.md`.
- Live shopping: SSE sends `{listId, seq}` only; clients refetch via REST. Per-item `revision` for edits. Checkoff is desired state (`setPicked`), never toggle. List `change_seq` is a sync cursor, not a write-conflict token.
- Recipe versions are immutable and hold cooking content only (ingredients, steps, yield). Tags, notes, archive flag are mutable on `recipes`. Plan approval pins version + yield.
- Shopping merge: only generated rows from the same plan import combine. User-added rows never merge with generated rows. Picked and user-modified rows are never silently changed.
- Search: PostgreSQL Finnish full-text + `pg_trgm` + `simple` for English. No search service.
- Not in MVP: Redis, vector DB, message broker, headless browser, MCP server, offline write queue, AI document upload / file search, provider switching UI.

## Hard rules
1. Business logic lives in application services and `packages/domain`, never in handlers or React components.
2. Authorization comes from the session only. Never trust a household ID from the client or an LLM. Every query is household-scoped.
3. Preserve original ingredient text and units. Use `numeric` in the DB and decimal/rational maths in code, never floats. Never convert count, mass and volume into each other. Never invent package sizes.
4. Validate every boundary with Zod schemas from `packages/contracts`. Do not hand-write duplicate types.
5. All user-visible strings use i18n keys.
6. Migrations are additive. Never edit an applied migration.
7. `date` for local calendar days, `timestamptz` for instants. Household timezone is Europe/Helsinki. Never derive a local date from UTC alone.
8. Retriable mutations take an `Idempotency-Key`. Never hold a DB transaction open across an external call.
9. Never log secrets, tokens, profile data, chat content or images.
10. No new dependency without stating why.

## Scope discipline
- Do only the task card. List adjacent problems at the end; do not fix them unasked.
- No speculative abstractions and no "while I'm here" refactors.
- Ask first before: adding a dependency, changing the schema outside the task, changing a contract, or renaming/deleting files across modules.

## Workflow
Cards run as `/task <id>` (Sonnet) or `/task-strong <id>` (Opus, for Strong-tier cards); see `docs/agentic-workflow.md`.
1. Read the task card (`docs/milestone-a/tasks/`) and only the sections it names, via `./scripts/doc-section.sh <spec|tech|db> <section>` and `./scripts/req.sh <FR/AC IDs>`. Never read a whole baseline document.
2. For multi-file work, present a short plan and wait for approval.
3. Write tests first or alongside. Delegate runs to the `test-runner` agent; do not paste long logs. If a fix fails twice, stop and report.
4. Run `code-reviewer` (and `security-reviewer` on Strong cards) before finishing. Never commit or push.
5. Finish with: what changed, FR/AC IDs covered, test results, open questions. Keep it short.

## Definition of done
- `pnpm check` passes and new behaviour has tests.
- Contracts and schema updated; migration generated if data changed.
- i18n keys added; no hard-coded UI text.
- No unexplained TODOs; no sensitive data in logs.

## Where things are documented (read only what the task needs, never whole documents)
- `docs/product-specification.md`: FR in section 5, acceptance criteria AC-01..18 in section 10.
- `docs/technical-architecture.md`: domain model section 5, planning invariants section 6, API section 10, shopping sync section 11, security section 12.
- `docs/database-design.md`: tables sections 3-9, integrity section 10, transactions section 12.
- `docs/adr/`: one short file per decision.
- Milestone gates (what must be validated before each milestone ships): spec section 15, technical design section 16.1, database design section 19.
- Leftovers link at **component** level (`meal_components.leftover_source_component_id`), never at slot level.
- Area-specific rules in `.claude/rules/` load automatically when you work in that area.

## Conventions
- TypeScript strict, no `any`, named exports, kebab-case filenames. TS camelCase, DB snake_case.
- Error body: `{code, message, details?, correlationId}`. Stale writes return `409`.
- Unit tests beside code (`*.test.ts`); E2E in `tests/e2e`. Test names include the FR/AC ID when one applies.
- Small commits, imperative, module prefix: `recipes: add version restore`.
