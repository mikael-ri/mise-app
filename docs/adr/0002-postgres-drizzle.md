# ADR-002 — PostgreSQL with Drizzle ORM and Drizzle Kit

**Status:** Accepted; validation spike · **Cards/milestone:** A01 · **Baseline:** tech §16 (frozen)

## Decision
PostgreSQL is the only datastore. Drizzle ORM + Drizzle Kit own schema and migrations, with explicit hand-written SQL for extensions, generated or trigger-maintained search columns, partial and trigram indexes, triggers and composite foreign keys.

## Guardrails
- The Prisma/Kysely comparison is closed unless the spike finds a material blocker (then write a new ADR).
- Spike A01 must record: enum strategy, search-column strategy, drift-check command.

## Read more
Tech §5, §16.1 item 1; DB §10, §12

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
