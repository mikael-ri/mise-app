// Fake OIDC provider for E2E (ADR-003 addendum D6), started as a Playwright `webServer`.
// Server side only: discovery, JWKS and token endpoints, answered by the same `FakeIdp` the server's own
// tests use. The browser-facing issuer URLs (authorization, logout) are not served here; the sign-in
// helper (`tests/support/auth.ts`) answers them inside the browser, so no DNS or TLS is needed.
//
// The authorization code is the subject and nonce, base64url-encoded by the helper; this server turns it
// into a signed ID token with a fresh `auth_time`. Test-only: never import it from production code.
import { createServer } from 'node:http';
import { FakeIdp, TEST_INTERNAL } from '../../apps/server/src/auth/test-idp.js';

const port = Number(process.env['FAKE_OIDC_PORT'] ?? 9099);
const idp = new FakeIdp();

idp.nextIdToken = (code) => {
  const { sub, nonce } = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as {
    sub: string;
    nonce: string;
  };
  return idp.idToken(sub, nonce, Math.floor(Date.now() / 1000));
};

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const init: RequestInit = { method: req.method ?? 'GET', headers };
    if (chunks.length > 0) init.body = Buffer.concat(chunks).toString('utf8');
    // FakeIdp answers for the internal URL the server would have used with real Authelia.
    void idp.fetch(`${TEST_INTERNAL}${req.url ?? '/'}`, init).then(async (r) => {
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' });
      res.end(await r.text());
    });
  });
});

server.listen(port, '127.0.0.1');
