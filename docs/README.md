# Mise — document index (current baseline, 28 October 2026)

Everything in this package is current. Earlier versions are superseded and not included.

## Frozen baselines (edit only through a change request)
| File | Version | Notes |
|---|---|---|
| `product-specification.md` | v2.1 | Editorial correction applied (leftovers at component level) |
| `technical-architecture.md` | v1.1 | Editorial correction applied |
| `database-design.md` | v1.1 | Editorial correction applied |

## Planning and implementation
| File | Purpose |
|---|---|
| `repository-structure.md` | Folder layout, module shape, import rules, rule-file globs |
| `agentic-workflow.md` | Agents, commands, model per card, session routine, cost controls, setup checklist |
| `milestone-a/plan.md` | Scope, exit test, gates, card order |
| `milestone-a/tasks/A00..A19-*.md` | One card per Claude Code session |
| `milestone-a/first-session.md` | Step-by-step script for setup and the first card (A00) |
| `adr/` | Short ADR files 001-017, index, addendum format |
| `ui/` | Low-fidelity wireframes and UI conventions for Milestone A |

## Claude Code configuration (repository root)
| Path | Purpose |
|---|---|
| `CLAUDE.md` | Project memory: commands, closed decisions, hard rules, workflow |
| `.claude/rules/*.md` | Seven path-scoped rule files |
| `.claude/agents/*.md` | Ten subagents (3 Haiku, 5 Sonnet, 2 Opus) |
| `.claude/commands/*.md` | `/task`, `/task-strong`, `/review`, `/review-strong`, `/adr`, `/status`, `/audit` |
| `.claude/hooks/*.sh` | Frozen-document, secrets and committed-migration guard; formatter |
| `.claude/settings.json` | Default model, permissions, hook wiring |
| `scripts/*.sh` | `doc-section.sh`, `req.sh` |
| `tests/fixtures/` | `units.json` seed, `search-golden.json` template, `recipes/` for your real recipes |

## Still open (owner or later)
- Your 10-15 real recipes in `tests/fixtures/recipes/` (needed by A02, A05, A17).
- Wireframes for Milestones B-D, written when those start.
- Runbooks (`docs/runbooks/`) are produced by cards A03, A18 and A19.
