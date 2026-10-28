---
description: Implement one strong-tier task card (security, concurrency, contracts; Opus)
argument-hint: "[card id, e.g. A07]"
allowed-tools: Bash(cat docs/milestone-a/tasks/:*), Bash(./scripts/doc-section.sh:*), Bash(./scripts/req.sh:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
model: opus
---
Work on task card **$1** only. This is a high-risk card: correctness matters more than speed. Closed decisions and `.claude/rules/security.md` are not negotiable; never weaken a control to make something pass.

Card:
!`cat docs/milestone-a/tasks/$1-*.md`

Recent history:
!`git log --oneline -15`

Procedure:
1. If the card file was not printed above, stop and ask which card is meant.
2. Check the "Depends on" cards appear done in the history. If not, stop.
3. Read only the sections the card names via `./scripts/doc-section.sh` and `./scripts/req.sh`. Delegate lookups to `spec-lookup` (cheap model) instead of reading around.
4. Before coding, write five bullets: the invariants this card must preserve and how each will be tested. Present a short plan and wait for my approval.
5. Write the failing tests for those invariants first (races, revocation, stale writes, household isolation, idempotency as relevant). Then implement.
6. For spike cards (A01-A03) produce evidence and an ADR addendum in `docs/adr/` (use the format in `docs/adr/README.md`), not production code.
7. Delegate verification to the `test-runner` agent and fix only what it reports.
8. When green, run `security-reviewer` and `code-reviewer` agents in parallel on the diff. Resolve all Critical/High and Blocking findings; list Medium/Low ones.
9. Do not commit. Finish with: invariants and their tests, what changed, FR/AC covered, residual risks, open questions, suggested commit message. Keep it under 20 lines.
