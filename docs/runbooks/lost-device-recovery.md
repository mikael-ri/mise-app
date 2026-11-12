# Runbook: lost or compromised device (DRAFT)

**Status:** draft from spike A03 (NFR-01, AC-11). Authelia-side commands were exercised against Authelia 4.39.28 in the dev stack
(see `docs/adr/0003-addendum-authelia-spike.md`). The drills for restart, TOTP, password and bans were run by the owner on 2026-11-10 and matched this text. Mise-side steps depend on the device-session UI/admin
command delivered by card A07 and are marked **(A07)**; no command names are invented here.

There are three separate things an attacker may hold. Treat them separately and in this order.

| Asset | Where it lives | Who can end it |
| --- | --- | --- |
| Mise device session (long-lived: 180 days absolute, 90 days idle) | Cookie on the device, hashed row in `device_sessions` | The other household member in the Mise UI, or the operator **(A07)** |
| Authelia SSO session (configured 15 minutes, **enforcement under the production settings is pending**; Mise must also log it out right after login, mechanism pending in A07) | Cookie `authelia_session` on the device, server-side session store | Operator: restart Authelia; user: log out of Authelia |
| Credentials: password, TOTP secret | Authelia storage / users file / the device itself | Operator with host access |

## Rule 0: do not create a bypass

Recovery never mints a Mise session. Every new Mise session, including the one you create to recover, goes through a fresh
Authelia login (password + TOTP). Do not add a "recovery login", a long-lived token or a debug
route to shortcut this.

## A. Device lost or stolen, credentials probably safe (most common)

1. **Revoke the Mise device session** from another signed-in device (Settings, Devices) **(A07)**. Revocation takes effect on the
   next API request and closes that device's open live-list (SSE) stream **(A07/A14)**.
2. **End any Authelia SSO session.** The thief's browser may still hold a live SSO cookie. On a live SSO session, Authelia
   re-asks only for the **password** for a new login (spike finding), so this step matters:
   `docker compose restart authelia` (run in the Authelia folder on the Mise host; the container is named `authelia`) on the Mise host. Sessions are held in memory and are all
   dropped; everyone, including you, has to sign in again. Takes about 15 seconds.
3. If the device had a saved password (browser or password manager): go to section B.
4. Sign in again on your other device to confirm access still works.

## B. Credentials may be exposed

Do A first, then, on the Mise host in `infra/authelia/`:

- **Password**: generate a new digest
  `docker run -it --rm authelia/authelia:4.39.28 authelia crypto hash generate argon2` (it prompts for the password, so it stays out of shell history),
  replace the user's `password:` in `users.yml`, then `docker compose restart authelia` (users file is not watched).
- **TOTP**: `docker compose exec authelia authelia storage user totp delete <user> --config /config/configuration.yml`, then register a new one
  (sign in, Settings, One-Time Password, enter the code from the notification file (production: `docker exec authelia cat /data/notification.txt`; dev: `infra/authelia/data/notification.txt`)). `authelia storage user totp generate <user>`
  can create one directly from the host if the user cannot reach the portal.
- **Failed-login bans** (self-inflicted lockout): the portal only shows the generic "password may be wrong" message, so check with `authelia storage bans user list`, then lift it with `authelia storage bans user revoke <user>` (otherwise it expires after the 10 minute ban).

All `authelia storage …` commands run inside the container, from the Authelia folder: `docker exec authelia authelia … --config /config/configuration.yml`.

## C. Locked out completely (lost every second factor)

The operator has host access; the user does not need to prove anything to a machine, only to you in person.

1. Confirm identity out of band (it is a two-person household: in person).
2. Remove the old factor (section B), remove the old Mise device sessions **(A07)**.
3. Have the user sign in with their password; register a new TOTP using the one-time code from the notification file (production: `docker exec authelia cat /data/notification.txt`; dev: `infra/authelia/data/notification.txt`).
4. Complete a normal Mise login. A new device session is created only by that login.

## D. Operator checklist after any incident

- Restart Authelia (drops all SSO sessions); revoke all Mise device sessions that are not recognised **(A07)**.
- Review `docker compose logs authelia` for unusual sign-ins; rotate `.secrets/session-secret` only if the host itself was exposed
  (rotating invalidates all sessions).
- If the OIDC client secret may have leaked: generate a new secret and digest (`docker run --rm authelia/authelia:4.39.28 authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 48 --random.charset alphanumeric`), put the digest in `.secrets/oidc-client-secret.digest`, put the plain value in the Mise server env, then recreate Authelia (`docker compose up -d --force-recreate authelia`) and restart Mise. Production uses `.secrets/`; `scripts/setup.sh` and `secrets/` are for the dev stack only.
- Note date, device, actions taken.

## Optional: passkeys (not enabled in P0)

Only if passkeys are later enabled (`MISE_AUTH_WEBAUTHN_DISABLE=false`, passkey + password path). List with
`authelia storage user webauthn list <user>`; remove one with `authelia storage user webauthn delete <user> --kid <KID>`
(`--all` and `--description` also exist, per `--help`; **not drilled**). Remove the lost passkey even if the device is "only"
lost, and remove it on the vendor side too if it was cloud-synced (Apple/Google account). Then register a replacement in the portal.

## What this does not cover

- Loss of the Mise host or its backups (ADR-009 restore procedure).
