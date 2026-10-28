#!/usr/bin/env bash
# PreToolUse guard for Edit|Write|MultiEdit. Exit 2 = block and tell the agent why.
# Requires jq.
set -uo pipefail
input="$(cat)"
# Fail closed: without jq this guard cannot work, so refuse rather than silently allow.
command -v jq >/dev/null 2>&1 || { echo "BLOCKED: jq is not installed, so the safety guard cannot run. Install it (sudo apt install jq) and retry." >&2; exit 2; }
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
[ -n "$file" ] || exit 0
proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="${file#"$proj"/}"

block() { echo "BLOCKED: $1" >&2; exit 2; }

case "$rel" in
  docs/product-specification.md|docs/technical-architecture.md|docs/database-design.md)
    block "$rel is a frozen baseline. Do not edit it. Describe the needed change as a change request or ADR amendment in your final summary." ;;
  .env|.env.*|*/.env|*/.env.*)
    case "$rel" in *.example) ;; *) block "Never write secrets or env files. Use .env.example with names only." ;; esac ;;
  database/migrations/*)
    if [ -f "$file" ] && git -C "$proj" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
      block "$rel is a committed migration. Never edit an applied migration; add a new one."
    fi ;;
esac
exit 0