import { describe, expect, it } from 'vitest';
import { createIdpClient } from './idp.js';
import { OidcError } from './oidc.js';
import {
  FakeIdp,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_INTERNAL,
  TEST_ISSUER,
} from './test-idp.js';

const oidc = {
  issuer: TEST_ISSUER,
  internalUrl: TEST_INTERNAL,
  clientId: TEST_CLIENT_ID,
  clientSecret: TEST_CLIENT_SECRET,
  postLoginLogoutUrl: `${TEST_ISSUER}/logout`,
};

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof OidcError) return e.reason;
    throw e;
  }
}

describe('IdP client (ADR-012 addendum)', () => {
  it('discovers over the internal URL with forwarded headers and maps server endpoints inward', async () => {
    const idp = new FakeIdp();
    const ep = await createIdpClient(oidc, idp.fetch).endpoints();
    expect(ep).toEqual({
      authorizationEndpoint: `${TEST_ISSUER}/api/oidc/authorization`,
      tokenEndpoint: `${TEST_INTERNAL}/api/oidc/token`,
      jwksUri: `${TEST_INTERNAL}/jwks.json`,
      issParameterRequired: true,
    });
    expect(idp.calls[0]?.headers).toMatchObject({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'auth.mise.test',
    });
  });

  it('refuses discovery that reports another issuer or off-issuer endpoints', async () => {
    const wrongIssuer = async () =>
      Response.json({
        issuer: 'https://evil.test',
        authorization_endpoint: 'https://evil.test/a',
        token_endpoint: 'https://evil.test/t',
        jwks_uri: 'https://evil.test/j',
      });
    expect(await reason(createIdpClient(oidc, wrongIssuer).endpoints())).toBe('discovery_failed');
    const offIssuer = async () =>
      Response.json({
        issuer: TEST_ISSUER,
        authorization_endpoint: `${TEST_ISSUER}/a`,
        token_endpoint: 'https://evil.test/t',
        jwks_uri: `${TEST_ISSUER}/j`,
      });
    expect(await reason(createIdpClient(oidc, offIssuer).endpoints())).toBe('discovery_failed');
  });

  it('retries discovery after a failure instead of caching it', async () => {
    const idp = new FakeIdp();
    let fail = true;
    const flaky = async (url: string, init?: RequestInit) => {
      if (fail) throw new Error('ECONNREFUSED');
      return idp.fetch(url, init);
    };
    const client = createIdpClient(oidc, flaky);
    expect(await reason(client.endpoints())).toBe('discovery_failed');
    fail = false;
    expect(await reason(client.endpoints())).toBe('ok');
  });

  it('exchanges the code with client_secret_basic and the PKCE verifier', async () => {
    const idp = new FakeIdp();
    idp.nextIdToken = (code) => `id-token-for-${code}`;
    const token = await createIdpClient(oidc, idp.fetch).exchangeCode(
      'abc',
      'verifier',
      'https://mise.test/cb',
    );
    expect(token).toBe('id-token-for-abc');
    const call = idp.calls.find((c) => c.url.endsWith('/api/oidc/token'))!;
    expect(call.headers['authorization']).toBe(
      `Basic ${Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(Object.fromEntries(new URLSearchParams(call.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: 'https://mise.test/cb',
      code_verifier: 'verifier',
    });
  });

  it('fails the exchange on an error status', async () => {
    const idp = new FakeIdp();
    idp.tokenStatus = 400;
    expect(await reason(createIdpClient(oidc, idp.fetch).exchangeCode('c', 'v', 'r'))).toBe(
      'token_exchange_failed',
    );
  });

  it('caches JWKS and throttles forced refetches to one per minute', async () => {
    const idp = new FakeIdp();
    let t = 0;
    const client = createIdpClient(oidc, idp.fetch, () => t);
    const jwksCalls = () => idp.calls.filter((c) => c.url.endsWith('/jwks.json')).length;
    await client.jwks();
    await client.jwks();
    await client.jwks(true);
    expect(jwksCalls()).toBe(1);
    t = 60_000;
    await client.jwks(true);
    expect(jwksCalls()).toBe(2);
    t = 60_000 + 3_600_000; // TTL: removed keys stop being trusted
    await client.jwks();
    expect(jwksCalls()).toBe(3);
  });
});
