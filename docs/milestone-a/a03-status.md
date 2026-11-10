# A03 status: Authelia OIDC and sessions spike

**State: IN PROGRESS. Not finished, not reviewed, not committed.** Written when work was stopped on request.
Authelia 4.39.28 (`authelia/authelia:4.39.28`, digest `sha256:bd97cff4fcbf715b5ff1f9ae286afbe6033afce385302520b0368122d43a6f54`).

## Passed (with evidence)

Evidence lines are in `infra/authelia/spike/.out/evidence.jsonl` (gitignored). Suite: `pnpm exec playwright test -c infra/authelia/spike`.

| Check | Result |
| --- | --- |
| Unit tests for the relying-party token validator and TOTP helper (`oidc.test.ts`, `totp.test.ts`) | 23 passed. **Not re-run** after `prompt` support was added to `oidc.ts`. |
| Issuer/network | Public URL: `iss`, token and JWKS URLs are all the public issuer. Internal URL without `X-Forwarded-*`: **400** (fails closed). With `X-Forwarded-Proto: https` and `X-Forwarded-Host: auth.mydomain.test:9443`: same public issuer. Wrong host, wrong proto, or host without the port: **400**. The RP calls the internal URL for token and JWKS and validates `iss` against the public issuer. |
| Config guard | `two_factor` client policy, no `experimental_*` key, passkey `user_verification: required`. Test passes. |
| Password + TOTP satisfies `two_factor` | Login steps `first-factor, totp, consent`. ID token `amr: [pwd, kba, otp, mfa]`, `auth_time` present, `aud`, `nonce`, `exp`, PKCE S256 validated. |
| Passkey path | User-verified passkey sign-in, then Authelia asks for the **password** (`/2fa/password`), then consent. `amr: [pwd, kba, pop, swk, user, pin, mfa]`. So the enabled passkey path is **passkey (UV) + password**, which satisfies `two_factor` with no experimental flag. **Passwordless passkey is not enabled** (needs `experimental_enable_passkey_uv_two_factor`, forbidden by tech §12). |
| Passkey without user verification | Rejected (never reaches the callback). |
| `max_age=0` | **Unusable on 4.39.28.** Even right after a full login, every consent ACCEPT demands another password re-check, in an endless loop. Alternative chosen for testing: `prompt=login` (completes from a fresh state; also works as a re-auth trigger). |
| SSO reuse after "Mise revoked" (both methods) | **No freshness parameter (control):** Authelia asks for nothing except a consent click, and issues a code with the old `auth_time`; the RP check rejects it (`stale auth_time`). **`prompt=login`, `max_age=1`, `max_age=30` (after 35 s):** Authelia asks for the **password only** (second factor / passkey NOT asked again), issues a code with a fresh `auth_time` (about +4 s after request start). The new token still says `amr: [.., mfa]`, so **`amr` cannot be used to judge freshness**. |
| Explicit Authelia logout | After `GET /logout` on the Authelia portal, the next request needs the full login again (password + TOTP, or passkey + password). Both methods pass. |
| Replay and forgery in the RP | Wrong nonce and forged state rejected end to end. |
| Remember Me | `remember_me: 0` does **not** disable it: ticking the box gives a 30-day cookie (2,592,000 s). `remember_me: -1` removes the checkbox and the cookie lifetime is the configured `expiration` regardless. The passkey + password flow and the TOTP flow both completed with it disabled (`-1`). |
| Cookie flags | `authelia_session`: Secure, HttpOnly, SameSite=Lax. Lifetime equals `expiration` when Remember Me is off. |
| Authelia controls seen in logs | TOTP replay refused ("already used this code recently"); passkey clone detection ("sign count indicates that it is cloned"); elevation (code e-mail) rate limit escalates (delays 76 s, then 464 s). |

## Failed or unresolved

