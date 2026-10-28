# Architecture decisions (short form)

One short file per ADR. The authoritative register is technical design section 16 (frozen); these files give agents a 10-line version to load on demand instead of the whole document.

## Closed list (do not reopen without a new ADR)
Stack (001), PostgreSQL + Drizzle (002), Authelia OIDC with fresh authentication and Mise device sessions (003), SSE + REST (004), pin at approval (005), transient import images (006), hybrid nutrition (007), provider-neutral AI with OpenAI only (008), backups (009), Finnish search (010), no AI upload UI (011), public HTTPS without VPN (012), shopping concurrency (013), planner architecture (014), ingredient model (015), plan lifecycle (016), shopping merge (017).

## Index
| ADR | Title | Status | Cards |
|---|---|---|---|
| [001](0001-stack.md) | Technology stack | Accepted | A00 |
| [002](0002-postgres-drizzle.md) | PostgreSQL with Drizzle ORM and Drizzle Kit | Accepted; validation spike | A01 |
| [003](0003-authentication.md) | Authentication and device sessions | Accepted; implementation review | A03, A07 |
| [004](0004-sse-live-lists.md) | Live shopping updates over SSE + REST | Accepted | A14 |
| [005](0005-pin-version-at-approval.md) | Pin recipe version and yield at plan approval | Accepted | Milestone C |
| [006](0006-import-images.md) | Import images are transient by default | Accepted with restraint | Milestone B |
| [007](0007-nutrition-engine.md) | Hybrid nutrition and portion engine | Accepted; method/data validation | Milestone C |
| [008](0008-provider-neutral-ai.md) | Provider-independent AI integration | Accepted; controlled amendment | B, D |
| [009](0009-backup-restore.md) | Encrypted off-host backups with restore tests | Accepted | A18 |
| [010](0010-finnish-search.md) | Finnish and English search | Accepted; quality spike | A02, A10 |
| [011](0011-ai-context-documents.md) | AI context: version-controlled prompts only | Accepted | B, D |
| [012](0012-exposure-model.md) | Public HTTPS without VPN | Accepted | A03, A19 |
| [013](0013-concurrency-sync.md) | Shopping concurrency and sync scheme | Accepted | A13, A14 |
| [014](0014-planner-architecture.md) | AI planner architecture | Accepted | Milestone D |
| [015](0015-ingredient-model.md) | Ingredient, unit and category model | Accepted | A04, A05 |
| [016](0016-plan-lifecycle.md) | Plan lifecycle, calendar and leftovers | Accepted | Milestone C |
| [017](0017-shopping-merge.md) | Shopping generation, merge and reconciliation | Accepted | Milestone D |

## Addendum format (spikes and amendments)
Append to the ADR file:

```
## Addendum (YYYY-MM-DD): <topic>
**Evidence:** commands run, versions, measured results (no guesses).
**Finding:** what worked, what did not.
**Decision / change:** what is now fixed, or "no change".
**Consequences:** effects on cards or contracts.
**Still to verify:** anything not proven.
**Change request:** only if a frozen document must change (owner decides).
```

A *new* ADR uses the next number, the same sections as the existing files (Status, Decision, Guardrails, Read more) and a row in the index above.
