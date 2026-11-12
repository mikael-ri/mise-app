# ADR-012 — Public HTTPS without VPN

**Status:** Accepted · **Cards/milestone:** A03, A19 · **Baseline:** tech §16 (frozen)

## Decision
The app is reachable over public HTTPS through the existing nginx proxy Pi, with no VPN. Authelia runs as a separate Compose stack on the Mise host, not on the proxy Pi. App and Authelia ports are published on the host's LAN address only and firewalled to the proxy. Compensating controls: mandatory second factor, rate limiting, minimal unauthenticated surface, security headers and CSP, non-root containers, restricted egress, dependency updates, a threat-model checklist before go-live.

## Guardrails
- Consider TLS on the proxy-to-host hop.

## Read more
Spec NFR-01; tech §3, §12

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.

## Addendum (2026-11-10): proxy and issuer behaviour (card A03)
**Evidence:** Authelia 4.39.28 behind a dev nginx, `infra/authelia/spike/probe-issuer.ts` and the issuer test in `auth.spike.ts`.
**Finding:** Through the public URL, `iss`, the token endpoint URL and the JWKS URL all use the public issuer. Calling the internal
URL directly without `X-Forwarded-*` returns **400** (fails closed). With `X-Forwarded-Proto: https` and `X-Forwarded-Host: <public host:port>`
the internal URL returns the same public issuer. A wrong host, a wrong proto, or a host without the port returns 400. The relying party
calls the internal URL for token and JWKS and validates `iss` against the public issuer. The proxy limits login routes (10 r/min, burst 10),
limits general traffic (30 r/s, burst 100, 429), leaves `/static/` unlimited (a limit broke portal assets with 503) and returns 404 for `/api/authz/`.
**Decision / change:** the proxy must send `X-Forwarded-Proto` and `X-Forwarded-Host` (with port if non-default) on the Authelia server block; Mise calls Authelia over the internal URL with the same headers.
**Consequences:** A07 configures the OIDC client with a public issuer and internal endpoints; A19 reuses `infra/authelia/nginx/`.
**Still to verify:** **pending:** the same checks on the real proxy Pi and real domains (real-host check in `infra/authelia/README.md`); TLS on the proxy-to-host hop.
**Change request:** none.