1. **SSO idle expiry is not demonstrated.** With `inactivity=90s`, `expiration=5m`, `remember_me=-1`, the session was still `authentication_level: 2` after 60 s and after 130 s idle (probe: `GET /api/state`, one request per login). A 20 s idle limit expired in the middle of the login itself (login takes 15 to 35 s), so SSO idle must exceed a full login. Cause not found. Unverified guess: an interaction with `remember_me: -1`. The test that would check it (`remember_me=1M`, box unticked) was **not run**. Absolute `expiration` was not tested at all.
2. The test `AC-11 password+TOTP: after SSO inactivity expiry …` (gated by `SSO_SHORT=1`) therefore fails or is skipped; it is not green.
3. Consent: `consent_mode: implicit` still showed the consent screen with `two_factor`. After switching to `pre-configured` / `1y`, the consent click still appeared on **every** login in the suite (repeat logins by the same user). Not investigated; it may be `prompt=login` forcing it.

## Untested

- Recovery drill (the runbook is a draft): restart drops SSO sessions; TOTP delete/generate (old secret rejected); passkey delete (login then fails); password rotation via `users.yml` + restart; ban list/revoke. The subcommands exist in the CLI (`totp delete|generate`, `webauthn delete|list|verify`, `bans user add|list|revoke`). The runbook writes `webauthn delete --kid`; only `--all` is confirmed.
- `/logout?rd=…` redirect back to the Mise origin (it landed on the login page with `rd` in the query; needs an https Mise host).
- Real devices: real passkey (phone, security key, synced passkey), password manager behaviour. User will test on the final host with `infra/authelia/README.md`.
- Revocation of open SSE streams (Mise-side; cards A07/A14).
- E2E strategy: **not yet written**. Direction I would propose: fast fake OIDC provider for the bulk of E2E (A16), plus this real-Authelia suite as a pre-release and Authelia-upgrade gate. Reason: real logins cost 15 to 35 s each (Argon2, TOTP window, elevation limiter, passkey registration), and the limiter escalates.
- `pnpm check` (typecheck, lint, tests): **not run**. The spike files are not in a workspace package, so `typecheck` skips them; `eslint .` and `prettier --check .` do cover them and may complain.
- `test-runner`, `code-reviewer`, `security-reviewer`: **not run**.
- ADR-003 addendum: **not written** (`docs/adr/0003-addendum-authelia-spike.md`).

## Current config values

