# ADR-017 — Shopping generation, merge and reconciliation

**Status:** Accepted · **Cards/milestone:** Milestone D · **Baseline:** tech §16 (frozen)

## Decision
Generated items from the same plan import with the same normalized key and compatible units combine into one row with all source links kept. User-added rows never merge with generated rows. A second plan import into the same list stays separate with an advisory link and one-tap merge. Picked and user-modified rows are never silently changed; plan changes appear as a reviewable reconciliation.

## Guardrails
- Milestone A already carries `origin`, `normalized_key`, `user_modified` and `revision` on shopping items so D needs no destructive migration.

## Read more
Spec FR-38, AC-09; tech §11.1; DB §8.1

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
