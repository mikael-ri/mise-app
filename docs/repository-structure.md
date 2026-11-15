# Mise — Repository structure

Proposed layout for the single private repository. It refines technical design section 4 and is the reference for the path globs in `.claude/rules/`. Folders marked *(later)* are created only when their milestone starts; do not scaffold them early.

```text
mise/
├─ CLAUDE.md
├─ .claude/
│  ├─ rules/                     # ai, database, domain, security, server, testing, web
│  ├─ agents/                    # 10 subagents with per-agent model (see docs/agentic-workflow.md)
│  ├─ commands/                  # /task, /task-strong, /review, /review-strong, /adr, /status, /audit
│  ├─ hooks/                     # guard.sh (frozen docs, secrets, committed migrations), format.sh
│  └─ settings.json              # default model, permission allowlist, hook wiring
├─ scripts/                      # doc-section.sh, req.sh (cheap doc lookup for agents)
├─ .github/workflows/ci.yml
├─ package.json                  # scripts: check, dev, test, e2e, db:generate, db:migrate
├─ pnpm-workspace.yaml           # apps/*, packages/*, database
├─ tsconfig.base.json
├─ eslint.config.js  .prettierrc  .editorconfig  .gitignore  .node-version
├─ .env.example                  # names only, never values
├─ Dockerfile  .dockerignore     # multistage: build web + server
│
├─ apps/
│  ├─ server/                    # Fastify API + SSE
│  │  ├─ package.json  tsconfig.json
│  │  └─ src/
│  │     ├─ main.ts              # process bootstrap
│  │     ├─ app.ts               # builds the Fastify instance, registers modules
│  │     ├─ platform/            # cross-cutting, no business rules
│  │     │  ├─ config/           # validated env / secret-file loading
│  │     │  ├─ db/               # pool, transaction helper
│  │     │  ├─ http/             # error handler, correlation id, CSRF/Origin, headers, rate limit
│  │     │  ├─ sse/              # connection registry, heartbeat, broadcast
│  │     │  ├─ idempotency/      # Idempotency-Key service
│  │     │  └─ logging/          # structured logs with redaction
│  │     ├─ auth/                # OIDC, device sessions, session middleware
│  │     ├─ households/          # households, members, actor context
│  │     ├─ recipes/             # recipes, versions, search
│  │     ├─ shopping/            # lists, items, categories, ingredient settings, SSE route
│  │     ├─ health/
│  │     ├─ cli/                 # admin commands (provision user, export, seed); never mints sessions
│  │     ├─ recipe-import/       # (later: B)
│  │     ├─ cooking-history/     # (later: B)
│  │     ├─ assets/              # (later: B)
│  │     ├─ profiles/            # (later: C)
│  │     ├─ schedules/           # (later: C)
│  │     ├─ meal-plans/          # (later: C)
│  │     ├─ ai/                  # (later: B/D) AiProvider contract; adapters/openai/
│  │     └─ conversations/       # (later: D)
│  └─ web/                       # React + Vite SPA
│     ├─ package.json  vite.config.ts  index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ app/                 # router, providers, layout shell
│        ├─ features/            # one folder per feature: auth, recipes, shopping, ...
│        │  └─ <feature>/        # components/, hooks/, api.ts
│        ├─ components/          # shared UI built on the chosen component library
│        ├─ i18n/                # en.json (keys), fi.json later
│        ├─ lib/                 # api client, query client, SSE client
│        └─ styles/
│
├─ packages/
│  ├─ contracts/                 # Zod schemas, DTOs, enums, error shape, OpenAPI generator
│  │  └─ src/                    # common/, auth.ts, recipes.ts, shopping.ts, ...
│  └─ domain/                    # pure logic, no I/O
│     └─ src/                    # quantity/, units/, scaling/, fractions/, calendar/ (later: C)
│
├─ database/                     # workspace package @mise/database
│  ├─ package.json  drizzle.config.ts
│  ├─ schema/                    # identity.ts, recipes.ts, shopping.ts, audit.ts, ...
│  ├─ migrations/                # Drizzle-generated SQL plus explicit hand-written SQL
│  └─ seed/
│
├─ docs/
│  ├─ product-specification.md   # frozen baseline
│  ├─ technical-architecture.md  # frozen baseline
│  ├─ database-design.md         # frozen baseline
│  ├─ repository-structure.md    # this file
│  ├─ agentic-workflow.md        # agents, commands, model per card, cost controls
│  ├─ adr/                       # one short file per ADR (001-017), plus spike addenda
│  ├─ milestone-a/               # plan.md and tasks/ (one card per session)
│  ├─ ui/                        # wireframes and UI conventions
│  ├─ api/openapi.json           # generated from contracts, committed, CI checks freshness
│  └─ runbooks/                  # restore, lost-device recovery, deployment, go-live
│
├─ infra/
│  ├─ compose.yaml               # Mise app + PostgreSQL (production-like)
│  ├─ compose.dev.yaml           # local development services
│  ├─ authelia/                  # separate Compose stack: compose.yaml, configuration.example.yml, users.example.yml
│  ├─ nginx/mise.example.conf    # TLS, SSE buffering off, proxy headers, rate limits
│  └─ backup/                    # backup and restore scripts
│
└─ tests/
   ├─ e2e/                       # Playwright specs named by AC (ac-08-shopping-sync.spec.ts)
   ├─ fixtures/                  # recipes/*.json (yours), search-golden.json (template), units.json (seed)
   └─ support/                   # two-session helpers, auth helper, test data builders
```

