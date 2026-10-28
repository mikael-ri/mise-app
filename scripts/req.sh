#!/usr/bin/env bash
# Print requirement or acceptance-criterion lines by ID from the product specification.
# Usage: scripts/req.sh FR-38 AC-09 NFR-01
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
f="$root/docs/product-specification.md"
[ $# -gt 0 ] || { echo "usage: $0 <ID> [ID...]" >&2; exit 64; }
for id in "$@"; do
  grep -E "^(- \*\*${id}( |\*)|\| ${id} \|)" "$f" || echo "$id: not found" >&2
done
