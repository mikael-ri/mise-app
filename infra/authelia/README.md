# Authelia stack for Mise (spike A03)

Working example for **Authelia 4.39.28** as the OIDC provider for Mise (ADR-003, ADR-012). Evidence and decisions:
`docs/adr/0003-addendum-authelia-spike.md`. Lost-device procedure: `docs/runbooks/lost-device-recovery.md`.

No secrets are committed. Everything generated lives in gitignored paths: `secrets/`, `data/`, `tls/`, `users.yml`, `configuration.yml`.

## What is here

| Path                                   | Purpose                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `compose.yaml`                         | Production: Authelia + Postgres, image pinned to `authelia/authelia:4.39.28` (digest in the header)               |
| `configuration.example.yml`            | Config template; values come from environment variables, secrets from `/run/secrets`                              |
| `users.example.yml`                    | Provisioned users (file backend). Only these users can sign in                                                    |
| `nginx/`                               | Server blocks and proxy snippets for the proxy Pi (`auth.mydomain.com`, `mise.…`)                                 |
| `scripts/setup.sh`                     | Generates secrets and the OIDC client secret (plain + PBKDF2 digest)                                              |
| `scripts/validate-config.sh`           | Validates the rendered config with the pinned image                                                               |
| `compose.dev.yaml`, `scripts/dev-*.sh` | **Dev only**: self-contained stack (Authelia, Postgres, local nginx), throwaway CA and secrets, `*.mydomain.test` |
| `spike/`                               | Throwaway relying party and Playwright evidence suite (not production code)                                       |

## Deploy on the Mise host

1. Copy this folder to the host. Needs Docker with the compose plugin.
2. Production layout (`compose.yaml`): Authelia stores its data in Postgres (`authelia_db`, chosen for operator familiarity
   and to avoid SQLite file corruption). It needs, created once beforehand: the external network and volumes
   (`docker network create authelia`, `docker volume create authelia_data`, `docker volume create authelia_db`) and the files
   `.secrets/{postgres_pw,session-secret,storage-encryption-key,oidc-hmac-secret,oidc-jwks-rsa.pem,oidc-client-secret.digest}`
   (gitignore them; `scripts/setup.sh` makes the same set under `secrets/` for the dev stack only). Copy
   `configuration.example.yml` to `configuration.yml`. Make the data volume writable for the container user (Docker creates it root-owned):
   `docker run --rm -v authelia_data:/data alpine chown 1000:1000 /data` (use your `AUTHELIA_UID:GID`). Validate with `./scripts/validate-config.sh` (it reads `.secrets/`).
3. Create users: `cp users.example.yml users.yml`, then for each user generate a digest and paste it in:
   `docker run --rm authelia/authelia:4.39.28 authelia crypto hash generate argon2` (prompts for the password; keeps it out of shell history; use `docker run -it`)
4. Set the environment. Either `export` the variables in your shell or put them in a private file outside git and
   pass `docker compose --env-file <file> …`. Defaults in `compose.yaml` use `mydomain.com`:

   | Variable                     | Example / default                            | Meaning                                        |
   | ---------------------------- | -------------------------------------------- | ---------------------------------------------- |
   | `MISE_COOKIE_DOMAIN`         | `mydomain.com`                               | Parent domain of both hosts                    |
   | `MISE_AUTH_PUBLIC_URL`       | `https://auth.mydomain.com`                  | Public URL = OIDC issuer (no trailing slash)   |
   | `MISE_AUTH_PUBLIC_HOST`      | `auth.mydomain.com`                          | Used as TOTP issuer label                      |
   | `MISE_OIDC_REDIRECT_URI`     | `https://mise.mydomain.com/auth/callback`    | Must equal the callback route A07 implements   |
   | `AUTHELIA_BIND_ADDRESS`      | LAN IP of the Mise host, e.g. `192.168.1.20` | Never `0.0.0.0`; firewall to the proxy Pi only |
   | `AUTHELIA_BIND_PORT`         | `9091`                                       |                                                |
   | `AUTHELIA_UID/GID`           | `1000`                                       | Must own the `authelia_data` volume            |
   | `MISE_AUTH_SSO_EXPIRATION`   | `15m`                                        | Authelia SSO session absolute lifetime         |
   | `MISE_AUTH_SSO_INACTIVITY`   | `15m` (not relied on, see ADR addendum)      | Authelia SSO session idle lifetime             |
   | `MISE_AUTH_WEBAUTHN_DISABLE` | `true`                                       | Passkeys off in P0; `false` only for PASSKEY=1 |
   | `MISE_AUTH_SSO_REMEMBER_ME`  | `-1`                                         | `-1` disables Remember Me. **`0` does not.**   |
   | `AUTHELIA_LOG_LEVEL`         | `info`                                       | `debug` while diagnosing                       |

