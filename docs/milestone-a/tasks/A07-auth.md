# A07 — Authentication and device sessions

**Depends on:** A03, A04, A06 · **Size:** L · **Model tier:** Strong
**Covers:** FR-30, FR-31, NFR-01, AC-11
**Read only:** tech §12 (Authentication), §10 (Auth rows); DB §3; spec NFR-01, AC-11; the ADR-003 addendum from A03

## Goal
Sign in through Authelia and hold revocable per-device sessions.

## Do
- `GET /auth/oidc/start` and `/callback`: PKCE, state, nonce, `iss`/`aud`/`exp` checks, `max_age=0`, verified `auth_time`; reject unknown subjects.
- Issue device sessions: random token of at least 256 bits, digest only stored, `__Host-` cookie, sliding and absolute expiry, `authenticated_at`.
- `GET /auth/me`, `POST /auth/logout`, `GET /auth/devices`, `DELETE /auth/devices/:sessionId`.
- Session middleware on every route; revocation checked per request; hook for closing SSE streams (used in A14).
- CLI `provision-user`: links an OIDC subject to a household member. It never creates sessions.

## Not in scope
- Passwords, registration, break-glass or any bypass session minting.

## Done when
- AC-11 tests: unauthenticated access denied; revoked device rejected immediately; stale or missing `auth_time` rejected; silent re-entry via live Authelia session fails (per A03 test strategy).
- Security checklist in `.claude/rules/security.md` walked through.

Finish with: what changed, FR/AC IDs covered, test results, open questions.

## Carry-over from A06 (platform)
- Set `request.actor` in an auth hook that runs **before** `preHandler`; A06's Origin/CSRF hooks (`platform/security.ts`) run in `preHandler` and need the actor.
- Origin/CSRF are skipped for a mutation with neither cookie nor actor. Accept **only** the `__Host-` cookie credential; any other credential (e.g. bearer header) needs its own Origin check and a test.
- Register the A06 rate-limit hook on the auth routes (`/auth/oidc/*`, `/auth/logout`); it is defined but applied nowhere yet. Keys on `request.ip`, which needs `TRUST_PROXY` set behind the proxy.
- Issue the CSRF token for a session with the A06 `issueCsrfToken` helper and return it from `GET /auth/me`.