## Conventions

**Server modules.** Each folder under `apps/server/src/` (except `platform/`, `cli/`) follows one shape:

| File | Role |
|---|---|
| `routes.ts` | Thin handlers: parse with Zod, authenticate, call one service, map errors |
| `service.ts` | Application service, all business logic and transactions |
| `repository.ts` | All SQL for the module, always household-scoped |
| `index.ts` | The only import other modules may use (typed service interface) |
| `*.test.ts` / `*.int.test.ts` | Unit tests / integration tests against real PostgreSQL |

Other modules import a module only through its `index.ts`, never its repository.

**Household scoping (A08).** Repositories run household-owned queries through `scopedQuery` (`platform/scoped.ts`): `$1` is always the actor's household ID and the SQL must contain `household_id = $1`, or the call throws. Inserts that reference a member use `assertMemberInHousehold` plus the composite FKs on `(household_id, member_id)`. Cross-household access looks like "not found". The actor comes from `households` `resolveActor(userId)` (user from the validated session, never from client input); A07 adds the device session ID. Module tests reuse `createTwoHouseholds` (`platform/isolation-harness.ts`) to prove isolation. `households/` has no `routes.ts` yet: Milestone A defines no household endpoint (`/auth/me` is A07).

**Integration tests.** Run against the dev PostgreSQL from `infra/compose.dev.yaml`; see "Test database and roles" below. `pnpm --filter @mise/server test:int` and `pnpm --filter @mise/database test:int` need only that service to be up. Tests get the database from the shared test config (`tests/support/test-database-config.ts`), never from `DATABASE_URL`.

**Admin CLI.** `pnpm --filter @mise/server cli:provision-household --name <name> --issuer <issuer URL> --owner-subject <sub> --owner-name <name> --member-subject <sub> --member-name <name> [--timezone Europe/Helsinki]` creates the household, the two provisioned users and their memberships in one transaction. It reads only the database settings (`DATABASE_URL` or `DATABASE_URL_FILE`, via `loadDatabaseConfig`), not the rest of the server environment, and never mints sessions.

**Naming.** Files are kebab-case. TypeScript identifiers are camelCase, database columns snake_case. Test names carry the FR/AC ID when one applies. E2E specs are named after the AC they prove.

**Dependency direction.** `apps/*` may import `packages/*` and `database`. `packages/domain` imports nothing from this repository. `packages/contracts` may import `packages/domain` types only. `apps/web` never imports `apps/server` or `database`; it uses `packages/contracts` and the generated API client.

