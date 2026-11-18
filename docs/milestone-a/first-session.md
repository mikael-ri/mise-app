# First session script: from empty repository to a green A00

Goal: prove the whole toolchain (agents, commands, hooks, rules, CI) on the cheapest card before spending anything on real work. Plan on one sitting. Nothing here needs Opus.

## Part 1: Prepare the repository (you, no Claude)

1. Create the repository and unzip the package into its root:
   ```bash
   mkdir mise && cd mise && git init
   unzip ../mise-baseline.zip
   chmod +x scripts/*.sh .claude/hooks/*.sh
   ```
2. Install prerequisites: Node (current LTS), `pnpm`, Docker (for the dev PostgreSQL), `jq`, and the Claude Code extension. On Windows, open the folder in VS Code through WSL; the hooks and scripts are bash.
3. Make the baseline the first commit, so `git log` works and the guard hook has history to compare against:
   ```bash
   git add -A && git commit -m "docs: baseline documents and Claude Code configuration"
   git switch -c a00-repo-scaffold
   ```
4. Sanity-check the scripts yourself:
   ```bash
   ./scripts/doc-section.sh tech 16.1 | head -3
   ./scripts/req.sh FR-38
   ```

## Part 2: Verify Claude Code picked everything up (5 checks)

Open the folder in VS Code, start a Claude Code session, and run:

| # | Run | Expect | If not |
|---|---|---|---|
| 1 | `/agents` | Ten agents; `spec-lookup`, `test-runner`, `doc-auditor` on Haiku; `critical-engineer`, `security-reviewer` on Opus; the rest Sonnet | Reload the window; check the frontmatter of the missing file; remove `maxTurns` if rejected |
| 2 | `/help` | `task`, `task-strong`, `review`, `review-strong`, `adr`, `status`, `audit` listed | Check `.claude/commands/` is at the repo root |
| 3 | `/hooks` | A `PreToolUse` and a `PostToolUse` hook | Check `.claude/settings.json` is valid and `jq` is installed |
| 4 | Ask: "Add a blank line to the end of docs/technical-architecture.md" | Blocked with "frozen baseline" | Hook not running: make scripts executable, confirm `jq` on PATH |
| 5 | Ask: "Create a file called .env containing FOO=1" | Blocked | Same as above |

Also run `/status`. It should say no cards look done and A00 can start. (That is a Haiku call; if it costs noticeably more than a trivial amount, something is wrong with the model setting.)

Do not continue until checks 4 and 5 are blocked. They are your protection against agents editing the baselines or writing secrets.

## Part 3: Run the card

1. `/clear`, then type: `/task A00`
2. **Expect first:** the card is echoed, dependencies are "none", then a short plan listing files and tests, then a pause for your approval. A00 touches many files, so it must wait for approval. If it starts writing without a plan, stop it and say "present the plan first".
3. **Review the plan against this checklist before approving:**
   - Folders match `docs/repository-structure.md` and only Milestone A folders are created.
   - Only the toolchain is scaffolded: Fastify with health endpoints, a Vite page with one i18n string, Compose for PostgreSQL, Vitest and Playwright with one trivial test each, root scripts, CI. No schema, no auth, no domain code.
   - Dependencies are listed with a reason each; reject anything exotic.
   - Scripts named exactly `check`, `dev`, `test`, `e2e`, `db:generate`, `db:migrate` (CLAUDE.md and the permissions allowlist assume these names).
4. Approve (or amend) and let it work. You do not need to watch. Dependency installs (`pnpm add`) will prompt you; that is intended.
5. **Expect during the run:** it delegates `pnpm check` to `test-runner` (Haiku) and reports only a summary; it runs `code-reviewer` (Sonnet) at the end. Edits to `.md`/`.ts` files are formatted automatically by the hook once Prettier is installed.
6. **Expect at the end:** a summary under 15 lines with what changed, test results, open questions and a suggested commit message. It must not have committed anything.

## Part 4: Verify the result yourself

```bash
pnpm install --frozen-lockfile
pnpm check          # typecheck + lint + unit tests: green
docker compose -f infra/compose.dev.yaml up -d
pnpm dev            # web and API start
curl -s localhost:<api-port>/api/v1/health/ready    # use your browser if you prefer
```

Then check each of these:
- [ ] `pnpm check` green, and the CI workflow file runs the same command.
- [ ] The web page renders and its text comes from an i18n key (grep for the key; no hard-coded string).
- [ ] Health endpoints respond; `ready` reflects database connectivity.
- [ ] `pnpm e2e` runs the one trivial Playwright test.
- [ ] Open a file in each area (`packages/domain`, `apps/server`, `apps/web`, `database`) and run `/context`: the matching rule file should appear. If a rule does not load, change `paths:` to `globs:` in the rule files (some versions use the other key), then retest.
- [ ] `.gitignore` covers `.env*` (not `.env.example`), `node_modules`, build output and `.claude/settings.local.json`.
- [ ] `git status` shows only the scaffold; no stray files, no edits to the three frozen documents.

## Part 5: Close the card

1. Read the `code-reviewer` findings in the summary. Fix blocking items by asking the same session, or note them for the next card.
2. Commit yourself, then merge:
   ```bash
   git add -A && git commit -m "scaffold: pnpm workspace, health endpoints, CI skeleton"
   git switch main && git merge a00-repo-scaffold
   ```
3. `/clear`. Run `/cost` and note the figure for A00. This is your baseline for deciding whether the model matrix is right.
4. Write down friction in a `FRICTION.md` (anything slow, noisy, or wrong). Examples: plan too long, agent asked too many questions, a hook annoyed you.

## Part 6: What to do next

- Start the three independent spikes in separate branches (and, if you like, separate worktrees): `/task A01`, `/task A02`, and `/task-strong A03`. A02 needs your real recipes in `tests/fixtures/recipes/` first; collect those now.
- Start `/task A05` (domain package) any time; it depends only on A00.
- Nothing after A04 starts until you have reviewed A04's schema and contracts yourself.

## Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| `/task A00` says the card was not printed | Wrong working directory, or card file missing | Open VS Code at the repo root; confirm `docs/milestone-a/tasks/A00-*.md` exists |
| Command prompts for permission on every `cat` or script | Allowlist syntax differs in your version | Run the command once and choose "always allow", or adjust `Bash(...)` rules in `.claude/settings.json` |
| Hooks do nothing | Scripts not executable, `jq` missing, or Windows without WSL | Part 1 steps 1-2 |
| Agent loops on a failing test | Not following the stop-after-two-failures rule | Interrupt, read the `test-runner` summary yourself, give a direct instruction |
| Agent wants to edit a frozen document | A real baseline problem | Note it as a change request; do not unblock the hook |
| Session feels expensive | Long logs or whole documents in context | Check `/context`; make sure runs go through `test-runner` and docs through the scripts |
