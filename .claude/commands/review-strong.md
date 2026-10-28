---
description: Security, concurrency and code review of the current diff (Opus security reviewer)
argument-hint: "[card id, optional]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(cat docs/milestone-a/tasks/:*)
model: sonnet
---
Run the `security-reviewer` and `code-reviewer` agents in parallel on the current uncommitted changes (or, if there are none, on the last commit). If a card id was given ($1), tell both to read `docs/milestone-a/tasks/$1-*.md` first. Merge their output into one list ordered Critical, High, Blocking, Should fix, Medium, Low, Nits, removing duplicates and keeping file:line references. Do not apply fixes until I agree.
