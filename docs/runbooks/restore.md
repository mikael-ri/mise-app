# Backup and restore runbook (A18, ADR-009)

Scope: Milestone A (no attachments yet). Targets: **RPO 24 h**, **RTO a few hours**.
Off-host copies and retention are done by your existing restic job; this repo provides the Mise-specific pre-backup dump,
the restore drill and monitoring proposals. A backup is only good once a restore has been drilled (tech §13).

## 1. What the dump step does

`infra/backup/dump-databases.sh <dump-dir>` runs as the restic pre-backup hook (cron). It writes `mise.dump` and
`authelia.dump` (pg_dump custom format), verifies each with `pg_restore --list`, and replaces the previous files only on
success. It refuses to run as a superuser, logs one line per step without secrets, exits non-zero on any failure, and
writes the textfile-collector metrics.

Roles (create once; a read role, never a superuser):

```sql
-- Mise DB (as the migrator/owner): the migrator itself also works, this is the least-privilege variant.
CREATE ROLE mise_backup LOGIN PASSWORD '<from password manager>';
GRANT pg_read_all_data TO mise_backup;
-- Authelia DB: same statements, run in the authelia database via docker exec.
```

Put the Mise password in the backup user's `~/.pgpass` (mode 600) and use a URL without it. The Authelia password goes in a
file read via `AUTHELIA_DUMP_PASSWORD_FILE` (it is sent to the container on stdin, never on a command line). Example cron
wrapper (pre-hook before your restic command):

```sh
MISE_DUMP_DATABASE_URL=postgres://mise_backup@127.0.0.1:5432/mise \
AUTHELIA_DUMP_USER=mise_backup AUTHELIA_DUMP_PASSWORD_FILE=/root/.mise-backup-authelia-pw \
METRICS_FILE=/var/lib/node_exporter/textfile/mise_backup.prom \
/opt/mise/infra/backup/dump-databases.sh /var/backups/mise-dumps && restic backup ...
```

Note: the Authelia Postgres image creates its `authelia` user as a superuser, which is why the script uses a separate read role.
The dump host's `pg_dump` must be at least the Mise server's major version (Authelia is dumped inside its own container).

## 2. Checklist: what your restic scope must contain

- [ ] The dump directory (`mise.dump`, `authelia.dump`).
- [ ] `infra/authelia/.secrets/`, including `storage-encryption-key`, `session-secret`, `oidc-hmac-secret`, `oidc-jwks-rsa.pem`, `oidc-client-secret.digest`, `postgres_pw`.
- [ ] `infra/authelia/configuration.yml` and `infra/authelia/users.yml`.
- [ ] The Mise production environment file / secret files (`SESSION_SECRET`, `CSRF_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`). The plain `OIDC_CLIENT_SECRET` must match the digest in Authelia.
- [ ] The deployed git revision (tag or commit hash) so migrations and code match the dump.
- [ ] **Not** the raw Postgres data directories or Docker volumes `authelia_db`, `pgdata` (a file copy of a running database is not consistent).
- [ ] **Not** the Authelia `data/notification.txt` (one-time codes) unless you want it; it is not needed for restore.

Authelia stores its state in Postgres, so `authelia.dump` plus `storage-encryption-key` is the whole Authelia state; without
that key the restored data is unreadable. Keep a copy of `.secrets/` in your password manager too, separate from restic.

## 3. Restore drill (scratch database, no real data touched)

```sh
infra/backup/restore-drill.sh <dump-dir>      # a restored copy of the last restic snapshot's dump directory
```

It starts a throwaway Postgres container with no published port, restores both dumps, checks counts (recipes,
recipe_versions, shopping_lists, users, members, applied migrations, Authelia tables; thresholds `MIN_RECIPES`,
`MIN_LISTS`), reports orphan recipes, and removes the container. Exit code 0 and `DRILL OK` mean it passed.

Monthly drill: `restic restore latest --target /tmp/drill --include <dump-dir>`, run the script, delete `/tmp/drill`.

### Drill log

| Date       | Source                                   | Dumps (mise / authelia) | Dump + drill time | Result | RPO / RTO check                         |
| ---------- | ---------------------------------------- | ----------------------- | ----------------- | ------ | --------------------------------------- |
| 2026-11-17 | Dev stack, 19 recipes, 1 list (fixtures) | 72 KB / 144 KB          | <1 s + 3 s        | OK     | Tiny dataset: proves the mechanics only |

Still to record on the production host: one drill from a real restic snapshot, with the wall-clock time from "start
restore" to "app healthy" against the RTO (a few hours). Do this before go-live (A19).

## 4. Full restore (new host)

Not yet rehearsed on a production host; rehearse once as part of A19.

1. Install Docker, restore the restic snapshot (dumps, `.secrets/`, Authelia config, Mise env) and check out the recorded git revision.
2. Start Authelia's Postgres, then restore: `docker exec -i authelia_db pg_restore -U authelia -d authelia --clean --if-exists --no-owner < authelia.dump`. Start Authelia; check `/api/health`.
3. Create the Mise Postgres roles as in the ADR-018 notes and the "Carry-over from the database roles work" section of the A19 card (migrator, app). Create the database owned by the migrator, then
   `pg_restore -U mise_migrator -d mise --no-owner --role=mise_migrator mise.dump`, then `APP_DB_ROLE=<app role> pnpm --filter @mise/database db:grants`.
4. Start Mise. Do not run `db:migrate` before checking the restored migration state matches the git revision.
5. Run the checks below.

## 5. Check afterwards

- `GET /api/v1/health/ready` returns 200 for Mise and `/api/health` for Authelia.
- Both of you can sign in (fresh OIDC login is required; old device sessions may exist but only if they were in the dump, revoke any that are not yours: `cli:revoke-sessions`).
- Recipes list shows the expected count, one recipe opens with its versions, a shopping list opens with its items.
- Counts match the last `restore-drill.sh` output.

## Monitoring and alerts

Files are in `infra/monitoring/` (copy-only, see its README). Alerts carry `service` and `severity` labels; they land in
whichever Alertmanager receiver your routes give those labels. Fill in the receiver column for your setup.

| Alert                                                      | Fires when                                        | Lands in (your Alertmanager route) | First action                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| MiseBackupStale                                            | No successful dump for 26 h, or metric missing    | `service=mise, severity=critical`  | Run the cron wrapper by hand, read the log lines, check the cron job and DB roles |
| MiseBackupLastRunFailed                                    | Last dump run exited non-zero                     | `service=mise, severity=critical`  | The log shows the failing step; previous dumps are still intact                   |
| MiseBackupDumpShrank                                       | A dump is under half of yesterday's size          | `service=mise, severity=warning`   | Check the database is the right one and not empty before the next backup          |
| MiseDown                                                   | Blackbox `/api/v1/health/ready` fails for 3 min   | `service=mise, severity=critical`  | Check the app container, then Postgres                                            |
| AutheliaDown                                               | Blackbox `/api/health` fails for 3 min            | `service=authelia, severity=critical` | Check the authelia and authelia_db containers; Mise sign-in is down meanwhile  |
| MiseTlsCertExpiring                                        | Certificate expires in under 14 days              | `severity=warning`                 | Renew on the proxy                                                                |

Whether restic itself succeeded is covered by your existing restic monitoring; the dump alerts cover only the pre-backup step.
