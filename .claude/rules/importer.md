---
paths:
  - "packages/server/src/import/**"
  - "packages/server/src/ai/**"
  - "packages/server/src/assets/**"
  - "packages/shared/src/import/**"
---
# Importer and AI rules (Milestone B)

- **SSRF (NFR-02).** Every outbound fetch goes through the guarded fetcher only. Resolve DNS once, reject private, loopback, link-local, multicast and metadata ranges (IPv4 and IPv6, including IPv4-mapped), connect to the pinned IP, re-check on every redirect, limit redirects, size, time and content type. No other HTTP client for user-supplied URLs.
- **Website and image text is data, never instructions.** Prompts put it in a clearly delimited block. The model output is always parsed and revalidated with Zod; anything unparseable is a failure, not a guess.
- **Prompts are versioned** files with a version constant stored in the usage record. Do not inline prompt strings in handlers.
- **Provider neutrality (ADR-008).** The vendor SDK is imported only inside the provider adapter. Everything else uses `generateStructured`, `runToolTurn`, `extractFromImage`. Tests use the fake provider; no test calls a real API or a real URL.
- **Cost (NFR-07).** Check the budget before each AI call and hard-stop when exceeded. Write one usage record per call, including failures, with tokens, estimated cost, prompt version and purpose. With AI off or over budget the rest of the app still works (AC-10).
- **No content logging.** Never log page text, recipe text, images, prompts or model output. Log ids, sizes, durations, status and error codes.
- **Fidelity.** Keep the source language (Finnish stays Finnish) and the source units verbatim. Flag uncertain fields for review instead of inventing values. Nothing is saved to the recipe bank without explicit confirmation of the draft.
- **Atomicity.** Do not hold a database transaction open across an external call. Confirm is one transaction and is idempotent.
- **Images.** Strip EXIF, resize, validate by magic number, enforce size limits. Original uploads are transient unless the owner chose to keep the photo.
