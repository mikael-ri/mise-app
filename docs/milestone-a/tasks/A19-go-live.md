# A19 — Deployment, hardening and go-live

**Depends on:** A00–A18 · **Size:** L · **Model tier:** Strong
**Covers:** NFR-01, AC-11, Milestone A exit test
**Read only:** tech §3, §12; spec NFR-01, AC-11; ADR-012; docs/runbooks/

## Goal
Put it on the internet safely and use it.

## Do
- Production `infra/compose.yaml` and the Authelia stack; LAN-only upstream ports firewalled to the proxy host.
- `infra/nginx/mise.example.conf`: TLS, proxy headers, SSE buffering off, rate limits.
- Verify security headers and log redaction; dependency update automation.
- Walk the threat-model checklist; run the lost-device drill; run AC-11 through the public HTTPS path.
- Go-live checklist in `docs/runbooks/`.

## Not in scope
- New features.

## Done when
- Both of you pass the Milestone A exit test on your phones. Start the friction list for B–D.

Finish with: what changed, FR/AC IDs covered, test results, open questions.

## Carry-over from A06 (platform)
- TRUST_PROXY set to the Pi's address (e.g. `TRUST_PROXY=192.168.1.10`; comma-separated IPs/CIDRs are accepted), not a blanket `true`. Verify rate limits key on the real client IP. The server logs a warning at startup in production when it is `false` or `true`.
- Schedule `sweepExpiredKeys` (idempotency expiry sweep, ADR-013 "still to verify"): timer in `main.ts` or an admin CLI command. Expired keys are already treated as absent, so this is housekeeping.
- Set `PUBLIC_ORIGIN`, `CSRF_SECRET` (>= 32 chars, may use `CSRF_SECRET_FILE`) and `DATABASE_URL` in the production env.

## Carry-over from A07 (auth)
- Set `SESSION_SECRET` (>= 32 chars, may use `_FILE`), `OIDC_ISSUER`, `OIDC_INTERNAL_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (may use `_FILE`) and `OIDC_POST_LOGIN_LOGOUT_URL` in the production env.
- Verify on the real host that the post-login Authelia logout (`OIDC_POST_LOGIN_LOGOUT_URL?rd=...`) ends the SSO session and returns to Mise (ADR-003 addendum D4, still pending).

## Carry-over from the database roles work (ADR-018)
- Create the production roles by hand with real secrets: a migrator role that owns every schema object and an app role with the privileges in ADR-018. Do not use `infra/postgres/provision-roles.sql` (dev/CI only, published passwords). `REVOKE ALL ON DATABASE <db> FROM PUBLIC`. Run `pnpm db:migrate` with `MIGRATION_DATABASE_URL` (migrator) and then `db:grants` with `APP_DB_ROLE`; set the server's `DATABASE_URL` to the app role.
- Check that the live database matches ADR-018: tables owned by the migrator, the app role is not a superuser and owns nothing, `DELETE` granted only on the listed tables, no `TRUNCATE`/`TRIGGER`/`REFERENCES`, no `CREATE` on the schema or database. A query-based check in the go-live checklist is enough.
- Startup check in `main.ts`: in production the server queries its own role and refuses to start if it is a superuser or owns any table in `public`. Test it with a superuser URL and with the migrator URL (both must refuse) and with the app role (must start).

## Carry-over from the build output (A09 follow-up)
- `apps/server/tsconfig.build.json` already excludes tests, test support and the isolation harness, and a real `tsc` emit contains only server `src` files. But `@mise/contracts` and `@mise/domain` have `"main": "src/index.ts"`, so they are not compiled and a plain `node dist/main.js` cannot resolve them. Dev and tests run from source and are unaffected.
- **Decision to make (needs the owner's approval before any dependency is added):** (a) compile each workspace package with `tsc` to `dist/` and point `main`/`exports` at it, or (b) bundle the server together with its workspace dependencies using a bundler. Option (a) adds no dependency; option (b) adds a bundler as a new dependency. Do not add one without approval.
- Whatever is chosen, verify in the Dockerfile stage by listing the image's `dist/` and confirming no `*.test.*`, `test-*`, `isolation-harness` or `tests/support` files.
