---
description: Implement one Milestone A task card (regular tier, Sonnet)
argument-hint: "[card id, e.g. A09]"
allowed-tools: Bash(cat docs/milestone-a/tasks/:*), Bash(./scripts/doc-section.sh:*), Bash(./scripts/req.sh:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
model: sonnet
---
Work on task card **$1** only.

Card:
!`cat docs/milestone-a/tasks/$1-*.md`

Recent history (to see which dependency cards are done):
!`git log --oneline -15`

Procedure:
1. If the card file was not printed above, stop and ask which card is meant. If the card says **Model tier: Strong**, stop and tell me to use `/task-strong $1` instead.
2. Check the "Depends on" cards appear done in the history. If not, stop and say which are missing.
3. Read only the sections the card names, via `./scripts/doc-section.sh` and `./scripts/req.sh`. Never read a whole baseline document. For "where is X specified" questions, delegate to the `spec-lookup` agent.
4. If the work touches more than two files, present a short plan (files, tests, risks) and wait for my approval. Otherwise start.
5. Write tests first or alongside. Delegate verification to the `test-runner` agent (`pnpm check`, plus any named E2E spec) and fix only what it reports. Do not paste long logs here.
6. Do only what the card says. Note adjacent problems at the end; do not fix them. Ask before adding a dependency, changing the schema or a contract outside the card, or touching frozen documents.
7. When tests pass, run the `code-reviewer` agent on the diff and resolve "Blocking" and "Should fix" items.
8. Do not commit. Finish with: what changed, FR/AC IDs covered, test results, open questions, and a suggested commit message (`module: imperative summary`). Keep it under 15 lines.
