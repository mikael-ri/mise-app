---
description: Implement one task card unattended (no questions), commit locally on the lane branch, write a report
argument-hint: "[card id, e.g. B05]"
allowed-tools: Bash(cat docs/:*), Bash(./scripts/doc-section.sh:*), Bash(./scripts/req.sh:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*)
---
You are running **unattended**, started by `scripts/overnight.sh`. Nobody can answer questions. Work on task card **$ARGUMENTS** only.

Card:
!`cat docs/milestone-*/tasks/$ARGUMENTS-*.md`

Recent history:
!`git log --oneline -15`

## Rules for this run
- Never ask a question and never wait for input. Never use `sleep`, polling, watch modes or background processes. Every command you run must finish by itself.
- Start with a clean working tree on the current branch. Do not switch branches, push, merge, rebase, tag, change git config or remotes, or run `docker`. The driver does those things.
- Do not touch `.claude/`, `.github/`, `scripts/overnight.sh`, `scripts/autonomy-*.sh`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the three frozen baseline documents or any `.env` file. Do not add or change dependencies in any `package.json`: the approved ones are already installed (see the milestone plan). If you need something else, stop with BLOCKED.
- Never read or write secrets. Tests use the fake AI provider and local fixtures only; never call a real AI API or fetch a real URL.

## Procedure
1. If the card file was not printed above, or its header says `Autonomy:` is anything but `auto`, finish with `RESULT: BLOCKED $ARGUMENTS - card missing or not marked auto`.
2. Check the cards named in "Depends on" appear in the history above or exist in the code. If one clearly does not, finish with BLOCKED and name it.
3. Read only the sections the card names, using `./scripts/doc-section.sh` and `./scripts/req.sh`. Never read a whole baseline document. Use the `spec-lookup` agent for "where is X specified".
4. Decide silently, then record. Where the card or the milestone plan gives a default, use it. Where it does not, take the most conservative choice consistent with the ADRs and note it under "Decisions taken" in the report. Stop with BLOCKED instead of deciding when the choice is hard to reverse or security relevant: a schema or contract change outside the card, a new dependency, weakening a control, or touching a frozen document.
5. Write tests first or alongside. Delegate runs to the `test-runner` agent. If one failure is still not fixed after two attempts, stop with BLOCKED and put the failure summary in the report.
6. Do only what the card says. Adjacent problems go in the report, not in the code.
7. Review: run `code-reviewer` on the diff. If the card is **Strong** or says "security review", also run `security-reviewer`. Fix every Blocking and High finding. If a Blocking finding is still open after two rounds, stop with BLOCKED.
8. Run `pnpm check` through the `test-runner` agent as the last step. It must pass.
9. Write the report to `docs/<milestone>/reports/$ARGUMENTS.md`, where `<milestone>` is the folder the card file lives in (for example `milestone-b`). Keep it under 60 lines with these headings: Summary, FR/AC covered, Decisions taken, Tests (commands and results), Reviewer findings (resolved and open), Adjacent problems, Follow-ups for the owner.
10. Commit with `git add -A` then `git commit`, after checking `git status` shows only files that belong to this card. Message format: `$ARGUMENTS: imperative summary`, then a short body. One commit, or a few if that reads better.
11. Your very last output line must be exactly one of these, with nothing after it:
   - `RESULT: DONE $ARGUMENTS`
   - `RESULT: BLOCKED $ARGUMENTS - <short reason>`
   - `RESULT: FAILED $ARGUMENTS - <short reason>`

If you stop with BLOCKED or FAILED, still write the report (what was done, what blocks it) and leave the tree as it is; the driver parks it.
