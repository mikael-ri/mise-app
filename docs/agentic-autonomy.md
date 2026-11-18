# Running agents unattended

This extends `docs/agentic-workflow.md`. The supervised flow (`/task`, `/task-strong` in VS Code) stays as it is. This document adds `/task-auto`, which is run by `scripts/overnight.sh` and works without anyone answering questions.

## How it works

`overnight.sh` takes a lane (a list of cards) and for each card starts one headless Claude Code session (`claude -p "/task-auto B05"`) in bypass-permissions mode. The agent implements the card, tests, reviews, writes a report and commits on a lane branch `auto/<lane>-<date>`. The driver then checks the result itself instead of trusting the agent: clean tree, at least one commit, no forbidden paths, no dependency changes, and its own `pnpm check`. A card that fails is parked on a `failed/...` branch and the lane stops, so a lane only ever contains verified work. At the end the driver pushes the branch and opens one pull request (a draft if anything stopped the lane). You review and merge it in the morning.

The agent never pushes, tags, merges, uses Docker, installs dependencies or opens PRs. The driver does what must happen outside the sandbox.

## Safety layers, from the outside in

1. **A separate non-root VM.** Nothing on it you cannot lose. Firewall egress allowlist: package registries, github.com and api.anthropic.com only. No production secrets, no OpenAI key, no SSH keys to other machines. Bypass mode does not protect against prompt injection, so the machine is the real boundary.
2. **A fine-grained GitHub token** limited to this one repository, with Contents and Pull requests read/write, and no Workflows, Administration or Packages permission.
3. **GitHub rulesets on the repository.** Require a pull request and passing checks on `main`, block force-push and deletion, and restrict creating `v*` tags so an agent can never publish an image.
4. **Anthropic Console spend limit** for the key used on this VM. This is the real cap; `--budget-usd` in the driver only stops starting new cards.
5. **Claude Code settings.** `.claude/settings.autonomous.json` turns the project's "ask" rules into effective denials (headless sessions cannot ask) and adds more: no `git push/remote/config/tag/merge/rebase`, no `gh`, `docker`, `ssh`, `npm`, `npx`, `pnpm add/remove/update/dlx`, `chmod`, `chown`.
6. **The PreToolUse hook** `.claude/hooks/guard.sh` still runs in bypass mode. With `MISE_AUTONOMOUS=1` it also blocks writes to `.claude/`, `.github/`, the driver scripts and the lockfile, on top of the frozen documents, `.env*` and committed migrations.
7. **Read-only lock.** `scripts/autonomy-lock.sh` removes write permission from the guardrail files during a run. It is best effort because the agent runs as the same user. For a real wall, run the agent as a different OS user that owns nothing.
8. **Canary.** Before every night `scripts/autonomy-canary.sh` has a cheap model try four forbidden actions. If any succeeds, the night does not start.
9. **Independent verification** by the driver after each card, as above.

Known residual risk: no egress proxy inside the sandbox beyond the VM firewall, so a prompt-injected agent could in principle send repository content to an allowed host. The repository holds no secrets, which is why the VM must hold none either.

## Modes compared

| Mode | Use | Why not for overnight |
|---|---|---|
| `bypassPermissions` on an isolated VM | Used here | Needs the VM, layers above carry the safety |
| `auto` | Daytime, on your own machine | Classifier can pause or abort a run with nobody there |
| `dontAsk` | Fully allowlisted runs | Every needed command must be listed; fragile for long runs |

## One-time setup

1. Create the VM, a non-root user, install Node, pnpm, git, jq, Docker and Claude Code. Log in with a key that has a spend limit.
2. Clone the repo with the limited token. Add `.autonomy/` to `.gitignore` and commit.
3. Install this package over the repo (see `README-INSTALL.md`) and run `chmod +x scripts/*.sh .claude/hooks/*.sh`.
4. Complete card B00 (dependencies pre-installed, rulesets, spend limits).
5. Do a pilot night with one small card and `--max-hours 2`.

## Running a night

```
scripts/overnight.sh --lane a --max-hours 7 --budget-usd 25 B03 B04 B05
scripts/overnight.sh --lane b B01 B02
```

Run each inside `tmux` or `nohup` so it survives a closed terminal. Two lanes at once use separate test databases through `MISE_TEST_DB_SUFFIX`, but they must use separate clones of the repository (separate working directories). Options: `--no-push`, `--skip-canary`, `--allow-supervised`. Environment: `MODEL_STRONG` (default opus), `MODEL_REGULAR` (default sonnet), `CARD_TIMEOUT` (default 3h).

## Morning routine

1. Read `.autonomy/summary-*.md` and the PR description.
2. Read each `docs/<milestone>/reports/<card>.md`: decisions taken, open reviewer findings, follow-ups.
3. Look at the diff of cards marked Strong more carefully than the rest. Check CI is green.
4. Squash-merge, or ask for changes by starting a supervised `/task` run on the branch.
5. If a lane stopped: read the failure in the report, look at `git branch --list 'failed/*'`, and decide whether to fix the card text, answer the question, or do it supervised.

## Cost pilot

Strong cards on Opus can cost several euros each. Run the pilot night, read the real figures in the summary, then set `--budget-usd` and the Console limit to roughly twice the observed cost per night.

## Edits to existing files

**CLAUDE.md:** state that in unattended runs the agent may commit locally on the lane branch and must never push; the current milestone is B; cards live in `docs/milestone-*/tasks/`; closed decisions for B are in `docs/milestone-b/plan.md`.

**`.claude/settings.json`:** add `Bash(cat docs/:*)` to `allow` so the card loader works.

## What gets a human, always

Schema and contract cards (B03) merge only after your review. Anything touching auth, secrets, release tags and production is human or supervised. Cards that need a real API key or a phone (B13) are yours.