5. `./scripts/validate-config.sh` (same environment, `.secrets/`), then `docker compose up -d`. Wait for `healthy`.
6. One-time codes for registering TOTP or a passkey are written to `/data/notification.txt` in the `authelia_data` volume (production: `docker exec authelia cat /data/notification.txt`; dev: `data/notification.txt`; filesystem notifier,
   file is overwritten on every message). Replace the `notifier:` block with `smtp:` if you prefer e-mail.

## Proxy Pi (nginx)

1. Copy `nginx/auth.mydomain.com.conf` and `nginx/mise.mydomain.com.conf` to `/etc/nginx/conf.d/`, and
   `nginx/authelia-proxy.conf`, `nginx/mise-proxy.conf` to `/etc/nginx/snippets/` (create the directory if missing).
2. Replace in the copies: `mydomain.com` with your domain, `@TLS_CERT@` / `@TLS_KEY@` with your certificate paths,
   `@AUTHELIA_UPSTREAM@` with `<host-lan-ip>:9091`, `@MISE_UPSTREAM@` with `<host-lan-ip>:<mise-port>`.
3. `nginx -t && systemctl reload nginx`.
4. The `X-Forwarded-Proto` / `X-Forwarded-Host` headers in the snippet are load-bearing: Authelia derives its issuer
   from them. The forward-auth endpoints (`/api/authz/*`) are blocked on the public side on purpose.

## Check it works (from any machine)

```sh
curl -s https://auth.mydomain.com/.well-known/openid-configuration | grep -o '"issuer":"[^"]*"'   # public issuer
curl -s -o /dev/null -w '%{http_code}\n' https://auth.mydomain.com/api/authz/forward-auth        # expect 404
```

From the Mise host (internal URL; Mise server will use this for token and JWKS calls):

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://<host-lan-ip>:9091/.well-known/openid-configuration            # 400: fails closed
curl -s -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-Host: auth.mydomain.com' \
  http://<host-lan-ip>:9091/.well-known/openid-configuration | grep -o '"issuer":"[^"]*"'                      # public issuer
```

## Real-host checks (password + TOTP, phone, password manager)

P0 login is password + TOTP (ADR-003 addendum). Passkeys are off (`MISE_AUTH_WEBAUTHN_DISABLE=true`). Run these on the
final host over the real https domains and record the results in the ADR addendum ("Still to verify"):

1. Sign in at `https://auth.mydomain.com` (first login uses the password only), open **Settings, One-Time Password**, enter
   the one-time code from `data/notification.txt`, scan the QR code with your authenticator app (and the password manager
   if you use it for TOTP).
2. Sign out, then sign in again with password + TOTP code from the phone. Note the screens in order.
3. Remember Me: confirm the checkbox is absent, and in the browser dev tools that `authelia_session` has no long expiry
   (a session cookie, or at most the 15 minute `expiration`).
4. SSO reuse (needs a Mise login route, so card A07): in the **same browser** with the SSO session open, start a new
   authorization request with `prompt=login`. Expected (accepted limitation): only the password is asked, not TOTP. A different
   browser or profile has no SSO cookie and proves nothing here.
5. Logout redirect: while signed in, open
   `https://auth.mydomain.com/logout?rd=https%3A%2F%2Fmise.mydomain.com%2F` and record where the browser lands, and whether
   the next visit to `https://auth.mydomain.com` asks for password + TOTP again. Note which server shows any 404 (the target
   `rd` host must exist and be reachable for this test).
6. Password manager: check that autofill fills the password on the portal and that TOTP autofill (if used) is accepted.
7. Optional, only for a later passkey pilot: set `MISE_AUTH_WEBAUTHN_DISABLE=false`, restart, and follow the
   "Optional: passkeys" notes in `docs/runbooks/lost-device-recovery.md`.

## Dev stack (this machine)

`./scripts/setup.sh && ./scripts/dev-proxy.sh && ./scripts/dev-up.sh` brings up Authelia, its Postgres and a local nginx (`compose.dev.yaml`, standalone, secrets from `secrets/`; run `scripts/validate-config.sh` for dev as `SECRETS_DIR=secrets ./scripts/validate-config.sh`) on
`https://auth.mydomain.test:9443`. The browser maps `*.mydomain.test` to `127.0.0.1` through a Chromium flag; no
`/etc/hosts` change is needed. Evidence suite:
`pnpm exec playwright test -c infra/authelia/spike` (add `PASSKEY=1` with `MISE_AUTH_WEBAUTHN_DISABLE=false` to include the passkey tests).
