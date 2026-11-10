// Spike A03: what `issuer` and endpoint URLs does Authelia advertise on each path? (tech section 16.1 item 2)
// Usage: node infra/authelia/spike/probe-issuer.ts
import { request } from './http.ts';

const PUBLIC = 'https://auth.mydomain.test:9443';
const INTERNAL = 'http://127.0.0.1:9091';
const WK = '/.well-known/openid-configuration';

interface Disco {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
}

async function show(
  label: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const r = await request(url, { headers });
  let d: Disco = {};
  try {
    d = JSON.parse(r.body) as Disco;
  } catch {
    /* non-JSON */
  }
  console.log(
    `${label}\n  status=${r.status} issuer=${d.issuer} token=${d.token_endpoint} jwks=${d.jwks_uri}`,
  );
}

await show('public via proxy', PUBLIC + WK);
await show('internal, no forwarded headers', INTERNAL + WK);
await show('internal, X-Forwarded-Proto/Host = public', INTERNAL + WK, {
  'X-Forwarded-Proto': 'https',
  'X-Forwarded-Host': 'auth.mydomain.test:9443',
});
await show('internal, X-Forwarded-Host without port', INTERNAL + WK, {
  'X-Forwarded-Proto': 'https',
  'X-Forwarded-Host': 'auth.mydomain.test',
});
