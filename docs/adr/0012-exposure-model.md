# ADR-012 — Public HTTPS without VPN

**Status:** Accepted · **Cards/milestone:** A03, A19 · **Baseline:** tech §16 (frozen)

## Decision
The app is reachable over public HTTPS through the existing nginx proxy Pi, with no VPN. Authelia runs as a separate Compose stack on the Mise host, not on the proxy Pi. App and Authelia ports are published on the host's LAN address only and firewalled to the proxy. Compensating controls: mandatory second factor, rate limiting, minimal unauthenticated surface, security headers and CSP, non-root containers, restricted egress, dependency updates, a threat-model checklist before go-live.

## Guardrails
- Consider TLS on the proxy-to-host hop.

## Read more
Spec NFR-01; tech §3, §12

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
