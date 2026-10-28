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
