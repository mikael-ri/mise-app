# ADR-008 — Provider-independent AI integration

**Status:** Accepted; controlled amendment · **Cards/milestone:** B, D · **Baseline:** tech §16 (frozen)

## Decision
Workflows call a Mise-owned `AiProvider` contract (`generateStructured`, `runToolTurn`, `extractFromImage`). OpenAI Responses API is the sole initial adapter. Provider and model are server configuration per workflow with capability checks. Messages, tool events, usage and errors are stored in canonical Mise shapes.

## Guardrails
- No second adapter, provider selector, failover or cross-provider state transfer in P0.
- Every AI result is revalidated with Zod; tool use is bounded; no-store options are used where the adapter supports them.
- A hard budget exists before the importer ships (Milestone B).

## Read more
Spec NFR-07, NFR-10; tech §9, §16.1 item 5; DB §9

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
