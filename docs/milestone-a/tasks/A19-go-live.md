# A19 — Deployment, hardening and go-live

**Depends on:** A00–A18 · **Size:** L · **Model tier:** Strong
**Covers:** NFR-01, AC-11, Milestone A exit test
**Read only:** tech §3, §12; spec NFR-01, AC-11; ADR-012; docs/runbooks/

## Goal
Put it on the internet safely and use it.

## Do
- Production `infra/compose.yaml` and the Authelia stack; LAN-only upstream ports firewalled to the proxy host.
- `infra/nginx/mise.example.conf`: TLS, proxy headers, SSE buffering off, rate limits.
- Verify security headers and log redaction; dependency update automation.
- Walk the threat-model checklist; run the lost-device drill; run AC-11 through the public HTTPS path.
- Go-live checklist in `docs/runbooks/`.

## Not in scope
- New features.

## Done when
- Both of you pass the Milestone A exit test on your phones. Start the friction list for B–D.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
