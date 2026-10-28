---
description: Show Milestone A progress and the next card(s) to start
allowed-tools: Bash(git log:*), Bash(git status:*), Bash(ls:*), Bash(cat docs/milestone-a/plan.md)
model: haiku
---
Recent history:
!`git log --oneline -40`

Plan (cards, dependencies):
!`cat docs/milestone-a/plan.md`

Using only the history and plan above, list for each card A00-A19 whether it looks done (a commit message mentions its id or module), then name the cards whose dependencies are all done and which are not done yet. Mark which of those can run in parallel and which need `/task-strong`. If you cannot tell, say "unclear" rather than guessing. Max 25 lines.
