# ADR-007 — Hybrid nutrition and portion engine

**Status:** Accepted; method/data validation · **Cards/milestone:** Milestone C · **Baseline:** tech §16 (frozen)

## Decision
Daily energy targets are computed in code from profile, activity and goal using a published adult equation, with a conservative floor and a cap on rate of change that the model cannot override. Recipe nutrition is estimated once per recipe version from Fineli-preferred ingredient data, cached with provenance and coverage, with manual override and visible uncertainty. Portions are arithmetic on cached values.

## Guardrails
- The LLM receives derived targets and restrictions, never raw age or weight.
- Formula, safety parameters and Fineli licence/format are validated before Milestone C ships; not a blocker for migration 0001.

## Read more
Spec FR-29, NFR-03; tech §7, §16.1 item 6; DB §6

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
