#!/usr/bin/env bash
# PreToolUse guard for the Bash tool: stop shell commands that write to frozen baselines or env files.
# Best-effort pattern check (the real protection is read-only file permissions, see docs/agentic-workflow.md).
# Exit 2 = block. Requires jq (fails closed without it).
set -uo pipefail
input="$(cat)"
command -v jq >/dev/null 2>&1 || { echo "BLOCKED: jq is not installed, so the safety guard cannot run. Install it (sudo apt install jq) and retry." >&2; exit 2; }
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
[ -n "$cmd" ] || exit 0

writeish='(>|sed +-i|sed +--in-place|tee |mv |cp |truncate|perl +-p?i|rm |dd |install |ed |chmod |python3? )'
frozen='(product-specification|technical-architecture|database-design)\.md'

if printf '%s' "$cmd" | grep -Eq "$frozen" && printf '%s' "$cmd" | grep -Eq "$writeish"; then
  echo "BLOCKED: this command looks like it modifies a frozen baseline document. Describe the needed change as a change request instead." >&2; exit 2
fi
envfile='(^|[ /"'"'"'])\.env($|[ "'"'"'./]|\.[A-Za-z]+)'
if printf '%s' "$cmd" | grep -Eq "$envfile" && ! printf '%s' "$cmd" | grep -Eq '\.env\.example' && printf '%s' "$cmd" | grep -Eq "$writeish"; then
  echo "BLOCKED: never write secrets or env files from the shell. Use .env.example with names only." >&2; exit 2
fi
exit 0
