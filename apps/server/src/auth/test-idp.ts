// Test-only fake OIDC provider (ADR-003 addendum D6): an RSA key, its JWKS, an ID-token signer and a
// `fetch` stand-in for discovery, JWKS and token endpoints. Never imported by production code.
import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Jwks } from './oidc.js';

export const TEST_ISSUER = 'https://auth.mise.test';
export const TEST_INTERNAL = 'http://authelia.internal:9091';
export const TEST_CLIENT_ID = 'mise';
export const TEST_CLIENT_SECRET = 'test-client-secret';

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Jwks['keys'][number];
}

export function makeKey(kid = 'k1'): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwks['keys'][number]), kid, use: 'sig' };
  return { kid, privateKey, jwk };
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function signToken(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const h = b64({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const p = b64(claims);
  const s = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}

export interface FakeIdpCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Fake Authelia. `nextIdToken` decides what the token endpoint returns for the next code; tests
 * build it from the nonce the app sent in the authorization URL.
 */
export class FakeIdp {
  readonly key = makeKey();
  readonly calls: FakeIdpCall[] = [];
  tokenStatus = 200;
  nextIdToken: (code: string) => string = () => 'not-set';

  readonly fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
    this.calls.push({ url, headers, body });
    if (url === `${TEST_INTERNAL}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: TEST_ISSUER,
        authorization_endpoint: `${TEST_ISSUER}/api/oidc/authorization`,
        token_endpoint: `${TEST_ISSUER}/api/oidc/token`,
        jwks_uri: `${TEST_ISSUER}/jwks.json`,
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url === `${TEST_INTERNAL}/jwks.json`) return Response.json({ keys: [this.key.jwk] });
    if (url === `${TEST_INTERNAL}/api/oidc/token`) {
      if (this.tokenStatus !== 200) {
        return Response.json({ error: 'invalid_grant' }, { status: this.tokenStatus });
      }
      const code = new URLSearchParams(body).get('code') ?? '';
      return Response.json({
        access_token: 'at',
        token_type: 'bearer',
        id_token: this.nextIdToken(code),
      });
    }
    return new Response('not found', { status: 404 });
  };

  /** A valid ID token for `subject` with the given nonce and auth_time (epoch seconds). */
  idToken(
    subject: string,
    nonce: string,
    authTime: number | undefined,
    overrides: Record<string, unknown> = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return signToken(this.key, {
      iss: TEST_ISSUER,
      sub: subject,
      aud: [TEST_CLIENT_ID],
      exp: now + 300,
      iat: now,
      nonce,
      ...(authTime === undefined ? {} : { auth_time: authTime }),
      amr: ['pwd', 'otp', 'mfa'],
      ...overrides,
    });
  }
}
