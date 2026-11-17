# ADR-009 — Encrypted off-host backups with restore tests

**Status:** Accepted · **Cards/milestone:** A18 · **Baseline:** tech §16 (frozen)

## Decision
Nightly `pg_dump` plus uploads and Authelia config/data to an encrypted off-host target with daily/weekly/monthly retention. RPO 24 h, RTO a few hours. A scripted restore into a scratch environment with a smoke test is run on a schedule. Secrets are kept separately in a password manager.

## Guardrails
- The backup tool and target are chosen in card A18.

## Read more
Spec NFR-04, AC-12; tech §13; DB §13

Spike results and amendments go in an *Addendum* section below, never by editing the frozen documents.

## Addendum (A18): tool and scope
- **Tool and target:** the owner's existing restic job (cron, encrypted, off-host, own retention) is the backup tool. Mise does not configure restic. Mise provides a pre-backup dump script, a restore drill and copy-only monitoring files (`infra/backup/`, `infra/monitoring/`, `docs/runbooks/restore.md`).
- **Consistency:** `pg_dump` custom format for the Mise and Authelia databases (Authelia keeps its state in Postgres), run as a non-superuser read role. Raw Postgres data directories are not backed up. Authelia secrets (`storage-encryption-key`) and config are in the restic scope checklist.
- **Monitoring:** node_exporter textfile metrics from the dump script and blackbox probes on `/api/v1/health/ready` and Authelia `/api/health`; staleness alert at 26 h.
- **Not yet done:** the drill on the production host from a real restic snapshot (before A19 go-live); attachments (Milestone B).
