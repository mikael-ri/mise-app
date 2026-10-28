# ADR-014 — AI planner architecture

**Status:** Accepted · **Cards/milestone:** Milestone D · **Baseline:** tech §16 (frozen)

## Decision
The backend assembles a deterministic context pack. The model keeps a small tool set (recipe search/get and proposal operations) and plans in stages (dinners and lunches first, then snacks and sides). The server validates every ID and unit and stores proposals against a `base_plan_revision`; stale proposals are rejected.

## Read more
Tech §9; DB §9

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
