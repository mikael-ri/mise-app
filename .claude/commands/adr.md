---
description: Write a short ADR addendum or new ADR from spike results
argument-hint: "[adr number or new] [topic]"
allowed-tools: Bash(ls docs/adr:*), Bash(./scripts/doc-section.sh:*)
model: sonnet
---
Create or update an ADR file for: $ARGUMENTS

1. Read `docs/adr/README.md` for the format. For an addendum, append to the existing `docs/adr/00NN-*.md` under a heading "Addendum (date): topic". For a new ADR, use the next free number and add a row to the README index.
2. Use only evidence from this session (commands run, measured results, test output). Do not invent results. If evidence is missing, list it under "Still to verify".
3. Keep it to 10-20 lines: context, finding, decision or change, consequences, and whether the frozen baseline needs a change request.
4. Never edit the three frozen documents; if they need changing, say so in a "Change request" line for the owner.
