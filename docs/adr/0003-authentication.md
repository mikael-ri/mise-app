# ADR-003 — Authentication and device sessions

**Status:** Accepted; implementation review · **Cards/milestone:** A03, A07 · **Baseline:** tech §16 (frozen)

## Decision
Self-hosted Authelia via OIDC (code + PKCE). Mise stores no passwords and keeps its own opaque, hashed, per-device, revocable sessions. Only provisioned OIDC subjects are accepted. Every new device session requires verified fresh authentication (`max_age=0` plus checked `auth_time`, stored as `authenticated_at`); a live Authelia SSO session must never silently re-issue a revoked device. Passkey (user-verified) and password + TOTP are the design options; the spike chooses what is enabled.

## Guardrails
- No break-glass or bypass session minting in P0.
- Lost-device recovery covers Mise sessions, Authelia sessions and compromised credentials/passkeys.
- Passkeys bind to Authelia's domain: fix domains early.

## Read more
Spec NFR-01, AC-11; tech §12, §16.1 item 2

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
