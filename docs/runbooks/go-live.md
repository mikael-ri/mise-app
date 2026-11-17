# Runbook: go-live (A19)

Covers NFR-01, AC-11 and the Milestone A exit test (`docs/milestone-a/plan.md`). Topology (tech §3, ADR-012):

| Where     | What                                                                               | Reachable from                    |
| --------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| Proxy Pi  | nginx, TLS for `mise.<domain>` and `auth.<domain>`                                 | Internet: 443 (80 only redirects) |
| Mise host | `infra/compose.yaml`: `mise` app (LAN `:3000`), `mise_postgres` (`127.0.0.1:5432`) | Proxy Pi only / host only         |
| Mise host | `infra/authelia/compose.yaml`: `authelia` (LAN `:9091`), `authelia_db`             | Proxy Pi only / nobody            |

Work top to bottom. Tick each box and fill the record table at the end. Steps marked **(owner)** need the real host, phones or both people.

## 1. Host files and secrets (Mise host, in the repo checkout's `infra/`)

- [ ] Authelia stack set up per `infra/authelia/README.md`, including `docker network create --internal mise_oidc`.
- [ ] `infra/.env` (Compose interpolation, never committed):
      `MISE_IMAGE_TAG=<git rev-parse --short HEAD>`, `MISE_BIND_ADDRESS=<host LAN IP>`, optional `MISE_BIND_PORT` (3000),
      `MISE_DB_BIND_PORT` (5432), `MISE_DB_SUBNET` (172.30.10.0/24).
- [ ] `cp mise.env.example mise.env`, then set the real domain, `TRUST_PROXY=<proxy Pi LAN IP>` (never `true`) and
      `OIDC_INTERNAL_URL=http://authelia:9091`.
- [ ] Secret files, alphanumeric so they need no URL escaping:
  ```sh
  install -d -m 700 .secrets
  for f in mise_csrf_secret mise_session_secret postgres_password; do openssl rand -hex 32 > .secrets/$f; done
  # OIDC client secret: the plain value matching infra/authelia/.secrets/oidc-client-secret.digest
  printf '%s' '<plain client secret>' > .secrets/mise_oidc_client_secret
  # filled in step 2, after the app role has a password:
  printf 'postgres://mise_app:%s@postgres:5432/mise' '<mise_app password>' > .secrets/mise_database_url
  chown 1000:1000 .secrets/mise_*   && chmod 400 .secrets/mise_*         # read by the app (uid 1000)
  chown 70:70 .secrets/postgres_password && chmod 400 .secrets/postgres_password   # postgres alpine uid 70
  ```
- [ ] Record the digest of the base image you built on (`docker image inspect node:24.22.3-alpine --format '{{index .RepoDigests 0}}'`) in the Record table below, so the deployed image can be rebuilt reproducibly.
- [ ] Add `infra/.env`, `infra/mise.env` and `infra/.secrets/` to the restic scope (`docs/runbooks/restore.md` section 2).

## 2. Database roles (ADR-018), migrations and grants

Never use `infra/postgres/provision-roles.sql` here (dev/CI only, published passwords).

- [ ] Build and start only Postgres: `docker compose build mise && docker compose up -d postgres`.
- [ ] Create the roles by hand. `\password` prompts, so no password reaches shell history:
  ```sql
  -- docker exec -it mise_postgres psql -U postgres -d postgres
  CREATE ROLE mise_migrator LOGIN;  \password mise_migrator
  CREATE ROLE mise_app LOGIN;       \password mise_app
  CREATE ROLE mise_backup LOGIN;    \password mise_backup
  ALTER DATABASE mise OWNER TO mise_migrator;
  REVOKE ALL ON DATABASE mise FROM PUBLIC;
  GRANT CONNECT ON DATABASE mise TO mise_app, mise_backup;
  GRANT pg_read_all_data TO mise_backup;
  ```
  Then write `.secrets/mise_database_url` (step 1) with the `mise_app` password.
