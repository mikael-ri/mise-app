# ADR-004 — Live shopping updates over SSE + REST

**Status:** Accepted · **Cards/milestone:** A14 · **Baseline:** tech §16 (frozen)

## Decision
Server-Sent Events carry only `{listId, seq}`. Clients refetch the snapshot over REST. Heartbeats, proxy buffering off, `Last-Event-ID`/resync on reconnect and on visibility change. Revoking a session closes its open streams.

## Guardrails
- SSE never mutates state.
- No WebSocket, outbox or multi-instance fan-out in P0.

## Read more
Spec FR-37, NFR-09, AC-08; tech §11

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
