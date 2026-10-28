# ADR-006 — Import images are transient by default

**Status:** Accepted with restraint · **Cards/milestone:** Milestone B · **Baseline:** tech §16 (frozen)

## Decision
Source images are discarded after extraction (extracted text is kept). Retention is opt-in. EXIF is stripped, images are resized before sending to a model, HEIC is handled. Anything retained is included in backups.

## Guardrails
- Storage keys are server-generated; files are served only through authorized routes.

## Read more
Tech §8, §13

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.
