import { describe, expect, it } from 'vitest';
import { OidcError, buildAuthorizationUrl, pkceChallenge, validateIdToken } from './oidc.js';
import type { IdTokenCheck } from './oidc.js';
import { TEST_CLIENT_ID, TEST_ISSUER, makeKey, signToken } from './test-idp.js';

const key = makeKey('k1');
const otherKey = makeKey('k1'); // same kid, different key material
const NOW = 1_800_000_000;
const STARTED = NOW - 30;

function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TEST_ISSUER,
    sub: 'alice',
    aud: [TEST_CLIENT_ID],
    exp: NOW + 300,
    iat: NOW - 1,
    nonce: 'n-123',
    auth_time: NOW - 10,
    ...over,
  };
}

function check(token: string, over: Partial<IdTokenCheck> = {}): IdTokenCheck {
  return {
    token,
    jwks: { keys: [key.jwk] },
    issuer: TEST_ISSUER,
    clientId: TEST_CLIENT_ID,
    nonce: 'n-123',
    now: NOW,
    loginStartedAt: STARTED,
    ...over,
  };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof OidcError) return e.reason;
    throw e;
  }
  return 'accepted';
}

const without = (k: string) => {
  const c = claims();
  delete c[k];
  return c;
};

describe('validateIdToken (NFR-01, AC-11)', () => {
  it('accepts a valid, fresh token and returns subject and auth_time', () => {
    expect(validateIdToken(check(signToken(key, claims())))).toEqual({
      subject: 'alice',
      authTime: NOW - 10,
    });
  });

  it('ignores amr: a token claiming mfa is still judged only by auth_time', () => {
    const t = signToken(key, claims({ amr: ['mfa'], auth_time: STARTED - 3600 }));
    expect(reason(() => validateIdToken(check(t)))).toBe('auth_time_stale');
  });

  it.each<[string, () => string, Partial<IdTokenCheck>, string]>([
    ['garbage', () => 'abc', {}, 'token_malformed'],
    [
      'empty signature',
      () => signToken(key, claims()).replace(/\.[^.]+$/, '.'),
      {},
      'token_malformed',
    ],
    ['alg none', () => signToken(key, claims(), { alg: 'none' }), {}, 'alg_unsupported'],
    ['alg HS256', () => signToken(key, claims(), { alg: 'HS256' }), {}, 'alg_unsupported'],
    ['unknown kid', () => signToken(key, claims(), { kid: 'other' }), {}, 'kid_unknown'],
    ['wrong key, same kid', () => signToken(otherKey, claims()), {}, 'signature_invalid'],
    [
      'tampered payload',
      () => {
        const [h, , s] = signToken(key, claims()).split('.');
        const p = Buffer.from(JSON.stringify(claims({ sub: 'mallory' }))).toString('base64url');
        return `${h}.${p}.${s}`;
      },
      {},
      'signature_invalid',
    ],
    [
      'wrong issuer',
      () => signToken(key, claims({ iss: 'https://evil.test' })),
      {},
      'iss_mismatch',
    ],
    [
      'internal issuer (ADR-012)',
      () => signToken(key, claims({ iss: 'http://authelia.internal:9091' })),
      {},
      'iss_mismatch',
    ],
    ['wrong audience', () => signToken(key, claims({ aud: ['other'] })), {}, 'aud_mismatch'],
    [
      'multiple audiences without azp',
      () => signToken(key, claims({ aud: [TEST_CLIENT_ID, 'other'] })),
      {},
      'azp_mismatch',
    ],
    ['foreign azp', () => signToken(key, claims({ azp: 'other' })), {}, 'azp_mismatch'],
    ['expired', () => signToken(key, claims({ exp: NOW - 6 })), {}, 'expired'],
    ['exp missing', () => signToken(key, without('exp')), {}, 'expired'],
    ['nbf in the future', () => signToken(key, claims({ nbf: NOW + 60 })), {}, 'not_yet_valid'],
    ['iat missing', () => signToken(key, without('iat')), {}, 'iat_invalid'],
    ['iat in the future', () => signToken(key, claims({ iat: NOW + 60 })), {}, 'iat_invalid'],
    ['sub missing', () => signToken(key, without('sub')), {}, 'sub_missing'],
    ['nonce mismatch', () => signToken(key, claims({ nonce: 'n-999' })), {}, 'nonce_mismatch'],
    ['nonce missing', () => signToken(key, without('nonce')), {}, 'nonce_mismatch'],
    [
      'auth_time missing (AC-11)',
      () => signToken(key, without('auth_time')),
      {},
      'auth_time_missing',
    ],
    [
      'auth_time as string',
      () => signToken(key, claims({ auth_time: String(NOW) })),
      {},
      'auth_time_missing',
    ],
    [
      'stale auth_time: silent SSO reuse (AC-11)',
      () => signToken(key, claims({ auth_time: STARTED - 6 })),
      {},
      'auth_time_stale',
    ],
    [
      'auth_time in the future',
      () => signToken(key, claims({ auth_time: NOW + 60 })),
      {},
      'auth_time_future',
    ],
    ['no keys published', () => signToken(key, claims()), { jwks: { keys: [] } }, 'kid_unknown'],
    [
      'key restricted to encryption',
      () => signToken(key, claims()),
      { jwks: { keys: [{ ...key.jwk, use: 'enc' }] } },
      'kid_unknown',
    ],
  ])('rejects %s', (_name, token, over, expected) => {
    expect(reason(() => validateIdToken(check(token(), over)))).toBe(expected);
  });

  it('accepts auth_time inside the 5 s skew before login start (ADR-003 addendum D3)', () => {
    const t = signToken(key, claims({ auth_time: STARTED - 5 }));
    expect(validateIdToken(check(t)).authTime).toBe(STARTED - 5);
  });

  it('accepts a matching azp with multiple audiences', () => {
    const t = signToken(key, claims({ aud: [TEST_CLIENT_ID, 'x'], azp: TEST_CLIENT_ID }));
    expect(validateIdToken(check(t)).subject).toBe('alice');
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests code + PKCE S256 with state, nonce and prompt=login, scope openid only', () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: `${TEST_ISSUER}/api/oidc/authorization`,
        clientId: TEST_CLIENT_ID,
        redirectUri: 'https://mise.test/api/v1/auth/oidc/callback',
        state: 'st',
        nonce: 'no',
        codeVerifier: 'verifier',
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: TEST_CLIENT_ID,
      redirect_uri: 'https://mise.test/api/v1/auth/oidc/callback',
      scope: 'openid',
      state: 'st',
      nonce: 'no',
      code_challenge: pkceChallenge('verifier'),
      code_challenge_method: 'S256',
      prompt: 'login',
    });
  });
});
