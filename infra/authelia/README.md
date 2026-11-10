# Authelia stack for Mise (spike A03)

Working example for **Authelia 4.39.28** as the OIDC provider for Mise (ADR-003, ADR-012). Evidence and decisions:
`docs/adr/0003-addendum-authelia-spike.md`. Lost-device procedure: `docs/runbooks/lost-device-recovery.md`.

No secrets are committed. Everything generated lives in gitignored paths: `secrets/`, `data/`, `tls/`, `users.yml`, `configuration.yml`.

## What is here

| Path                                   | Purpose                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `compose.yaml`                         | Authelia only, image pinned to `authelia/authelia:4.39.28` (digest in the header) |
| `configuration.example.yml`            | Config template; values come from environment variables, secrets from `/secrets`  |
| `users.example.yml`                    | Provisioned users (file backend). Only these users can sign in                    |
| `nginx/`                               | Server blocks and proxy snippets for the proxy Pi (`auth.mydomain.com`, `mise.…`) |
| `scripts/setup.sh`                     | Generates secrets and the OIDC client secret (plain + PBKDF2 digest)              |
| `scripts/validate-config.sh`           | Validates the rendered config with the pinned image                               |
| `compose.dev.yaml`, `scripts/dev-*.sh` | **Dev only**: local nginx, throwaway CA, `*.mydomain.test`                        |
| `spike/`                               | Throwaway relying party and Playwright evidence suite (not production code)       |

## Deploy on the Mise host

1. Copy this folder to the host. Needs Docker with the compose plugin.
2. Generate secrets: `./scripts/setup.sh` (creates `secrets/`, `data/`, copies `configuration.example.yml` to `configuration.yml`).
3. Create users: `cp users.example.yml users.yml`, then for each user generate a digest and paste it in:
   `docker run --rm authelia/authelia:4.39.28 authelia crypto hash generate argon2 --password '<password>'`
4. Set the environment. Either `export` the variables in your shell or put them in a private file outside git and
   pass `docker compose --env-file <file> …`. Defaults in `compose.yaml` use `mydomain.com`:

   | Variable                    | Example / default                            | Meaning                                        |
   | --------------------------- | -------------------------------------------- | ---------------------------------------------- |
   | `MISE_COOKIE_DOMAIN`        | `mydomain.com`                               | Parent domain of both hosts                    |
   | `MISE_AUTH_PUBLIC_URL`      | `https://auth.mydomain.com`                  | Public URL = OIDC issuer (no trailing slash)   |
   | `MISE_AUTH_PUBLIC_HOST`     | `auth.mydomain.com`                          | Used as TOTP issuer label                      |
   | `MISE_OIDC_REDIRECT_URI`    | `https://mise.mydomain.com/auth/callback`    | Must equal the callback route A07 implements   |
   | `AUTHELIA_BIND_ADDRESS`     | LAN IP of the Mise host, e.g. `192.168.1.20` | Never `0.0.0.0`; firewall to the proxy Pi only |
   | `AUTHELIA_BIND_PORT`        | `9091`                                       |                                                |
   | `AUTHELIA_UID/GID`          | `1000`                                       | Owner of `data/` and `secrets/`                |
   | `MISE_AUTH_SSO_EXPIRATION`  | see ADR addendum                             | Authelia SSO session absolute lifetime         |
   | `MISE_AUTH_SSO_INACTIVITY`  | see ADR addendum                             | Authelia SSO session idle lifetime             |
   | `MISE_AUTH_SSO_REMEMBER_ME` | `-1`                                         | `-1` disables Remember Me. **`0` does not.**   |
   | `AUTHELIA_LOG_LEVEL`        | `info`                                       | `debug` while diagnosing                       |

5. `./scripts/validate-config.sh` (same environment), then `docker compose up -d`. Wait for `healthy`.
6. One-time codes for registering TOTP or a passkey are written to `data/notification.txt` (filesystem notifier,
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

## Real-device checks (passkey, phone, password manager)

The automated evidence uses Chromium's virtual authenticator. Please also verify on real hardware and record the result
in the ADR addendum (section "Still to verify"):

1. Sign in at `https://auth.mydomain.com`, open **Settings → WebAuthn Credentials → Add**, enter the one-time code
   from `data/notification.txt`, and register your passkey (platform authenticator or security key).
2. Sign out. Sign in with **Sign in with a passkey**. Record what Authelia asks for next (the ADR addendum says
   what we expect; note any difference).
3. With the Authelia SSO session still open, start a new login from another browser profile and confirm you are
   asked for credentials again (see ADR addendum for the exact expectation).
4. Confirm the Remember Me checkbox is absent and the session cookie is a normal session (not persistent).
5. Try the passkey on a second device (cloud-synced passkey) if you intend to use one.

## Dev stack (this machine)

`./scripts/setup.sh && ./scripts/dev-proxy.sh && ./scripts/dev-up.sh` brings up Authelia plus a local nginx on
`https://auth.mydomain.test:9443`. The browser maps `*.mydomain.test` to `127.0.0.1` through a Chromium flag; no
`/etc/hosts` change is needed. Evidence suite:
`pnpm exec playwright test -c infra/authelia/spike`.
