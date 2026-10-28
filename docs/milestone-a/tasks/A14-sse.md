# A14 — SSE live updates

**Depends on:** A07, A13 · **Size:** M · **Model tier:** Strong
**Covers:** FR-37, NFR-09; AC-08
**Read only:** tech §11; DB §8.2; ADR-004; rules server.md

## Goal
Live list updates that survive reconnects and revocation.

## Do
- `GET /shopping-lists/:id/events`: authorize on subscribe, send `{listId, seq}` only, heartbeat, `X-Accel-Buffering: no`.
- In-process broadcast strictly after commit; nothing on rollback.
- Resync on gap or reconnect via the REST snapshot with `change_seq`.
- Close streams on session revocation or expiry.

## Not in scope
- WebSocket, outbox, multi-instance support, offline queue.

## Done when
- Integration tests: event after commit, none on rollback, revoked session closes the stream, reconnect receives a fresh snapshot; two simultaneous clients converge.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
