# A03 — Spike: Authelia OIDC and sessions

**Depends on:** A00 · **Size:** L · **Model tier:** Strong (human-led, agent assists)
**Covers:** ADR-003 and ADR-012 gate; NFR-01, AC-11
**Read only:** tech §12 (Authentication), §16.1 item 2; DB §3, §19; spec NFR-01, AC-11

## Goal
Verify the real behaviour of your Authelia version. This is the riskiest assumption in the milestone.

## Do
- Run Authelia as its own Docker Compose stack on the Mise host; create an OIDC client for a throwaway relying-party script.
- Verify issuer/network handling: tokens and keys via the internal URL, `iss` validated against the public issuer.
- Verify both login methods (passkey with user verification; password + TOTP) satisfy the intended policy without weakening `two_factor` or using experimental exceptions.
- Verify `max_age=0` is honoured and `auth_time` appears in the ID token.
- Verify that after a Mise session is revoked, a live Authelia SSO session cannot silently re-issue access (test both methods).
- Check Remember Me and session-lifetime options that do not break the passkey flow; decide idle and absolute lifetimes.
- Draft the lost-device recovery procedure (Mise sessions, Authelia sessions, compromised passkey).
- Decide E2E strategy: real Authelia in tests or a test identity provider.

## Not in scope
- Production Mise code. No break-glass or bypass mechanism.

## Done when
- Addendum to ADR-003 with evidence for every behaviour above and the enabled method(s). If passkey cannot be verified, the fallback is password + TOTP (tech §12).
- Working example config in `infra/authelia/` (no secrets) and a draft `docs/runbooks/lost-device-recovery.md`.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
