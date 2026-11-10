#!/usr/bin/env bash
# DEV ONLY. Creates a throwaway CA + certs for auth/mise.mydomain.test and renders the production nginx
# configs from ./nginx into ./tls/nginx with dev values, so the dev proxy tests the same files you deploy.
# Output (all gitignored): ./tls/ca.pem, ./tls/{cert,key}.pem, ./tls/nginx/*
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
D="${DEV_DOMAIN:-mydomain.test}"
mkdir -p tls/nginx/conf.d tls/nginx/snippets

if [ ! -f tls/ca.pem ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 30 -subj "/CN=mise-spike-dev-ca" \
    -keyout tls/ca.key -out tls/ca.pem 2>/dev/null
  openssl req -newkey rsa:3072 -nodes -subj "/CN=auth.$D" -keyout tls/key.pem -out tls/req.csr 2>/dev/null
  printf 'subjectAltName=DNS:auth.%s,DNS:mise.%s\nextendedKeyUsage=serverAuth\n' "$D" "$D" >tls/ext.cnf
  openssl x509 -req -in tls/req.csr -CA tls/ca.pem -CAkey tls/ca.key -CAcreateserial -days 30 \
    -extfile tls/ext.cnf -out tls/cert.pem 2>/dev/null
  chmod 644 tls/ca.pem tls/cert.pem tls/key.pem # read by the nginx container user
  echo "created dev CA and certificate (30 days)"
fi

render() { # render <src> <dst>
  sed -e "s/mydomain\.com/$D/g" \
    -e 's|@TLS_CERT@|/etc/nginx/tls/cert.pem|; s|@TLS_KEY@|/etc/nginx/tls/key.pem|' \
    -e 's|@AUTHELIA_UPSTREAM@|authelia:9091|; s|@MISE_UPSTREAM@|127.0.0.1:3000|' "$1" >"$2"
}
render "nginx/auth.mydomain.com.conf" "tls/nginx/conf.d/auth.conf"
render "nginx/mise.mydomain.com.conf" "tls/nginx/conf.d/mise.conf"
render "nginx/authelia-proxy.conf" "tls/nginx/snippets/authelia-proxy.conf"
render "nginx/mise-proxy.conf" "tls/nginx/snippets/mise-proxy.conf"
echo "rendered nginx config for *.$D into tls/nginx"
