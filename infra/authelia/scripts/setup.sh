#!/usr/bin/env bash
# Generates local secrets, a user file and (optionally) a dev TLS CA for the Authelia stack.
# Output goes to ./secrets, ./data, ./users.yml, ./configuration.yml and ./tls: all gitignored.
# Usage: scripts/setup.sh [--dev-tls <auth-host> <app-host>]
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="authelia/authelia:4.39.28"
umask 077
mkdir -p secrets data
chmod 700 secrets
[ -f configuration.yml ] || cp configuration.example.yml configuration.yml

rand() { docker run --rm "$IMAGE" authelia crypto rand --length "$1" --charset alphanumeric | sed 's/^Random Value: //'; }

gen() { # gen <file> <length>
  [ -f "secrets/$1" ] && return 0
  rand "$2" | tr -d '\n' >"secrets/$1"
  echo "created secrets/$1"
}
gen session-secret 64
gen storage-encryption-key 64
gen oidc-hmac-secret 64

if [ ! -f secrets/oidc-jwks-rsa.pem ]; then
  docker run --rm -v "$PWD/secrets:/out" -u "$(id -u):$(id -g)" "$IMAGE" \
    authelia crypto pair rsa generate --bits 4096 --directory /out >/dev/null
  mv secrets/private.pem secrets/oidc-jwks-rsa.pem
  rm -f secrets/public.pem
  echo "created secrets/oidc-jwks-rsa.pem"
fi

if [ ! -f secrets/oidc-client-secret.digest ]; then
  out=$(docker run --rm "$IMAGE" authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 48 --random.charset alphanumeric)
  echo "$out" | sed -n 's/^Random Password: //p' >secrets/oidc-client-secret.plain
  echo "$out" | sed -n 's/^Digest: //p' | tr -d '\n' >secrets/oidc-client-secret.digest
  echo "created secrets/oidc-client-secret.{plain,digest} (plain goes to the Mise server env only)"
fi

chmod 600 secrets/* 2>/dev/null || true
[ -f users.yml ] || {
  echo "users.yml missing: copy users.example.yml and replace the digest (see README)." >&2
}
