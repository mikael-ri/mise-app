import { describe, expect, it } from 'vitest';
import {
  LOGIN_STATE_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  clearCookie,
  loginStateKey,
  newSessionToken,
  openLoginState,
  readCookie,
  sealLoginState,
  serializeCookie,
  sessionTokenDigest,
} from './cookies.js';

describe('session tokens (NFR-01)', () => {
  it('are 256-bit base64url values with a 32-byte SHA-256 digest', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(sessionTokenDigest(t)).toHaveLength(32);
    expect(sessionTokenDigest(t)!.toString('base64url')).not.toBe(t);
  });

  it('are unique', () => {
    const set = new Set(Array.from({ length: 1000 }, newSessionToken));
    expect(set.size).toBe(1000);
  });

  it.each(['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}.`])(
    'refuse to digest a malformed token %j',
    (v) => expect(sessionTokenDigest(v)).toBeNull(),
  );
});

describe('cookies', () => {
  it('reads one named cookie from a header', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`, SESSION_COOKIE)).toBe('tok');
    expect(readCookie('mise_session=tok', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });

  it('serialises __Host- cookies as Secure, HttpOnly, Path=/, SameSite=Lax, no Domain', () => {
    const c = serializeCookie(SESSION_COOKIE, 'v', { maxAgeSeconds: 10 });
    expect(c).toBe(`${SESSION_COOKIE}=v; Path=/; Max-Age=10; HttpOnly; Secure; SameSite=Lax`);
    expect(c).not.toMatch(/Domain=/i);
    expect(clearCookie(SESSION_COOKIE)).toContain('Max-Age=0');
  });
});

describe('login state cookie', () => {
  const key = loginStateKey('k'.repeat(32));
  const state = {
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    codeVerifier: 'v'.repeat(64),
    startedAt: 1_000_000,
    returnTo: '/recipes',
  };

  it('round-trips within its lifetime', () => {
    expect(openLoginState(key, sealLoginState(key, state), 1_000_000 + 5_000)).toEqual(state);
  });

  it('is refused after its lifetime or from the future', () => {
    const sealed = sealLoginState(key, state);
    const limit = LOGIN_STATE_MAX_AGE_SECONDS * 1000;
    expect(openLoginState(key, sealed, 1_000_000 + limit + 1)).toBeNull();
    expect(openLoginState(key, sealed, 999_000)).toBeNull();
  });

  it('is refused when tampered, sealed with another key, or missing', () => {
    const sealed = sealLoginState(key, state);
    const flipped = Buffer.from(sealed, 'base64url');
    const last = flipped.length - 1;
    flipped.writeUInt8(flipped.readUInt8(last) ^ 1, last);
    expect(openLoginState(key, flipped.toString('base64url'), 1_000_001)).toBeNull();
    expect(openLoginState(loginStateKey('x'.repeat(32)), sealed, 1_000_001)).toBeNull();
    expect(openLoginState(key, undefined, 1_000_001)).toBeNull();
    expect(openLoginState(key, 'not base64!', 1_000_001)).toBeNull();
  });

  it('does not reveal the verifier or nonce in the cookie value', () => {
    const sealed = sealLoginState(key, state);
    expect(Buffer.from(sealed, 'base64url').toString('latin1')).not.toContain('vvvv');
  });
});