- [ ] Migrate and grant from the host checkout (`pnpm install` done). The migrator URL is set only in this shell:
  ```sh
  read -rsp 'mise_migrator password: ' PW; echo
  export MIGRATION_DATABASE_URL="postgres://mise_migrator:${PW}@127.0.0.1:5432/mise"; unset PW
  pnpm db:migrate && APP_DB_ROLE=mise_app pnpm --filter @mise/database db:grants
  unset MIGRATION_DATABASE_URL
  ```
- [ ] Verify the live database matches ADR-018. Run as `postgres` in database `mise`; every query must return **zero rows**:
  ```sql
  -- a) app role is superuser, or can create roles/databases, or bypasses RLS
  SELECT rolname FROM pg_roles WHERE rolname = 'mise_app' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls);
  -- a2) the app role is a member of any other role (membership would let it SET ROLE to the owner)
  SELECT m.roleid::regrole FROM pg_auth_members m WHERE m.member = 'mise_app'::regrole;
  -- b) anything in public NOT owned by the migrator
  SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> 'mise_migrator';
  -- c) DELETE granted to the app outside the ADR-018 list
  SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'mise_app' AND privilege_type = 'DELETE'
     AND table_name NOT IN ('idempotency_keys', 'shopping_items');
  -- d) TRUNCATE, TRIGGER or REFERENCES granted to the app on any table
  SELECT table_name, privilege_type FROM information_schema.role_table_grants
   WHERE grantee = 'mise_app' AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  -- e) CREATE on the schema or the database for the app, or any database privilege left on PUBLIC
  SELECT 'schema' WHERE has_schema_privilege('mise_app', 'public', 'CREATE')
  UNION ALL SELECT 'database' WHERE has_database_privilege('mise_app', 'mise', 'CREATE')
  UNION ALL SELECT 'temp' WHERE has_database_privilege('mise_app', 'mise', 'TEMP')
  UNION ALL SELECT 'public:' || a.privilege_type FROM pg_database d, aclexplode(d.datacl) a
   WHERE d.datname = 'mise' AND a.grantee = 0;
  ```
  And this one must return exactly `idempotency_keys` and `shopping_items`:
  `SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'mise_app' AND privilege_type = 'DELETE' ORDER BY 1;`

## 3. Start the app and check the startup guards

- [ ] `docker compose up -d` then `docker compose ps` shows `mise` healthy. `docker compose logs mise` has **no**
      `TRUST_PROXY is …` warning and no `refusing to start`.
- [ ] Role guard refuses wrong roles (ADR-018). Each must print `refusing to start` and exit 1:
  ```sh
  read -rsp 'password: ' PW; echo
  docker compose run --rm --no-deps -e DATABASE_URL_FILE= -e DATABASE_URL="postgres://mise_migrator:${PW}@postgres:5432/mise" mise
  # repeat with the bootstrap superuser: postgres://postgres:<postgres_password>@postgres:5432/mise
  unset PW
  ```
- [ ] Provision the household (never mints a session):
      `docker compose exec mise node dist/cli/provision-household.js --name "<name>" --issuer https://auth.<domain> --owner-subject <sub> --owner-name <name> --member-subject <sub> --member-name <name>`

## 4. Network: firewall and egress (Mise host)

Docker-published ports bypass ufw/INPUT rules, so filter them in the `DOCKER-USER` chain. Persist the rules
(e.g. `iptables-persistent` or a systemd unit that runs after Docker).

- [ ] Only the proxy Pi reaches the app and Authelia:
  ```sh
  iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3000 --ctdir ORIGINAL ! -s <proxy-pi-ip> -j DROP
  iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 9091 --ctdir ORIGINAL ! -s <proxy-pi-ip> -j DROP
  ```
- [ ] No new outbound connections from the app/database network (Milestone A needs none; Authelia is reached over the
      internal `mise_oidc` network): `iptables -I DOCKER-USER -s 172.30.10.0/24 ! -d 172.30.10.0/24 -m conntrack --ctstate NEW -j DROP`
