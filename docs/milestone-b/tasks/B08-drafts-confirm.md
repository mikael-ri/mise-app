# B08: Import drafts API and confirm

**Depends on:** B03, B07 · **Size:** L · **Model tier:** Strong · **Autonomy:** auto

## Covers
FR-02, FR-10 to FR-12, AC-01, AC-13, ADR-006.

## Goal
End-to-end server import: start, poll, review, confirm or discard, with provenance.

## Do
- Endpoints per the B03 contracts. Starting an import never writes to the recipe bank.
- Confirm saves the recipe, source provenance and optional photo atomically, and is idempotent by key.
- Duplicate warning: exact normalized URL, or pg_trgm title similarity at 0.6 or higher; warning only.
- Photo retention only when the draft says keep; default off. Drafts expire after 7 days with a cleanup job.
- No database transaction held across fetch or AI calls.

## Not in scope
Web UI.

## Done when
Integration tests cover happy paths for all three inputs, confirm twice, discard, expiry, duplicate warning, AI limit reached, AI off (paste still works), and household isolation.

## Security review
Yes.
