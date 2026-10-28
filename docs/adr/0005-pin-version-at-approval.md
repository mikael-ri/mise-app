# ADR-005 — Pin recipe version and yield at plan approval

**Status:** Accepted · **Cards/milestone:** Milestone C · **Baseline:** tech §16 (frozen)

## Decision
Draft plan slots follow the latest recipe version. Approval pins `recipe_version_id` and target yield after revalidating against the latest version. Approved occurrences change only by explicit user choice.

## Guardrails
- Snapshot-only storage is rejected; immutable versions make pinning cheap.

## Read more
Tech §6; DB §7.1

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