- [ ] Verify: from another LAN machine `nc -vz <host> 3000` and `nc -vz <host> 9091` time out; from the proxy Pi both
      connect. `ss -ltn` on the host shows 5432 only on `127.0.0.1`.
      `docker exec mise node -e "fetch('https://example.com').then(()=>console.log('EGRESS OPEN'),()=>console.log('egress blocked'))"`
      prints `egress blocked`; `docker exec mise node -e "fetch('http://authelia:9091/api/health').then(r=>console.log(r.status))"` prints `200`.
- [ ] Router forwards only 443 and 80 to the proxy Pi; nothing to the Mise host.
- [ ] Proxy-to-host hop: plain HTTP on the LAN, restricted to the proxy Pi by the rules above (ADR-012 guardrail
      "consider TLS on the hop"; see open question in the A19 hand-off).

## 5. Proxy Pi (nginx)

- [ ] Authelia server block per `infra/authelia/README.md`; Mise: `infra/nginx/mise.example.conf` to
      `/etc/nginx/conf.d/mise.conf`, `infra/nginx/mise-proxy.conf` to `/etc/nginx/snippets/`, placeholders replaced,
      `@MISE_UPSTREAM@` = `<host LAN IP>:3000`. `nginx -t && systemctl reload nginx`.
- [ ] Remove any older Mise server block (the A03 draft `mise.mydomain.com.conf`).
- [ ] ADR-012 addendum "still to verify": run the real-host issuer checks in `infra/authelia/README.md`.

## 6. Edge, headers, rate limits and logs

- [ ] From **outside** the home network: `infra/scripts/check-public-edge.sh https://mise.<domain> https://auth.<domain> <public-ip>`
      prints `EDGE OK` (HTTPS redirect, TLS ≥ 1.2, security headers, 401 on every data route with and without a forged
      cookie, cross-site POST refused, SSE 401, minimal health, `/api/authz` blocked, ports 3000/5432/9091 closed).
- [ ] Rate limits key on the real client IP (TRUST_PROXY). From the **proxy Pi** (bypasses the nginx limit, hits the app's
      20/min login limit):
  ```sh
  for i in $(seq 21); do curl -s -o /dev/null -w '%{http_code} ' -H 'X-Forwarded-For: 203.0.113.7' http://<host>:3000/api/v1/auth/oidc/start; done; echo
  curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.8' http://<host>:3000/api/v1/auth/oidc/start
  ```
  The first loop ends in `429`; the second address still gets `302`. If both get `429`, TRUST_PROXY is wrong.
- [ ] Live lists through the proxy: open the same list on two phones, check off an item on one; the other updates within
      ~1 s, and stays connected for more than 2 minutes while idle (SSE not buffered, heartbeat passes the proxy).
- [ ] Browser console on phone and laptop: no CSP violations during the exit test.
- [ ] Log redaction: after the exit test, `docker compose logs mise | grep -Ei 'mise_session=|authorization:|code=|state=|password|BEGIN .*KEY'`
      returns nothing, and the first 12 characters of your session cookie (browser dev tools) do not appear in the logs.

## 7. AC-11 through the public HTTPS path (owner, both people)

P0 enables one sign-in method: password + TOTP. Passkeys are disabled (`MISE_AUTH_WEBAUTHN_DISABLE=true`, ADR-003
addendum), so "both methods" means checking that the passkey path is **not** offered, plus every step below with password + TOTP.

- [ ] Rejected logins: wrong password, then right password with wrong TOTP: generic error, no Mise session
      (`/api/v1/auth/me` still 401). Three failures within 2 minutes ban the user for 10 minutes (lift: lost-device runbook B).
- [ ] The Authelia portal offers no passkey/WebAuthn option.
- [ ] Sign in on phone A. Right after Mise loads, open `https://auth.<domain>/`: it shows the login form, so the SSO session
      was ended by the post-login logout (ADR-003 addendum D4, real-host check).
