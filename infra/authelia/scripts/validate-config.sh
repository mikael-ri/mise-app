#!/usr/bin/env bash
# Validates ./configuration.yml with the pinned Authelia image, using the same env as compose.yaml.
# Usage: [SECRETS_DIR=secrets] scripts/validate-config.sh   (reads MISE_*/AUTHELIA_* from the current environment, with the same defaults)
set -euo pipefail
cd "$(dirname "$0")/.."
S="${SECRETS_DIR:-.secrets}" # production default; scripts/dev-up.sh sets SECRETS_DIR=secrets
docker run --rm -u "$(id -u):$(id -g)" \
  -e X_AUTHELIA_CONFIG_FILTERS=template \
  -e MISE_COOKIE_DOMAIN="${MISE_COOKIE_DOMAIN:-mydomain.com}" \
  -e MISE_AUTH_PUBLIC_URL="${MISE_AUTH_PUBLIC_URL:-https://auth.mydomain.com}" \
  -e MISE_AUTH_PUBLIC_HOST="${MISE_AUTH_PUBLIC_HOST:-auth.mydomain.com}" \
  -e MISE_OIDC_REDIRECT_URI="${MISE_OIDC_REDIRECT_URI:-https://mise.mydomain.com/auth/callback}" \
  -e MISE_AUTH_SSO_EXPIRATION="${MISE_AUTH_SSO_EXPIRATION:-15m}" \
  -e MISE_AUTH_SSO_INACTIVITY="${MISE_AUTH_SSO_INACTIVITY:-15m}" \
  -e MISE_AUTH_WEBAUTHN_DISABLE="${MISE_AUTH_WEBAUTHN_DISABLE:-true}" \
  -e MISE_AUTH_SSO_REMEMBER_ME="${MISE_AUTH_SSO_REMEMBER_ME:--1}" \
  -e AUTHELIA_SESSION_SECRET_FILE=/run/secrets/session-secret \
  -e AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE=/run/secrets/storage-encryption-key \
  -e AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET_FILE=/run/secrets/oidc-hmac-secret \
  -v "$PWD/configuration.yml:/config/configuration.yml:ro" \
  -v "$PWD/users.yml:/config/users.yml:ro" \
  -v "$PWD/$S/session-secret:/run/secrets/session-secret:ro" \
  -v "$PWD/$S/storage-encryption-key:/run/secrets/storage-encryption-key:ro" \
  -v "$PWD/$S/oidc-hmac-secret:/run/secrets/oidc-hmac-secret:ro" \
  -v "$PWD/$S/oidc-jwks-rsa.pem:/run/secrets/oidc-jwks-rsa:ro" \
  -v "$PWD/$S/oidc-client-secret.digest:/run/secrets/oidc-client-secret:ro" \
  -v "$PWD/$S/postgres_pw:/run/secrets/pg_password:ro" \
  authelia/authelia:4.39.28 authelia validate-config --config /config/configuration.yml
