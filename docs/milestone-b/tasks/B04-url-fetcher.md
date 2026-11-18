# B04: Guarded URL fetcher

**Depends on:** B00 · **Size:** M · **Model tier:** Strong · **Autonomy:** auto

## Covers
NFR-02, technical section 8, `.claude/rules/importer.md`.

## Goal
A single function that fetches a user-supplied URL safely and returns bounded text.

## Do
- Use `node:http` and `node:https` with a custom `lookup` that pins the resolved address; no new HTTP dependency.
- Reject private, loopback, link-local, multicast, metadata and reserved ranges, IPv4 and IPv6, including IPv4-mapped and decimal or octal forms. Only http and https, standard ports unless allowed by config.
- Re-validate on every redirect, at most five. Limit body size, total time and content type (HTML and plain text).
- Test with a local HTTP server and DNS stubs; never fetch a real site.

## Not in scope
Parsing the page (B07).

## Done when
A corpus test covers the address forms, redirect-to-private, DNS rebinding simulation, oversized body, slow body and wrong content type.

## Security review
Yes.
