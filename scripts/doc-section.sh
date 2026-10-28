#!/usr/bin/env bash
# Print one section of a frozen baseline document (cheap alternative to reading a whole file).
# Usage: scripts/doc-section.sh <spec|tech|db> <section>   e.g. tech 12   |   tech 16.1   |   db 8.1
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  spec) f="$root/docs/product-specification.md" ;;
  tech) f="$root/docs/technical-architecture.md" ;;
  db)   f="$root/docs/database-design.md" ;;
  *) echo "usage: $0 <spec|tech|db> <section-number>" >&2; exit 64 ;;
esac
sec="${2:-}"; [ -n "$sec" ] || { echo "missing section number" >&2; exit 64; }
awk -v sec="$sec" '
  function level(s) { match(s, /^#+/); return RLENGTH }
  /^#{1,6} / {
    if (on && level($0) <= lvl) exit
    head=$0; sub(/^#+ /, "", head)
    if (!on && (head == sec || index(head, sec ". ") == 1 || index(head, sec " ") == 1)) { on=1; lvl=level($0) }
  }
  on { print }
  END { if (!on) { print "section " sec " not found" > "/dev/stderr"; exit 1 } }
' "$f"
