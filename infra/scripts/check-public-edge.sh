#!/usr/bin/env bash
# Public edge probe (A19, AC-11 unauthenticated part, NFR-01 headers). Run it from OUTSIDE the home
# network (e.g. a laptop on a phone hotspot) after every deploy and nginx change. It sends no
# credentials and creates nothing: every request is unauthenticated or uses a forged cookie.
# Usage: check-public-edge.sh <mise-origin> <auth-origin> [public-ip]
#   e.g. check-public-edge.sh https://mise.mydomain.com https://auth.mydomain.com 203.0.113.5
# With [public-ip], also checks that the app, Authelia and Postgres ports are closed from outside.
# Exit 0 and "EDGE OK" only if every check passed.
set -uo pipefail

mise="${1:-}"
auth="${2:-}"
public_ip="${3:-}"
case "$mise$auth" in https://*https://*) ;; *) echo "usage: $0 <https mise origin> <https auth origin> [public-ip]" >&2; exit 64 ;; esac
host="${mise#https://}"
failed=0
pass() { echo "ok    $1"; }
fail() { echo "FAIL  $1"; failed=1; }
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
headers() { curl -s -D - -o /dev/null --max-time 10 "$@" | tr -d '\r'; }
has_header() { grep -qi "^$1: $2" <<<"$3"; }

# 1. Plain HTTP only redirects to HTTPS.
loc="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "http://$host/api/v1/recipes")"
[[ "$loc" == "301 https://$host/api/v1/recipes" ]] && pass "http redirects to https" || fail "http redirect: got '$loc'"

# 2. Old TLS versions are refused.
if command -v openssl >/dev/null && openssl s_client -help 2>&1 | grep -q -- '-tls1_1'; then
  if echo | timeout 10 openssl s_client -tls1_1 -connect "$host:443" -servername "$host" 2>&1 | grep -q 'BEGIN CERTIFICATE\|Cipher is [A-Z0-9]'; then
    fail "TLS 1.1 accepted"
  else pass "TLS 1.1 refused"; fi
else
  echo "skip  TLS 1.1 check (local openssl cannot offer TLS 1.1; check with SSL Labs or testssl.sh)"
fi

# 3. Security headers on the SPA shell.
h="$(headers "$mise/")"
for want in \
  "strict-transport-security|max-age=31536000" \
  "content-security-policy|default-src 'self'" \
  "x-content-type-options|nosniff" \
  "x-frame-options|DENY" \
  "referrer-policy|no-referrer"; do
  name="${want%%|*}"; value="${want#*|}"
  has_header "$name" "$value" "$h" && pass "header $name" || fail "header $name missing or wrong"
done
[ "$(grep -ci '^strict-transport-security:' <<<"$h")" = 1 ] && pass "HSTS sent once" || fail "HSTS missing or duplicated"
grep -qi '^x-powered-by:' <<<"$h" && fail "x-powered-by present" || pass "no x-powered-by"
grep -Eqi '^server: nginx/[0-9]' <<<"$h" && fail "nginx version disclosed" || pass "no server version"

# 4. AC-11: no household data without a valid session (also with a forged cookie).
for path in /api/v1/recipes /api/v1/shopping-lists /api/v1/shopping-categories /api/v1/household/members \
  /api/v1/auth/devices /api/v1/auth/me /api/v1/recipes/export /api/v1/does-not-exist; do
  s="$(status "$mise$path")"
  [ "$s" = 401 ] && pass "401 $path" || fail "$path without session: $s"
  s="$(status -H 'Cookie: __Host-mise_session=forged-token-value' "$mise$path")"
  [ "$s" = 401 ] && pass "401 $path (forged cookie)" || fail "$path with forged cookie: $s"
done
s="$(status -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example' --data '{}' "$mise/api/v1/recipes")"
[[ "$s" = 401 || "$s" = 403 ]] && pass "cross-site POST refused ($s)" || fail "cross-site POST: $s"
s="$(status -H 'Accept: text/event-stream' "$mise/api/v1/shopping-lists/00000000-0000-4000-8000-000000000000/events")"
[ "$s" = 401 ] && pass "401 SSE without session" || fail "SSE without session: $s"

# 5. Health stays minimal; Authelia forward-auth is not public.
body="$(curl -s --max-time 10 "$mise/api/v1/health/ready")"
[[ "$body" =~ ^\{\"status\":\"[a-z]+\"\}$ ]] && pass "health/ready minimal" || fail "health/ready body: $body"
s="$(status "$auth/api/authz/forward-auth")"
[ "$s" = 404 ] && pass "authelia /api/authz blocked" || fail "authelia /api/authz: $s"

# 6. Upstream and database ports closed from the internet.
if [ -n "$public_ip" ]; then
  for port in 3000 5432 9091; do
    if timeout 5 bash -c "exec 3<>/dev/tcp/$public_ip/$port" 2>/dev/null; then fail "port $port open on $public_ip"; else pass "port $port closed"; fi
  done
fi

[ "$failed" = 0 ] && { echo "EDGE OK"; exit 0; } || { echo "EDGE FAILED"; exit 1; }
