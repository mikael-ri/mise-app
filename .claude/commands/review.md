---
description: Review the current diff against the task card and project rules (Sonnet reviewer)
argument-hint: "[card id, optional]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(cat docs/milestone-a/tasks/:*)
model: sonnet
---
Run the `code-reviewer` agent on the current uncommitted changes. If a card id was given ($1), tell it to read `docs/milestone-a/tasks/$1-*.md` first. Relay its findings unchanged and in full (they are already short). Then, if there are blocking findings, propose the minimal fixes but do not apply them until I agree.
