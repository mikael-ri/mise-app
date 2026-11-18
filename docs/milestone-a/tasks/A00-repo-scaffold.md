# A00 — Repo scaffold and CI skeleton

**Depends on:** none · **Size:** M · **Model tier:** Regular
**Covers:** Infrastructure only (no FR/AC)
**Read only:** tech §2 and §4; docs/repository-structure.md

## Goal
A walking skeleton that proves the toolchain end to end.

## Do
- Create the pnpm workspace exactly as in `docs/repository-structure.md` (only Milestone A folders).
- Strict TypeScript base config, ESLint, Prettier, `.editorconfig`, `.node-version`, `.env.example` (names only).
- Fastify app with `GET /api/v1/health/live` and `/health/ready`; Vite + React page that renders one i18n string.
- PostgreSQL via `infra/compose.dev.yaml`; Vitest and Playwright wired with one trivial test each.
- Root scripts: `check`, `dev`, `test`, `e2e`, `db:generate`, `db:migrate`. CI runs `pnpm check`.
- Copy the frozen docs into `docs/`; add `CLAUDE.md`, `.claude/` (rules, agents, commands, hooks, settings) and `scripts/`; make `scripts/*.sh` and `.claude/hooks/*.sh` executable.
- `.gitignore` includes `.env*` (except `.env.example`), `node_modules`, build output and `.claude/settings.local.json`.
- Verify `/agents`, `/hooks` and the seven commands load, and that editing a frozen document is blocked.

## Not in scope
- Any schema, domain code, auth or UI beyond the hello page.

## Done when
- `pnpm check` is green locally and in CI; `pnpm dev` serves web and API; health endpoints respond.
- Every `paths:` glob in `.claude/rules/*.md` matches a real folder (open a file in each area, run `/context`).

Finish with: what changed, FR/AC IDs covered, test results, open questions.
