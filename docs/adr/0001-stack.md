# ADR-001 — Technology stack

**Status:** Accepted · **Cards/milestone:** A00 · **Baseline:** tech §16 (frozen)

## Decision
TypeScript modular monolith in a pnpm workspace: React + Vite SPA, Fastify API, Zod contracts shared as `packages/contracts`, Vitest and Playwright. UI strings are translation keys from day one.

## Guardrails
- No heavier monorepo tooling (Nx, Turborepo) unless a measured need appears.
- No microservices, queues or caches in P0.

## Read more
Spec NFR-05; tech §2, §4

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
