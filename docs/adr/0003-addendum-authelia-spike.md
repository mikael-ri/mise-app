# ADR-003 addendum: Authelia OIDC and sessions spike (card A03)

Appended to [ADR-003](0003-authentication.md) per the addendum format in [README](README.md). The frozen documents are not edited.

## Addendum (2026-11-12): Authelia 4.39.28 behaviour and decisions

(Measurements were taken 2026-11-10; owner drills and real-host checks 2026-11-10 to 2026-11-12.)

**Finding:** on 4.39.28 password + TOTP satisfies `two_factor`; `max_age=0` is unusable and `prompt=login` plus a verified `auth_time` is the working freshness mechanism; Authelia's own `inactivity` is not enforced, only `expiration`; details in sections 1 to 10.

**Evidence:** Authelia `authelia/authelia:4.39.28` (digest `sha256:bd97cff4fcbf715b5ff1f9ae286afbe6033afce385302520b0368122d43a6f54`),
own Compose stack (`infra/authelia/`), dev nginx standing in for the proxy Pi, throwaway relying party in `infra/authelia/spike/`
(Playwright suite `pnpm exec playwright test -c infra/authelia/spike`, unit tests `pnpm exec vitest run infra/authelia/spike`,
23 passing). Evidence lines are written to the gitignored `infra/authelia/spike/.out/evidence.jsonl`; the idle and absolute expiry probe is
`infra/authelia/spike/idle-probe.ts` (`PROBE_AT=<seconds>`).

**Caveat on evidence:** the measurements in sections 1 to 5 were taken with the earlier SQLite dev stack. Afterwards the owner moved
Authelia storage to PostgreSQL (section 10) and the dev stack to a standalone `compose.dev.yaml`. On 2026-11-12 the Playwright suite was
**re-run once against the Postgres dev stack: 9 passed, 8 skipped** (the passkey tests need `PASSKEY=1`; the SSO-inactivity test needs `SSO_SHORT=1`).
The passing tests cover the issuer/network behaviour, the config guard, the live-SSO reuse variants (control, `prompt=login`, `max_age=1`,
`max_age=30`), the full login after portal logout, stale/forged token rejection, and cookie attributes. The passkey measurements remain from the SQLite run.
The production `compose.yaml` parses (`docker compose config`) and runs on the owner's real host, where the owner's checks were done.

### 1. Enabled login method (decision D1)
- **P0: password + TOTP only.** Steps seen: `first-factor, totp, consent`. ID token has `auth_time`, `aud`, `nonce`, `exp`;
  PKCE S256 validated; `two_factor` client policy, no `experimental_*` key.
- **Passkeys are disabled by default** (`webauthn.disable: true` via `MISE_AUTH_WEBAUTHN_DISABLE`, default `true`). The passkey
  config block and the passkey tests stay; the tests run only with `PASSKEY=1` and `MISE_AUTH_WEBAUTHN_DISABLE=false`.
- Findings kept for later: on 4.39.28 a user-verified passkey **plus password** satisfies `two_factor` without experimental
  flags (steps: passkey, then `/2fa/password`, then consent). A passkey without user verification is rejected. **Passwordless**
  passkey login needs `experimental_enable_passkey_uv_two_factor`, which tech §12 forbids. Passwordless is deferred until it
  leaves experimental status in Authelia.
- Authelia controls observed in logs: TOTP replay refused; passkey clone detection; elevation (code e-mail) rate limit escalates.

### 2. Freshness mechanism (decision D3)
- `max_age=0` is **unusable** on 4.39.28: after a complete login each consent accept demanded another password check, in an endless loop.
- **Mechanism:** the authorization request carries `prompt=login`. The relying party (Mise, card A07) requires
  `auth_time >= request start - 5 s` and stores it as `device_sessions.authenticated_at`. Missing or older `auth_time` is rejected.
  Control without the parameter: Authelia reissues a code with the old `auth_time` and the check rejects it (`stale auth_time`).
  `max_age=1` and `max_age=30` (after 35 s) also forced a fresh `auth_time`.