**Migrations.** The migrate command (`pnpm db:migrate`) connects as the migrator role through `MIGRATION_DATABASE_URL`; the server and CLIs use the app role through `DATABASE_URL` (ADR-018). After migrating, `pnpm --filter @mise/database db:grants` (needs `APP_DB_ROLE` and `MIGRATION_DATABASE_URL`) applies the app role's privileges. Only the current milestone's tables exist in `database/schema/`. Hand-written SQL (extensions, generated or trigger-maintained search columns, partial indexes, composite foreign keys) lives next to generated migrations and is never edited once applied.

## How the rule files map to this layout

| Rule file | `paths:` it uses |
|---|---|
| `domain.md` | `packages/domain/**` |
| `server.md` | `apps/server/**` |
| `database.md` | `database/**`, `**/*.sql`, `apps/server/src/**/repository.ts` |
| `web.md` | `apps/web/**` |
| `security.md` | `apps/server/src/auth/**`, `assets/**`, `recipe-import/**`, `ai/**`, `platform/http/**`, `infra/**` |
| `ai.md` | `apps/server/src/ai/**`, `recipe-import/**`, `conversations/**` |
| `testing.md` | `**/*.test.ts`, `**/*.test.tsx`, `tests/**` |

## Test database and roles

Integration tests (`*.int.test.ts`) run on a real PostgreSQL with the same two-role layout as production (ADR-018), so a missing grant fails a test instead of production.

**Start it.** `docker compose -f infra/compose.dev.yaml up -d` starts PostgreSQL on `127.0.0.1:5433` and runs the one-shot `db-provision` service (`infra/postgres/provision-roles.sql`, idempotent, throwaway credentials). It creates:

| Database | Owner / migrator role | App role | Used for |
|---|---|---|---|
| `mise` | `mise_migrator` (`MIGRATION_DATABASE_URL`) | `mise_app` (`DATABASE_URL`) | development data |
| `mise_test` | `mise_test_owner` (`TEST_MIGRATION_DATABASE_URL`) | `mise_test_app` (`TEST_DATABASE_URL`) | integration tests |

An existing dev volume created before the roles existed has tables owned by the bootstrap superuser: recreate it with `docker compose -f infra/compose.dev.yaml down -v`. For the dev database run `pnpm db:migrate` with `MIGRATION_DATABASE_URL` set, then `APP_DB_ROLE=mise_app pnpm --filter @mise/database db:grants`.

**How a run works.** The Vitest global setup (`database/test/global-setup.ts`) loads the config, applies the safety guard, creates the database if missing and migrates it as the owner. For the server's integration tests, `database/test/setup-reset.ts` drops and re-migrates the schema before every test file, so files never see each other's rows. This is a schema reset and not `TRUNCATE ... CASCADE` on purpose: migration 0001 puts a `BEFORE TRUNCATE` trigger on `recipe_versions`, and a cascade from `households`, members or `recipes` fires it. Tests never disable that trigger. Repository, API and service tests connect as the app role; the database package's schema tests connect as the owner.

**Safety guard.** One implementation (`assertSafeTestDatabase`, called by the global setup and by the reset): both URLs must name the same database, whose name ends in `_test` or `_test_<suffix>`, on `localhost`, `127.0.0.1` or `::1`, with different roles. Otherwise the run stops with a message that never prints the URLs.

**Parallel lanes and worktrees.** `MISE_TEST_DB_SUFFIX=a` appends `_a` to the database name (`mise_test_a`); the owner role creates it on first use. Use one suffix per lane. Two runs on the same database at the same time will reset each other.

**Overrides.** Defaults are `postgres://mise_test_app:mise_test@localhost:5433/mise_test` and `postgres://mise_test_owner:mise_test@localhost:5433/mise_test`. Set `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` to use another loopback server (CI uses port 5432). Their names are listed in `.env.example`; values are never committed.
