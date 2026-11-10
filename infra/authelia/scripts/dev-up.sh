#!/usr/bin/env bash
# DEV ONLY: brings up Authelia + a dev nginx for the spike with *.mydomain.test values.
# Usage: scripts/dev-up.sh [up|down|logs|ps]   (default: up)
set -euo pipefail
cd "$(dirname "$0")/.."
export MISE_COOKIE_DOMAIN=mydomain.test
export MISE_AUTH_PUBLIC_URL=https://auth.mydomain.test:9443
export MISE_AUTH_PUBLIC_HOST=auth.mydomain.test
export MISE_OIDC_REDIRECT_URI="${MISE_OIDC_REDIRECT_URI:-http://localhost:8765/callback}"
export AUTHELIA_UID="$(id -u)" AUTHELIA_GID="$(id -g)"
# Dev overrides for the session spike; the ADR-003 addendum records the values chosen for production.
export MISE_AUTH_SSO_EXPIRATION="${MISE_AUTH_SSO_EXPIRATION:-1h}"
export MISE_AUTH_SSO_INACTIVITY="${MISE_AUTH_SSO_INACTIVITY:-15m}"
export MISE_AUTH_SSO_REMEMBER_ME="${MISE_AUTH_SSO_REMEMBER_ME:--1}"
cmd="${1:-up}"
case "$cmd" in
  up) cp -f configuration.example.yml configuration.yml
      ./scripts/validate-config.sh >/dev/null
      docker compose -f compose.yaml -f compose.dev.yaml up -d ;;
  *) docker compose -f compose.yaml -f compose.dev.yaml "$cmd" ;;
esac