- **`amr` must not be used to judge freshness.** A fresh token after a password-only re-check still says `amr: [.., mfa]`.
- **Accepted limitation:** a new login on a live Authelia SSO session asks for the **password only**, not TOTP (observed with
  `prompt=login`, `max_age=1`, `max_age=30`). See the mitigation below.

### 3. Required mitigation: end the SSO session after the callback (decision D4, binding requirement for cards A07 and A08; mechanism pending)
- Right after the Mise OIDC callback succeeds (token and `auth_time` verified, device session created), Mise **redirects the
  browser to the Authelia portal logout** so that no SSO session stays alive. After `GET /logout` on the portal the next login
  needs the full flow again (password + TOTP); verified.
- Authelia SSO lifetimes stay short (section 5). **Remember Me stays off** (`remember_me: -1`); do not enable it.
- Open detail: the post-logout return (`/logout?rd=<mise url>`) landed on the Authelia login page with `rd` in the query on the dev host.
  On the real host the owner got a **404 page** (the text, "Additionally, a 404 Not Found error was encountered while trying to use an
  ErrorDocument", reads like a different web server than the Authelia proxy, possibly the not-yet-deployed Mise host). Which host
  answered (the owner later confirmed it was `auth.<domain>`), and whether Authelia had ended the SSO session, was not established: **pending**. Since `auth.<domain>` itself returned the 404, A07 must find the working logout mechanism (for example the portal's logout API or a different `rd` form) on a real host before it relies on any redirect. A07/A08 must not depend on the
  `rd` redirect until this is verified against a deployed Mise host; the logout itself (without `rd`) was verified on the dev stack.

### 4. Remember Me
- `remember_me: 0` does **not** disable it: ticking the box gave a 30-day cookie (2,592,000 s).
- `remember_me: -1` removes the checkbox; cookie lifetime equals `expiration`. Password + TOTP (and the passkey + password flow) completed with `-1`.
- Cookie `authelia_session`: Secure, HttpOnly, SameSite=Lax.

### 5. SSO lifetimes (decision D5)
| Setting | Value | Evidence |
| --- | --- | --- |
| `expiration` | **15m** | Absolute expiry is enforced under the production setting: with `expiration=5m`, `inactivity=15m`, `remember_me=-1`, one probe after 320 s returned `authentication_level: 0` (evidence line `sso-expiry-probe`, 2026-11-12, Postgres dev stack). It was also observed earlier with `remember_me=1M`: with `expiration=5m`, `remember_me=1M`, a probe after 320 s idle returned `authentication_level: 0`. 15 m exceeds a full login (15 to 35 s, up to about 1 min). |
| `inactivity` | **Not relied on** (kept at 15m, equal to `expiration`, so it has no extra effect) | Not enforced on 4.39.28 in two configurations: `inactivity=90s`, `expiration=5m`, `remember_me=-1` (60 s and 130 s idle, still level 2); and `remember_me=1M` (130 s idle, still level 2). Cause not found. A 20 s limit expired in the middle of a login, so inactivity values below a full login are unusable anyway. |
| `remember_me` | `-1` | section 4 |

The probe is `GET /api/state` once per login (probing refreshes activity). Only `expiration` is a security control; combined
with the logout after callback (section 3) SSO sessions are in practice seconds long.

### 6. Issuer and network handling (ADR-012 evidence, see its addendum)
Token and JWKS calls go to the internal URL, `iss` is validated against the public issuer; passes.

### 7. Mise device-session lifetimes (decision D2, for card A07; record only, no code)
Absolute **180 days**, idle (sliding) **90 days**. Revocation and the freshness rule above apply to every new session.

### 8. E2E strategy (decision D6)
A **fake OIDC provider** carries the bulk of E2E tests (card A16). The real-Authelia suite (this spike's Playwright suite) is a
**pre-release and Authelia-upgrade gate only**. Reason: a real login costs 15 to 35 s (Argon2, TOTP window, elevation limiter),
and the limiter escalates on repeated attempts.

### 9. Consent (decision D7)
Observed, not investigated: Authelia shows an extra consent click at each new-device login (also with `consent_mode: pre-configured` / `1y`,
and `implicit`), possibly because of `prompt=login`. Not a security issue; the UX cost is one click.

### 10. Other observed configuration
- **Storage: PostgreSQL** (`postgres:18.6-alpine`, a separate container in the Authelia stack) instead of SQLite. Owner's decision: familiarity,
  and previous experience of corrupted SQLite files. Dev uses the same Postgres in `compose.dev.yaml`. This is an infra image, not an application dependency.
OIDC client `mise`: `two_factor`, `enforce_pkce: always`, S256, code flow only, `client_secret_basic`; lifespans: code 1 m, access/ID/refresh 5 m.
Regulation: 3 retries / 2 min / 10 min ban. Image healthcheck disabled (it writes under `/app`, conflicting with `read_only: true`); Compose uses an HTTP check on `/api/health`.

**Decision / change:** as in sections 1 to 9. ADR-003 and tech §12 name `max_age=0`; since it does not work on 4.39.28, the owner decided (D3) to use
`prompt=login` plus a verified `auth_time`, which tech §12 allows as "another tested equivalent". No frozen document needs to change.

**Consequences:**
- A07: send `prompt=login`, verify `auth_time >= start - 5 s`, never use `amr` for freshness, device sessions 180 d absolute / 90 d idle, redirect to Authelia logout after a successful callback.
- A08: same logout requirement on the login/logout screens.
- A16: fake OIDC provider for E2E; real-Authelia suite only as a release gate.
- A19: Authelia runs with passkeys disabled, `remember_me: -1`, `expiration: 15m`.
- Recovery: see `docs/runbooks/lost-device-recovery.md`.

**Recovery drills (owner, dev stack, 2026-11-10), all as expected:**
- Restart (`docker compose restart authelia`) drops SSO sessions: `/api/state` went from level 2 to `authentication_level: 0`.
- `authelia storage user totp delete alice` and `totp generate alice` succeeded; the old code was rejected, the new code accepted.
- Password rotation (new Argon2 digest in `users.yml` plus restart): old password rejected, new accepted.
- Regulation: after repeated failures `storage bans user list` showed `alice`, source `regulation`, reason "Exceeding Maximum Retries", with an expiry; `bans user revoke alice` returned SUCCESS and the list was empty afterwards. During the ban the portal showed only the generic "password may be wrong" message (a ban is not disclosed; generic errors per tech §12).

**Real-host checks (owner, 2026-11-12):**
- Authenticator app registered, login with password + TOTP works, sign-out and sign-in again works, no Remember Me checkbox, password manager works.
- A login from a *different browser* asked for password and TOTP. This does **not** test SSO reuse (a different browser has no SSO cookie), so it neither confirms nor contradicts the dev finding that a live SSO session needs only the password for `prompt=login`. The mitigation in section 3 stands. Retest in the same browser once A07 exists.
- `/logout?rd=` returned a 404 page **from `auth.<domain>` itself** (owner, 2026-11-12). So on the real host the portal does not serve that path as it did on the dev stack (or the proxy sends it elsewhere). Whether the SSO session ended is unknown. See section 3.
- Proxy/issuer `curl` checks (public issuer; 400 without forwarded headers; same issuer with them): owner reports the expected results, but the output was not saved. Recorded as owner-reported, not evidenced.
- Not reported: the `authelia_session` cookie lifetime check. **pending.**

**Still to verify:**
- **pending:** whether Authelia's legacy `/api/verify` endpoint (and other `server.endpoints.authz` defaults) is reachable through the proxy; the proxy only blocks `/api/authz/`. If reachable, restrict `server.endpoints.authz` and block it at nginx. Not changed here because it was not tested.
- **pending (owner/A07):** a working post-callback logout on the real host (`/logout?rd=` gave a 404 from the portal; does the next visit require a full login?), and cookie expiry on the real host.
- **pending (A07):** a same-browser second login with a live Authelia SSO session on the real host (expected: password only for `prompt=login`).
- Revocation of open SSE streams (Mise side, A07/A14).
- Why `inactivity` is not enforced (possibly version-specific); re-test on Authelia upgrades.
- Passkeys on real devices (only if a passkey pilot is started later).
- The owner changed the real-host Compose and configuration after these tests; the repo copies are to be synced and re-validated before finalising.

**Change request:** none.
