---
description: Traceability, schema and rule-drift audit (cheap read-only check)
argument-hint: "[optional: traceability | schema | rules | stale]"
model: haiku
---
Run the `doc-auditor` agent. If an argument was given ($ARGUMENTS), ask it to run only that check; otherwise all checks. Show its table as returned, then one sentence on the most important gap, if any.
