# ADR-009 — Encrypted off-host backups with restore tests

**Status:** Accepted · **Cards/milestone:** A18 · **Baseline:** tech §16 (frozen)

## Decision
Nightly `pg_dump` plus uploads and Authelia config/data to an encrypted off-host target with daily/weekly/monthly retention. RPO 24 h, RTO a few hours. A scripted restore into a scratch environment with a smoke test is run on a schedule. Secrets are kept separately in a password manager.

## Guardrails
- The backup tool and target are chosen in card A18.

## Read more
Spec NFR-04, AC-12; tech §13; DB §13

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