- [ ] Revocation: phone A has a shopping list open. Phone B revokes A (Settings, Devices). A's live list stops at once and
      A's next action returns to sign-in.
- [ ] No silent re-entry: on A, sign in to the Authelia portal directly first (live SSO session), then start a Mise login.
      Authelia must ask for the password again, and Mise must create the session only after that fresh check.
      A login that completes with no credential prompt is a **failure**: stop and do not go live.
- [ ] Lost-device drill: run section A of `docs/runbooks/lost-device-recovery.md` end to end with a real phone (revoke,
      restart Authelia, sign in again elsewhere). Record the time it took.

## 8. Threat-model checklist (tech §12; NFR-01 "public exposure requires a threat-model review")

| Risk / control                                                                   | Milestone A status                                                  | Evidence                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Unauthenticated access to household data                                         | Deny-by-default auth hook; SPA fallback never covers `/api`         | `auth/routes.test.ts`, `platform/spa.test.ts`, edge script |
| One user guesses another household's IDs                                         | Every query household-scoped                                        | `*.int.test.ts` isolation tests (A06 harness)              |
| Cross-site request forges a checkbox click                                       | Origin + session-bound CSRF token; `SameSite` `__Host-` cookie      | `platform/security.test.ts`                                |
| Revoked device keeps API or SSE access                                           | Revocation checked per request; SSE closes on revoke                | `auth.int.test.ts`, `shopping/events.int.test.ts`, step 7  |
| Revoked device re-enters via live SSO                                            | Fresh `auth_time` + post-login SSO logout                           | `auth/oidc.test.ts`, step 7                                |
| Login brute force                                                                | Authelia regulation, nginx 10 r/min, app 20/min per real IP         | step 6                                                     |
| Stale two-device edit overwrites                                                 | Per-item `revision`, `409`                                          | shopping/recipes int tests                                 |
| Old SSE replay mutates state                                                     | SSE carries `{listId, seq}` only; checkoff is `setPicked`           | ADR-004, A14 tests                                         |
| Repeated request duplicates a write                                              | `Idempotency-Key`; expiry sweep hourly                              | `platform.int.test.ts`, `idempotency.test.ts`              |
| App DB role can disable immutability trigger                                     | Least-privilege role + startup guard                                | `db-role.int.test.ts`, step 2/3                            |
| Secrets or chat/profile data in logs                                             | Redaction, no bodies, query strings stripped                        | `platform/logging.test.ts`, step 6                         |
| Exposed ports / debug / DB admin                                                 | LAN-bound + DOCKER-USER; DB on loopback; no debug routes            | step 4, edge script                                        |
| Container escape impact                                                          | Non-root, read-only, `cap_drop: ALL`, `no-new-privileges`           | `infra/compose.yaml`                                       |
| Vulnerable dependencies                                                          | Dependabot weekly + CI gate                                         | `.github/dependabot.yml`                                   |
| Backup restore loses data                                                        | Restore drill                                                       | `docs/runbooks/restore.md`                                 |
| Malicious recipe URL (SSRF), page prompt injection, upload abuse, AI tool misuse | **Not in Milestone A** (no importer, uploads or AI); egress blocked | Re-review at Milestone B                                   |

- [ ] Both people have read the table and agree nothing open blocks go-live.

## 9. Milestone A exit test (owner, both people, on phones)

Run with AI switched off (no AI configured in Milestone A).

- [ ] Both sign in through Authelia on phone and laptop.
- [ ] Search and edit shared recipes: version history and the servings converter work.
- [ ] Both use the same shopping list at the same time with live checkoffs.
- [ ] A revoked device is locked out immediately, with no silent re-entry through a live Authelia session (step 7).
- [ ] Everything restores from backup onto a clean environment (`docs/runbooks/restore.md` drill, on the production dumps).
- [ ] Start the friction list: `docs/milestone-a/friction-list.md`.

## Record

| Date | Revision | Who | Steps passed | Notes |
| ---- | -------- | --- | ------------ | ----- |
|      |          |     |              |       |
