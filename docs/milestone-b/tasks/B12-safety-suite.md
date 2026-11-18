# B12: Safety, cost and acceptance suite

**Depends on:** B08, B09 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Goal
The gate tests for importer AI.

## Do
- SSRF corpus end to end through the API; prompt-injection corpus through the pipelines with the fake provider.
- Budget hard-stop end to end; AI-off acceptance (AC-10); AC-13; Finnish importer fixtures from the 15 recipe text files.
- A single `pnpm test:gate-b` script that runs these.

## Security review
Yes.

## Done when
`pnpm test:gate-b` passes and is wired into CI.