| Item | Value |
| --- | --- |
| Running dev container env (leftover from SSO test, not recommended values) | `MISE_AUTH_SSO_INACTIVITY=90s`, `MISE_AUTH_SSO_EXPIRATION=5m`, `MISE_AUTH_SSO_REMEMBER_ME=-1` |
| Defaults in `compose.yaml` / `scripts/*.sh` (placeholders, not decided) | expiration `1h`, inactivity `15m`, remember_me `-1` |
| OIDC client `mise` | `two_factor`, PKCE S256 required (`enforce_pkce: always`), `consent_mode: pre-configured` / `1y`, code flow only, `client_secret_basic`; lifespans: code 1 m, access/id/refresh 5 m |
| WebAuthn | `user_verification: required`, `enable_passkey_login: true`, no experimental keys |
| Regulation | 3 retries / 2 min / 10 min ban |
| Server | `disable_healthcheck: true` (the image's healthcheck writes `/app/.healthcheck.env`, which breaks `read_only: true`); compose uses an HTTP healthcheck on `/api/health` |
| nginx | login routes 10 r/min burst 10; general 30 r/s burst 100 (429); `/static/` not limited (a limit caused 503 on portal assets); `/api/authz/` returns 404 |
| Dev ports | Authelia `127.0.0.1:9091`, nginx `127.0.0.1:9443`, callback listener `127.0.0.1:8765` |
| Dev accounts | `alice` (password + TOTP), `bob` (passkey + password). Throwaway; credentials in gitignored `users.yml` and `spike/.out/` |
| Device-session lifetimes (Mise side, card A07) | **Not yet decided in writing.** You asked for about 6 months. My proposal: absolute 180 days, idle (sliding) 90 days. Needs your confirmation. |

## What changed in the repo (all uncommitted)

- `.gitignore`: +8 lines (Authelia secrets, data, tls, rendered config, users, spike output).
- `infra/authelia/`: `compose.yaml`, `compose.dev.yaml`, `configuration.example.yml`, `users.example.yml`, `README.md`, `nginx/` (4 files), `scripts/` (`setup.sh`, `validate-config.sh`, `dev-proxy.sh`, `dev-up.sh`).
- `infra/authelia/spike/`: `oidc.ts`, `oidc.test.ts`, `totp.ts`, `totp.test.ts`, `http.ts`, `rp.ts`, `portal.ts`, `auth.spike.ts`, `playwright.config.ts`, `probe-issuer.ts`, plus **scratch files to delete**: `explore.ts`, `explore2.ts` to `explore13.ts`.
- `docs/runbooks/lost-device-recovery.md`: draft, partly unverified (see above).
- No new npm dependencies. Docker images pulled: `authelia/authelia:4.39.28`, `nginx:1.29-alpine`.
- Slip, already corrected: I overwrote the tracked root `.env.example` by mistake and restored it with `git checkout -- .env.example`; `git status` showed it clean afterwards. Writes of `.env*` files under `infra/authelia/` are denied by your permission settings, so the env variables are documented in `README.md` instead of an example env file. `curl` is also denied, so HTTP checks use the Node spike scripts.

## Exact next steps

1. **Resolve idle expiry (item 1 above).** From `infra/authelia/`:
   `MISE_AUTH_SSO_REMEMBER_ME=1M MISE_AUTH_SSO_INACTIVITY=90s MISE_AUTH_SSO_EXPIRATION=5m ./scripts/dev-up.sh up`, wait for `healthy`, then from the repo root
   `PROBE_AT=130 node infra/authelia/spike/explore13.ts`. Repeat with `PROBE_AT=320` to test absolute expiry. If idle expiry only works with Remember Me enabled, decide whether to accept `remember_me` on with the box hidden or rely on explicit logout. If it never works, record that idle expiry is not enforceable and set `expiration` short.
2. **Pick SSO lifetimes** from step 1. Working proposal if enforced: inactivity 5 m, expiration 15 m (must exceed a full login of up to about 1 min). Update `compose.yaml` defaults and the README table.
3. **Write the recovery drill** (`infra/authelia/spike/recovery.spike.ts`): restart drops SSO; TOTP rotation; passkey deletion; password rotation. Confirm the `webauthn delete` flags, then correct `docs/runbooks/lost-device-recovery.md`.
4. **Check the consent behaviour** (item 3) and the `/logout?rd=` redirect on a real https Mise host.
5. **Write `docs/adr/0003-addendum-authelia-spike.md`** in the format of `docs/adr/README.md`: enabled methods (password + TOTP; passkey (UV) + password; passwordless not enabled), freshness mechanism (`prompt=login` plus RP check `auth_time` ≥ request start − 5 s; `max_age=0` unusable; `amr` not trustworthy), mitigation (end Authelia SSO right after the Mise callback via portal logout, short SSO lifetimes), Remember Me finding, device-session lifetimes, E2E strategy, "Still to verify" list. Add a short ADR-012 addendum for the proxy findings.
6. **Clean up:** delete `spike/explore*.ts`, re-run `pnpm exec vitest run infra/authelia/spike`, run `pnpm check`, fix lint findings in the spike files (do not change lint config without asking).
7. **Delegate** verification to `test-runner`, then run `security-reviewer` and `code-reviewer` in parallel on the diff; resolve Critical/High and Blocking findings; list Medium/Low.
8. **You:** run the real-device checks in `infra/authelia/README.md` on the final host and report what Authelia asked for after the passkey sign-in and on a second login with a live SSO session. Register the passkey once; the elevation limiter escalates on repeated attempts.
9. **Final report** (invariants and tests, what changed, FR/AC covered, residual risks, open questions, suggested commit message). Do not commit.

## Open questions for you

- Confirm device-session lifetimes: absolute 180 days, idle 90 days?
- Accept "passkey (UV) + password" as the passkey path, with passwordless deferred (tech §12 fallback)?
- Accept the SSO-reuse finding (a live Authelia session needs only the password for a new login) with the mitigations in step 5, or do you want to explore stricter options?
