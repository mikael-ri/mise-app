#!/usr/bin/env bash
# PostToolUse formatter for Edit|Write|MultiEdit. Never fails the session. Requires jq.
input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
[ -n "$file" ] && [ -f "$file" ] || exit 0
case "$file" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.css|*.md|*.yml|*.yaml)
    proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"
    if [ -x "$proj/node_modules/.bin/prettier" ]; then
      "$proj/node_modules/.bin/prettier" --write --log-level=silent "$file" >/dev/null 2>&1 || true
    fi ;;
esac
exit 0
