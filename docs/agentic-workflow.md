# Agentic workflow for Claude Code (VS Code)

How to run Milestone A with Claude Code at low cost and low risk. Everything referenced here is in the repository: `.claude/settings.json`, `.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `scripts/`.

## 1. Principles
1. **You are the orchestrator.** One task card per session; `/clear` between cards. Sessions that carry several cards get expensive and confused.
2. **Cheapest model that is reliable for the work.** Sonnet is the default workhorse; Opus only where a mistake is costly (security, concurrency, contracts); Haiku for reading, running and summarising.
3. **Keep big text out of the main session.** Agents return short reports. Documents are read by section (`scripts/doc-section.sh`, `scripts/req.sh`), never whole.
4. **Deterministic things are hooks and scripts, not prompts.** Formatting, frozen-document protection and migration protection cost no tokens.
5. **Fail fast.** If a fix fails twice, the agent stops and reports; you decide. No long debugging loops.

## 2. Agents (`.claude/agents/`)
| Agent | Model | Tools | Use for |
|---|---|---|---|
| `spec-lookup` | Haiku | read-only | "Where/what do the docs say about X"; extracts exact requirement text |
| `test-runner` | Haiku | read + Bash | Runs `pnpm check`/tests/E2E, returns a failure summary only |
| `doc-auditor` | Haiku | read + Bash | AC traceability, schema vs design, rule-path drift, stale references |
| `domain-engineer` | Sonnet | edit | `packages/domain` (A05) |
| `backend-engineer` | Sonnet | edit | Regular server modules (A06, A08, A09, A10, A17) |
| `frontend-engineer` | Sonnet | edit | Web UI from wireframes (A11, A12, A15) |
| `test-engineer` | Sonnet | edit | Playwright/integration/golden tests (A16) |
| `code-reviewer` | Sonnet | read-only | Diff review against rules and the card, after every card |
| `critical-engineer` | Opus | edit | Optional delegate for strong cards when the main session stays on Sonnet |
| `security-reviewer` | Opus | read-only | Adversarial review after strong cards and before go-live |

Model aliases (`haiku`, `sonnet`, `opus`) follow the latest version of each tier. To pin versions for reproducible cost and behaviour, replace them with full IDs (for example `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`). I deliberately did not use the top Mythos/Fable tier: nothing in Milestone A needs it.

## 3. Commands (`.claude/commands/`)
| Command | Runs on | What it does |
|---|---|---|
| `/task A09` | Sonnet | Implements a regular card: reads named sections, plans if more than two files, tests, `test-runner`, `code-reviewer` |
| `/task-strong A07` | Opus | Same for strong cards, with invariants-first, then `security-reviewer` + `code-reviewer` in parallel |
| `/review [card]` | Sonnet | `code-reviewer` on the current diff |
| `/review-strong [card]` | Sonnet (delegates to Opus) | `security-reviewer` + `code-reviewer` on the diff, merged list |
| `/adr 2 drizzle-spike` | Sonnet | Writes a short ADR addendum from evidence |
| `/status` | Haiku | Which cards look done, what can start next |
| `/audit [check]` | Haiku | Runs `doc-auditor` |

A command's `model:` setting applies while it runs, so `/task` stays cheap and `/task-strong` is the only path that spends Opus tokens on implementation.

## 4. Card to command matrix (Milestone A)
| Card | Command | Reviewers | Notes |
|---|---|---|---|
| A00 repo scaffold | `/task` | `code-reviewer` | Verify rule-file globs match (`/context`) |
| A01 Drizzle spike | `/task` | `code-reviewer` | Output: ADR-002 addendum via `/adr` |
| A02 search spike | `/task` | `code-reviewer` | Needs your real recipes in `tests/fixtures/recipes/` |
| A03 Authelia spike | `/task-strong` | `/review-strong` | You drive; agent assists. Evidence, not production code |
| A04 contracts and schema | `/task-strong` | `/review-strong` + **your review** | The one human gate before everything else |
| A05 domain | `/task` (or `domain-engineer`) | `code-reviewer` | Highly parallel with spikes |
| A06 platform | `/task` | `code-reviewer` | |
| A07 auth | `/task-strong` | `/review-strong` | |
| A08 households | `/task` | `code-reviewer` | |
| A09 recipes API | `/task` | `code-reviewer` | |
| A10 recipe search | `/task` | `code-reviewer` | Golden set must pass |
| A11 web shell | `/task` | `code-reviewer` | |
| A12 web recipes | `/task` | `code-reviewer` | |
| A13 shopping API | `/task-strong` | `/review-strong` | |
| A14 SSE | `/task-strong` | `/review-strong` | |
| A15 web shopping | `/task` | `code-reviewer` | Check on a real phone |
| A16 E2E suite | `/task` (or `test-engineer`) | `code-reviewer` | Then `/audit traceability` |
| A17 export/seed | `/task` | `code-reviewer` | Confirm placement with the owner first |
| A18 backup/restore | `/task` | `code-reviewer` | You run the real restore rehearsal |
| A19 go-live | `/task-strong` | `/review-strong` | Then `/audit` and the exit test |

Run `/audit` after A04, after A16 and before go-live; it is cheap.

## 5. A session, step by step
1. `git switch -c a09-recipes-api` (one branch per card).
2. `/clear`, then `/task A09`. Approve or amend the plan it presents.
3. Watch for scope creep. Anything not on the card is listed at the end, not fixed.
4. Read the final summary and the reviewer findings; run the app yourself for UI cards.
5. Commit (agents never commit or push), merge, then `/clear`.
6. Add a line to your friction list if something felt wrong. Tune rules only from observed mistakes.

## 6. Parallel lanes
After A00: A01, A02, A03 and A05 are independent. After A04: auth lane (A06, A07, A08), recipe lane (A09, A10, A12), shopping lane (A13, A14, A15). Use one `git worktree` and one Claude Code session per lane so branches do not collide. Merge in dependency order and re-run `pnpm check` after each merge. Do not start any card after A04 until you have reviewed A04's schema and contracts.

## 7. Cost controls
- Default model is `sonnet` (set in `settings.json`); strong cards switch via the command, not by leaving Opus on.
- Path-scoped rules load only when matching files are touched; keep `CLAUDE.md` short.
- Use `/context` and `/cost` after your first two cards. If a card cost far more than its size suggests, find out why (long logs? whole documents read? retry loops?) before the next one.
- Never ask an agent to "review the whole repo". Review diffs.
- Prefer `test-runner` (Haiku) over running tests in the main session. Prefer `spec-lookup` over wandering through docs.
- Plan mode / plan approval before multi-file work is cheaper than undoing a wrong approach.
- Do not use Opus for CRUD, UI or tests. Do use it for contracts, auth, concurrency and the pre-go-live review.
- I can't promise a specific saving; measure with `/cost` on real cards and adjust the matrix.

## 8. Setup checklist
1. Unzip into the repository root. `chmod +x scripts/*.sh .claude/hooks/*.sh`.
2. Install `jq` (hooks parse JSON with it). Hooks and scripts are bash: on Windows run VS Code with WSL (or Git Bash) so they work.
3. Run `/agents` and confirm all ten agents appear with the intended models; run `/hooks` and confirm the two hooks; run `/help` and confirm the seven commands.
4. Check hooks work: ask Claude to edit `docs/technical-architecture.md` (must be blocked) and to create `.env` (must be blocked).
5. Commit `.claude/settings.json`, agents, commands, hooks and scripts. Put personal overrides in `.claude/settings.local.json` (gitignored).
6. `permissions.defaultMode` is `acceptEdits`: edits are auto-approved, guarded by the hooks and git. Change to `default` if you prefer per-edit prompts.

## 9. Assumptions to verify against your Claude Code version
These files follow the current documentation, but versions differ. If one of these fails, the fix is local to one file:
- Subagent frontmatter fields `tools`, `model` and `maxTurns` (remove `maxTurns` if your version rejects it).
- Command frontmatter `model`, `allowed-tools` and the inline `!` command syntax.
- Permission rule syntax `Bash(cmd:*)` (newer versions may also accept a space form).
- Rules `paths:` frontmatter (see the note in `CLAUDE.md`).

## 10. After the first week
Delete any agent you did not use, tighten descriptions of the ones Claude never delegates to, and move any rule that was repeatedly violated into a hook.
