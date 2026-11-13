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

## Addendum (2026-11-12): HTTP precondition and idempotency conventions (card A04)
**Evidence:** `packages/contracts/src/{errors,headers,routes}.ts`, `packages/contracts/src/http.test.ts`, `docs/api/openapi.json` (generated; `openapi.test.ts` fails when stale); `database/test/schema.int.test.ts` ("idempotency keys": scope uniqueness and a two-connection race against real PostgreSQL 17).
**Finding:** DB §12 asked for one public convention before OpenAPI generation. The idempotency race needs no "in progress" state if the key row is written in the effect's transaction: the duplicate blocks on the unique index and gets `23505` after the first commits (measured in the race test).
**Decision / change:**
- **409 vs 412.** A stale `If-Match` returns **`409 stale_revision`** with `details.currentRevision`. A missing `If-Match` on a route that requires it returns **`428 precondition_required`**. **412 is never used.**
- **ETag format.** Exactly one strong ETag `"<revision>"` (integer >= 1). Weak tags, lists and `*` are rejected as `400 validation_failed`. Responses for revisioned resources carry `ETag`. `If-Match` is required on `PATCH /recipes/:id`, `POST /recipes/:id/restore`, `PATCH /shopping-lists/:id`, `DELETE /shopping-items/:id`, and on `PATCH /shopping-items/:id` detail edits.
- **Checkoff.** `PATCH /shopping-items/:id` with body `{picked}` (desired state) needs no `If-Match` and is server-time last-write-wins. A body cannot mix `picked` with detail fields, so an unrelated revision can never reject a checkoff. `change_seq` is never accepted as a precondition.
- **`Idempotency-Key` header.** Opaque client-generated value of 16-128 chars of `[A-Za-z0-9_-]` (a UUID is recommended). It is required on `POST /recipes`, `POST /recipes/:id/restore`, `POST /shopping-lists` and `POST /shopping-lists/:id/items`; if it is missing the response is `400 idempotency_key_required`.
  - **Scope:** (household, actor member, operation), with household and member taken from the session.
  - **Hashing:** `request_hash` = SHA-256 of the canonical request (operation, path params, body).
  - **Same transaction:** the key row is inserted in the same transaction as the effect.
  - **Same key, same hash:** the stored outcome (`result_ref`: status and resource reference) is replayed, re-reading the current resource state.
  - **Same key, different hash:** `422 idempotency_key_reused`.
  - **Concurrent duplicate:** waits on the unique index, then replays.
  - **Retention:** 24 h (`expires_at`).
  - **External calls:** workflows with an external call (Milestones B and D) must not hold the transaction open across the call (hard rule 8). They need a separate design when they arrive.
- **Check order and idempotency details** (from the A04 security review):
  - **Replay comes first.** The idempotency lookup/replay runs **before** the `If-Match` check, so a lost restore response replays instead of returning 409.
  - **Key row first.** The key row is the **first** write in the effect transaction.
  - **Replay transaction.** A `23505` on it aborts that transaction, so the replay reads in a new one.
  - **Expired keys.** Expired rows are treated as absent (deleted before the insert).
  - **Canonical hash.** `request_hash` uses canonical JSON (sorted keys, no insignificant whitespace).
  - **`result_ref` contents.** `result_ref` holds only `{status, resourceType, resourceId}`, never response bodies.
- **Snapshots.** `GET /shopping-lists/:id` carries no ETag (item changes do not bump the list revision) and is served `Cache-Control: no-store`.
- **Deliberate A-scope additions to the representative endpoints in tech §10:**
  - `GET /recipes/:id/versions/:versionId` (FR-03: view a prior version)
  - `GET /shopping-categories` (FR-36: grouping)
  - `DELETE /shopping-items/:id` (FR-34: manage items, `If-Match` required)
  - `Idempotency-Key` on the four create/restore POSTs above (hard rule 8: retriable mutations; DB §12 already lists it for create recipe)
  
  The source of truth is `packages/contracts/src/routes.ts`.
**Consequences:** A06 (platform) implements the `If-Match` and `Idempotency-Key` handling, the error mapping and an expiry sweep. A09 and A13 use them. Clients send `Idempotency-Key` on every retry of the same intent and a new key for a new intent.
**Still to verify:** replay behaviour end to end (A06/A09/A13 service tests); expired-key cleanup job.
