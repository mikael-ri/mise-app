// Spike A03: unit tests for the throwaway relying-party's ID-token validation (NFR-01, AC-11).
// The real Mise implementation (card A07) must meet the same cases.
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateIdToken, type Jwks, type ValidationInput } from './oidc.ts';

const ISSUER = 'https://auth.mydomain.test:9443';
const CLIENT = 'mise';
const NOW = 1_800_000_000;
const REQUEST_STARTED = NOW - 20;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks: Jwks = {
  keys: [
    {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'k1',
      use: 'sig',
      alg: 'RS256',
    },
  ],
};

const b64 = (v: unknown) =>
  Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function mint(
  claims: Record<string, unknown>,
  opts: { header?: Record<string, unknown>; key?: typeof privateKey } = {},
): string {
  const header = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...opts.header };
  const body = {
    iss: ISSUER,
    aud: [CLIENT],
    sub: 'user-uuid-1',
    nonce: 'n-1',
    iat: NOW - 10,
    exp: NOW + 290,
    auth_time: NOW - 5,
    ...claims,
  };
  const data = `${b64(header)}.${b64(body)}`;
  const sig = sign('RSA-SHA256', Buffer.from(data), opts.key ?? privateKey).toString('base64url');
  return `${data}.${sig}`;
}

const input = (token: string, over: Partial<ValidationInput> = {}): ValidationInput => ({
  token,
  jwks,
  expectedIssuer: ISSUER,
  clientId: CLIENT,
  nonce: 'n-1',
  now: NOW,
  authRequestStartedAt: REQUEST_STARTED,
  ...over,
});

describe('validateIdToken (NFR-01, AC-11)', () => {
  it('accepts a correct token and returns claims incl. auth_time', () => {
    const claims = validateIdToken(input(mint({})));
    expect(claims.sub).toBe('user-uuid-1');
    expect(claims.auth_time).toBe(NOW - 5);
  });

  it('AC-11: rejects a token without auth_time (no freshness evidence)', () => {
    const t = mint({ auth_time: undefined });
    expect(() => validateIdToken(input(t))).toThrow(/auth_time/);
  });

  it('AC-11: rejects stale auth_time older than the authorization request (SSO reuse)', () => {
    const t = mint({ auth_time: REQUEST_STARTED - 3600 });
    expect(() => validateIdToken(input(t))).toThrow(/stale/);
  });

  it('AC-11: rejects a non-numeric auth_time', () => {
    expect(() => validateIdToken(input(mint({ auth_time: '1799999995' })))).toThrow(/auth_time/);
  });

  it('rejects a wrong issuer (internal URL leaked into iss)', () => {
    expect(() => validateIdToken(input(mint({ iss: 'http://127.0.0.1:9091' })))).toThrow(/iss/);
  });

  it('rejects issuer with a trailing slash or different case (exact match only)', () => {
    expect(() => validateIdToken(input(mint({ iss: `${ISSUER}/` })))).toThrow(/iss/);
  });

  it('rejects a wrong audience', () => {
    expect(() => validateIdToken(input(mint({ aud: ['other'] })))).toThrow(/aud/);
  });

  it('rejects multiple audiences unless azp equals the client', () => {
    expect(() => validateIdToken(input(mint({ aud: [CLIENT, 'x'] })))).toThrow(/azp/);
    expect(validateIdToken(input(mint({ aud: [CLIENT, 'x'], azp: CLIENT }))).sub).toBe(
      'user-uuid-1',
    );
  });

  it('rejects a replayed or wrong nonce', () => {
    expect(() => validateIdToken(input(mint({ nonce: 'old' })))).toThrow(/nonce/);
  });

  it('rejects an expired token', () => {
    expect(() => validateIdToken(input(mint({ exp: NOW - 120 })))).toThrow(/exp/);
  });

  it('rejects a token signed by another key', () => {
    expect(() => validateIdToken(input(mint({}, { key: other.privateKey })))).toThrow(/signature/);
  });

  it('rejects alg=none and HS256 downgrade', () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: ISSUER, aud: [CLIENT], sub: 's', nonce: 'n-1', exp: NOW + 100, auth_time: NOW })}.`;
    expect(() => validateIdToken(input(none))).toThrow(/alg/);
    expect(() => validateIdToken(input(mint({}, { header: { alg: 'HS256' } })))).toThrow(/alg/);
  });

  it('rejects an unknown kid', () => {
    expect(() => validateIdToken(input(mint({}, { header: { kid: 'nope' } })))).toThrow(/kid/);
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = mint({}).split('.');
    const forged = `${h}.${b64({ iss: ISSUER, aud: [CLIENT], sub: 'attacker', nonce: 'n-1', exp: NOW + 100, auth_time: NOW })}.${s}`;
    expect(() => validateIdToken(input(forged))).toThrow(/signature/);
  });

  it('rejects malformed tokens', () => {
    expect(() => validateIdToken(input('abc'))).toThrow(/malformed/);
  });
});
