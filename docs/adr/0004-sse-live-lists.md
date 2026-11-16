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

## Addendum (2026-11-16): resync by cursor, no replay (A14)
**Evidence:** `apps/server/src/shopping/events.int.test.ts` (real PostgreSQL, real session hook) and `stream.test.ts`, via `pnpm check` plus `vitest.int.config.ts`. Tests cover: a reconnect gets the current seq first, and it equals the REST snapshot's `changeSeq`; nothing is sent on rollback, no-op or 409; list rename and archive are signalled; revocation, expiry and the `revoke-sessions` path close the stream.
**Finding:** Events carry only `{listId, seq}` and the snapshot is authoritative, so a missed event costs one refetch and is never a lost change. No per-event history is needed.
**Decision / change:**
- On every connect the server sends the current committed `{listId, seq}` as the first frame. After that it sends only a higher seq per stream: coalesced and monotonic, with no duplicates.
- `Last-Event-ID` is ignored. Missed events are never replayed. Frames still carry `id: <seq>` so EventSource has an id to send, but the server ignores it.
- Any committed change that is visible in the snapshot advances `change_seq` and is signalled: item add, checkoff, edit and delete, and list rename and archive (owner decision, A14).
- Heartbeat is 25 s (an SSE comment). Every heartbeat rechecks the device session in the database: revoked, idle or absolute expiry, inactive user, or a different household closes the stream, and so does a failed check (fails closed). An in-process revocation closes the stream at once.
- The stream never extends idle expiry. Refetches and actions are authenticated requests and count as use (owner decision).
- At most 8 open streams per device session; more get 429.
**Consequences:**
- Client rule for A15: after every (re)connect and on visibility change, compare the first frame's seq with the local snapshot's `changeSeq` and refetch `GET /shopping-lists/:id` if they differ. Then refetch whenever a higher seq arrives. The refetch returns list metadata and items.
- When the server closes the stream, EventSource reconnects. If the session is gone the reconnect gets 401, which EventSource reports only as an error, so the client must confirm with an authenticated request (for example the snapshot refetch). If that returns 401, go to the sign-in page.
- Behind the proxy, the events location needs `proxy_buffering off` and a read timeout longer than the heartbeat (`infra/authelia/nginx/mise.mydomain.com.conf`).
**Still to verify:** the client rules above (A15 Playwright two-context test with reconnect and a revoked-session redirect); SSE through the real proxy Pi (A19).
**Change request:** none.
