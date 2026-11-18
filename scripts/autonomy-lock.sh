#!/usr/bin/env bash
# Make the guardrails read-only for unattended runs, or restore write access.
# Best effort only: it stops accidental edits. If the agent runs as the same OS user as the owner of
# these files it could still chmod them back (the autonomous settings deny chmod, but that is a rule,
# not a wall). For a real wall run the agent as a different user. See docs/agentic-autonomy.md.
#
# Usage: scripts/autonomy-lock.sh lock|unlock
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PATHS=(
  .claude
  .github
  scripts/overnight.sh
  scripts/autonomy-lock.sh
  scripts/autonomy-canary.sh
  docs/product-specification.md
  docs/technical-architecture.md
  docs/database-design.md
)

case "${1:-}" in
  lock)
    for p in "${PATHS[@]}"; do
      if [ -e "$p" ]; then chmod -R a-w "$p"; fi
    done
    echo "locked"
    ;;
  unlock)
    for p in "${PATHS[@]}"; do
      if [ -e "$p" ]; then chmod -R u+w "$p"; fi
    done
    echo "unlocked"
    ;;
  *)
    echo "usage: $0 lock|unlock" >&2
    exit 2
    ;;
esac
