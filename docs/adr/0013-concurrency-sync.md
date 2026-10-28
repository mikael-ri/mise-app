# ADR-013 — Shopping concurrency and sync scheme

**Status:** Accepted · **Cards/milestone:** A13, A14 · **Baseline:** tech §16 (frozen)

## Decision
Per-item `revision` with `If-Match` for edits (409 on conflict). Checkoff is an idempotent desired-state write (`setPicked`) with server-time last-write-wins. A per-list monotonically increasing `change_seq` is a sync cursor only, incremented in the same transaction as the item change.

## Guardrails
- Unrelated item edits must never conflict.
- The 409 vs 412 convention is fixed in card A04 before OpenAPI generation.

## Read more
Tech §11; DB §8.2, §12

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
