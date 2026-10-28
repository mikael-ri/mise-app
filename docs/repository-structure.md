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

**Naming.** Files are kebab-case. TypeScript identifiers are camelCase, database columns snake_case. Test names carry the FR/AC ID when one applies. E2E specs are named after the AC they prove.

**Dependency direction.** `apps/*` may import `packages/*` and `database`. `packages/domain` imports nothing from this repository. `packages/contracts` may import `packages/domain` types only. `apps/web` never imports `apps/server` or `database`; it uses `packages/contracts` and the generated API client.

**Migrations.** Only the current milestone's tables exist in `database/schema/`. Hand-written SQL (extensions, generated or trigger-maintained search columns, partial indexes, composite foreign keys) lives next to generated migrations and is never edited once applied.

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
