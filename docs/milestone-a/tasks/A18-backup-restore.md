# A18 — Backup and restore

**Depends on:** A04, A03 · **Size:** M · **Model tier:** Regular
**Covers:** NFR-04; AC-12 (A tables); ADR-009
**Read only:** tech §13; DB §13; spec NFR-04, AC-12

## Goal
Backups you have actually restored.

## Do
- Backup script: `pg_dump` (custom format), Mise config, Authelia config and data volume, encrypted to an off-host target; choose and record the tool; retention policy; scheduled.
- Restore script into a scratch Compose environment with a smoke test (row counts, recipe and list checks, app health).
- Runbook `docs/runbooks/restore.md`; secrets kept separately in your password manager.

## Not in scope
- Attachments (B), anything later than A tables.

## Done when
- A full restore rehearsal on a clean environment succeeds, with the date and measured time recorded against RPO 24 h and an RTO of a few hours.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
