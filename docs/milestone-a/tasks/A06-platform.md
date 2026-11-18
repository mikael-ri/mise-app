# A06 — Platform foundations

**Depends on:** A04 · **Size:** M · **Model tier:** Regular
**Covers:** NFR-01 (partial), NFR-04, NFR-08
**Read only:** tech §10 (mutation controls), §12 (CSRF, headers, abuse), §13 (logging); DB §12; rules server.md, security.md

## Goal
Cross-cutting building blocks every module will use.

## Do
- Config loader (env and secret files, validated at startup).
- DB pool and a transaction helper.
- Error model `{code, message, details?, correlationId}` and global handler; correlation IDs.
- Structured logging with redaction (tokens, profile data, chat text).
- Idempotency-key service backed by `idempotency_keys` (same key + different payload is rejected).
- `Origin` check and CSRF token for cookie-authenticated mutations; security headers/CSP; rate-limit hooks.
- Request-context type carrying the actor (user, household, member).

## Not in scope
- Business logic, auth flow, any module code.

## Done when
- Unit and integration tests for each piece; no stack traces or raw DB objects reach the client.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
