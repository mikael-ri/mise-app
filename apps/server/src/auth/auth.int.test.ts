// AC-11 / NFR-01 against real PostgreSQL as the app role (shared test config, freshly migrated) and a fake OIDC provider
// (ADR-003 addendum D6). The real-Authelia suite stays a release gate (infra/authelia/spike).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DeviceSessionList, MeResponse } from '@mise/contracts';
import { buildApp } from '../app.js';
import { createHouseholdsService } from '../households/index.js';
import { CSRF_HEADER, createPool, createRateLimiter, issueCsrfToken } from '../platform/index.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import {
  LOGIN_STATE_COOKIE,
  SESSION_COOKIE,
  loginStateKey,
  sessionTokenDigest,
} from './cookies.js';
import { createIdpClient } from './idp.js';
import { createRevocationHub } from './revocation.js';
import { LOGIN_FAILED_PATH } from './routes.js';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  createAuthService,
  createOperatorService,
} from './service.js';
import {
  FakeIdp,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_INTERNAL,
  TEST_ISSUER,
} from './test-idp.js';

const pool = createPool(loadTestDatabaseConfig().appUrl, 4);
const DAY = 86_400_000;
const ORIGIN = testConfig.publicOrigin;
const LOGOUT_URL = `${TEST_ISSUER}/logout`;

const households = createHouseholdsService(pool);
const tag = randomUUID();
// Household A: Ann (owner) and Bob. Household B: Cat and Dan.
const subj = { ann: `ann-${tag}`, bob: `bob-${tag}`, cat: `cat-${tag}`, dan: `dan-${tag}` };
const memberIds: Record<string, string> = {};
const userIds: string[] = [];

let clockMs = Date.now();
const idp = new FakeIdp();
const revocations = createRevocationHub();
let app: FastifyInstance;

beforeAll(async () => {
  for (const [name, a, b] of [
    [`auth-a-${tag}`, 'ann', 'bob'],
    [`auth-b-${tag}`, 'cat', 'dan'],
  ] as const) {
    await households.provisionHousehold({
      name,
      members: [
        { oidcIssuer: TEST_ISSUER, oidcSubject: subj[a], displayName: a },
        { oidcIssuer: TEST_ISSUER, oidcSubject: subj[b], displayName: b },
      ],
    });
  }
  const { rows } = await pool.query<{ id: string; user_id: string; oidc_subject: string }>(
    `SELECT m.id, m.user_id, u.oidc_subject FROM household_members m JOIN users u ON u.id = m.user_id
      WHERE u.oidc_issuer = $1 AND u.oidc_subject LIKE $2`,
    [TEST_ISSUER, `%-${tag}`],
  );
  for (const r of rows) {
    memberIds[r.oidc_subject.split('-')[0]!] = r.id;
    userIds.push(r.user_id);
  }

  const oidc = {
    issuer: TEST_ISSUER,
    internalUrl: TEST_INTERNAL,
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    postLoginLogoutUrl: LOGOUT_URL,
  };
  app = buildApp({
    checkReady: async () => {},
    config: testConfig,
    auth: {
      service: createAuthService({
        pool,
        households,
        idp: createIdpClient(oidc, idp.fetch),
        revocations,
        oidc,
        publicOrigin: ORIGIN,
        csrfSecret: testConfig.csrfSecret,
        now: () => new Date(clockMs),
      }),
      publicOrigin: ORIGIN,
      postLoginLogoutUrl: LOGOUT_URL,
      loginStateKey: loginStateKey('int-test-session-secret-0123456789'),
      limiter: createRateLimiter({ windowMs: 60_000, max: 10_000 }),
      now: () => clockMs,
    },
  });
  app.get('/api/v1/household-data', async () => ({ secret: 'household data' }));
});

beforeEach(() => {
  clockMs = Date.now();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const sessionCount = async () =>
  Number(
    (
      await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM device_sessions WHERE user_id = ANY($1::uuid[])',
        [userIds],
      )
    ).rows[0]!.n,
  );

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const h = res.headers['set-cookie'];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
}

function cookieValue(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const c = setCookies(res).find((s) => s.startsWith(`${name}=`));
  return c?.slice(name.length + 1).split(';')[0];
}

interface LoginOptions {
  /** auth_time relative to the login start in seconds; `null` omits the claim. */
  authTimeOffset?: number | null;
  tokenOverrides?: Record<string, unknown>;
  iss?: string | null;
  stateOverride?: string;
  /** Session cookie the browser still holds when the callback arrives (re-login). */
  existingSession?: string;
}

/** Runs start + callback like a browser would. Returns the callback response and session token. */
async function login(subject: string, o: LoginOptions = {}) {
  const start = await app.inject({ url: '/api/v1/auth/oidc/start?returnTo=/plan' });
  expect(start.statusCode).toBe(302);
  const authz = new URL(String(start.headers.location));
  const state = authz.searchParams.get('state')!;
  const nonce = authz.searchParams.get('nonce')!;
  const loginState = cookieValue(start, LOGIN_STATE_COOKIE)!;
  const startedAt = Math.floor(clockMs / 1000);
  const offset = o.authTimeOffset === undefined ? 2 : o.authTimeOffset;
  idp.nextIdToken = () =>
    idp.idToken(subject, nonce, offset === null ? undefined : startedAt + offset, o.tokenOverrides);
  const q = new URLSearchParams({ code: randomUUID(), state: o.stateOverride ?? state });
  if (o.iss !== null) q.set('iss', o.iss ?? TEST_ISSUER);
  const cb = await app.inject({
    url: `/api/v1/auth/oidc/callback?${q.toString()}`,
    headers: {
      cookie: [`${LOGIN_STATE_COOKIE}=${loginState}`, o.existingSession]
        .filter((c) => c !== undefined)
        .join('; '),
      'user-agent': 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
    },
  });
  return { cb, token: cookieValue(cb, SESSION_COOKIE), authz };
}

async function signedIn(subject: string) {
  const { cb, token } = await login(subject);
  expect(cb.headers.location).not.toBe(LOGIN_FAILED_PATH);
  expect(token).toBeDefined();
  const cookie = `${SESSION_COOKIE}=${token!}`;
  const me = MeResponse.parse(
    (await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).json(),
  );
  const mutate = { cookie, origin: ORIGIN, [CSRF_HEADER]: me.csrfToken };
  return { token: token!, cookie, me, mutate };
}

const get = (path: string, cookie?: string) =>
  app.inject({ url: path, headers: cookie === undefined ? {} : { cookie } });

describe('AC-11: login creates a device session only on verified fresh authentication', () => {
  it('requests PKCE S256, state, nonce and prompt=login from the public issuer', async () => {
    const { authz } = await login(subj.ann);
    expect(authz.origin).toBe(TEST_ISSUER);
    expect(authz.searchParams.get('prompt')).toBe('login');
    expect(authz.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authz.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/oidc/callback`);
  });

  it('stores only a 32-byte digest, records auth_time, and returns /auth/me with a CSRF token', async () => {
    const before = await sessionCount();
    const { cb, token } = await login(subj.ann);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${LOGOUT_URL}?rd=${encodeURIComponent(`${ORIGIN}/plan`)}`);
    expect(await sessionCount()).toBe(before + 1);
    const { rows } = await pool.query<{
      id: string;
      token_hash: Buffer;
      authenticated_at: Date;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      created_at: Date;
    }>(
      'SELECT id, token_hash, authenticated_at, idle_expires_at, absolute_expires_at, created_at FROM device_sessions WHERE token_hash = $1',
      [sessionTokenDigest(token!)],
    );
    const row = rows[0]!;
    expect(row.token_hash).toHaveLength(32);
    expect(row.token_hash.toString('base64url')).not.toBe(token);
    expect(row.authenticated_at.getTime()).toBe((Math.floor(clockMs / 1000) + 2) * 1000);
    expect(row.idle_expires_at.getTime() - row.created_at.getTime()).toBe(SESSION_IDLE_MS);
    expect(row.absolute_expires_at.getTime() - row.created_at.getTime()).toBe(SESSION_ABSOLUTE_MS);
    const plain = await pool.query(
      'SELECT 1 FROM device_sessions WHERE encode(token_hash, $2) = $1',
      [token, 'escape'],
    );
    expect(plain.rowCount).toBe(0);

    const me = MeResponse.parse(
      (await get('/api/v1/auth/me', `${SESSION_COOKIE}=${token!}`)).json(),
    );
    expect(me.member.id).toBe(memberIds['ann']);
    expect(me.session.id).toBe(row.id);
    expect(me.csrfToken).toBe(issueCsrfToken(testConfig.csrfSecret, row.id));
  });

  it.each<[string, LoginOptions]>([
    ['stale auth_time: silent re-entry via a live Authelia SSO session', { authTimeOffset: -3600 }],
    ['auth_time just outside the 5 s window', { authTimeOffset: -6 }],
    ['missing auth_time', { authTimeOffset: null }],
    ['wrong nonce', { tokenOverrides: { nonce: 'other' } }],
    ['wrong audience', { tokenOverrides: { aud: ['someone-else'] } }],
    ['wrong issuer in the token', { tokenOverrides: { iss: TEST_INTERNAL } }],
    ['expired token', { tokenOverrides: { exp: Math.floor(Date.now() / 1000) - 60 } }],
    ['wrong iss callback parameter (mix-up)', { iss: 'https://evil.test' }],
    ['missing iss callback parameter although advertised', { iss: null }],
    ['state mismatch', { stateOverride: 'forged-state' }],
  ])('rejects %s and creates no session', async (_name, o) => {
    const before = await sessionCount();
    const { cb, token } = await login(subj.ann, o);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(token).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });

  it('rejects an unknown subject and an inactive user', async () => {
    const before = await sessionCount();
    expect((await login(`stranger-${tag}`)).cb.headers.location).toBe(LOGIN_FAILED_PATH);
    await pool.query('UPDATE users SET is_active = false WHERE oidc_subject = $1', [subj.dan]);
    try {
      expect((await login(subj.dan)).cb.headers.location).toBe(LOGIN_FAILED_PATH);
    } finally {
      await pool.query('UPDATE users SET is_active = true WHERE oidc_subject = $1', [subj.dan]);
    }
    expect(await sessionCount()).toBe(before);
  });

  it('rejects an expired login-state cookie (older than 10 minutes)', async () => {
    const start = await app.inject({ url: '/api/v1/auth/oidc/start' });
    const authz = new URL(String(start.headers.location));
    const nonce = authz.searchParams.get('nonce')!;
    idp.nextIdToken = () => idp.idToken(subj.ann, nonce, Math.floor(clockMs / 1000));
    clockMs += 601_000;
    const cb = await app.inject({
      url: `/api/v1/auth/oidc/callback?code=c&iss=${encodeURIComponent(TEST_ISSUER)}&state=${authz.searchParams.get('state')!}`,
      headers: { cookie: `${LOGIN_STATE_COOKIE}=${cookieValue(start, LOGIN_STATE_COOKIE)!}` },
    });
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
  });

  it('an IdP error response creates no session', async () => {
    const start = await app.inject({ url: '/api/v1/auth/oidc/start' });
    const state = new URL(String(start.headers.location)).searchParams.get('state')!;
    const cb = await app.inject({
      url: `/api/v1/auth/oidc/callback?error=access_denied&state=${state}`,
      headers: { cookie: `${LOGIN_STATE_COOKIE}=${cookieValue(start, LOGIN_STATE_COOKIE)!}` },
    });
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
  });
});

describe('AC-11: unauthenticated access is denied', () => {
  it('no cookie, a forged cookie or a bearer token cannot read household data', async () => {
    const { token } = await signedIn(subj.ann);
    expect((await get('/api/v1/household-data')).statusCode).toBe(401);
    expect(
      (await get('/api/v1/household-data', `${SESSION_COOKIE}=${'A'.repeat(43)}`)).statusCode,
    ).toBe(401);
    const bearer = await app.inject({
      url: '/api/v1/household-data',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearer.statusCode).toBe(401);
  });
});

describe('AC-11: revocation is immediate, per device and household-scoped', () => {
  it('the partner revokes a lost device; its next request fails and its SSE hook fires', async () => {
    const lost = await signedIn(subj.ann);
    const other = await signedIn(subj.ann);
    const partner = await signedIn(subj.bob);
    const closed = vi.fn();
    revocations.subscribe(lost.me.session.id, closed);

    const list = DeviceSessionList.parse(
      (await get('/api/v1/auth/devices', partner.cookie)).json(),
    );
    const ids = list.items.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([lost.me.session.id, other.me.session.id, partner.me.session.id]),
    );
    expect(list.items.find((i) => i.id === partner.me.session.id)?.current).toBe(true);
    expect(list.items.find((i) => i.id === lost.me.session.id)?.member.displayName).toBe('ann');
    expect(list.items.find((i) => i.id === lost.me.session.id)?.deviceLabel).toBe(
      'Firefox on Android',
    );

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${lost.me.session.id}`,
      headers: partner.mutate,
    });
    expect(del.statusCode).toBe(204);
    expect(closed).toHaveBeenCalledTimes(1);
    revocations.subscribe(lost.me.session.id, closed);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${lost.me.session.id}`,
      headers: partner.mutate,
    });
    expect(again.statusCode).toBe(204); // idempotent, and no second close signal
    expect(closed).toHaveBeenCalledTimes(1);
    expect((await get('/api/v1/household-data', lost.cookie)).statusCode).toBe(401);
    expect((await get('/api/v1/household-data', other.cookie)).statusCode).toBe(200);
    const after = DeviceSessionList.parse(
      (await get('/api/v1/auth/devices', partner.cookie)).json(),
    );
    expect(after.items.map((i) => i.id)).not.toContain(lost.me.session.id);
  });

  it('another household cannot list or revoke the session (404, no effect)', async () => {
    const victim = await signedIn(subj.ann);
    const intruder = await signedIn(subj.cat);
    const list = DeviceSessionList.parse(
      (await get('/api/v1/auth/devices', intruder.cookie)).json(),
    );
    expect(list.items.map((i) => i.id)).not.toContain(victim.me.session.id);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${victim.me.session.id}`,
      headers: intruder.mutate,
    });
    expect(del.statusCode).toBe(404);
    expect((await get('/api/v1/household-data', victim.cookie)).statusCode).toBe(200);
  });

  it('logout revokes the current session only', async () => {
    const a = await signedIn(subj.bob);
    const b = await signedIn(subj.bob);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: a.mutate });
    expect(out.statusCode).toBe(204);
    expect((await get('/api/v1/household-data', a.cookie)).statusCode).toBe(401);
    expect((await get('/api/v1/household-data', b.cookie)).statusCode).toBe(200);
  });

  it('a revoked device cannot come back by replaying a stale-auth_time login (silent SSO re-entry)', async () => {
    const lost = await signedIn(subj.ann);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: lost.mutate });
    const before = await sessionCount();
    const { cb } = await login(subj.ann, { authTimeOffset: -120 });
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(await sessionCount()).toBe(before);
  });

  it('a membership removed after login invalidates the session', async () => {
    const s = await signedIn(subj.dan);
    await pool.query('UPDATE users SET is_active = false WHERE oidc_subject = $1', [subj.dan]);
    try {
      expect((await get('/api/v1/household-data', s.cookie)).statusCode).toBe(401);
    } finally {
      await pool.query('UPDATE users SET is_active = true WHERE oidc_subject = $1', [subj.dan]);
    }
  });
});

describe('AC-11: a new login on the same browser revokes the session it replaces', () => {
  it('revokes the old session, fires its SSE hook, and the new session works', async () => {
    const old = await signedIn(subj.ann);
    const closed = vi.fn();
    revocations.subscribe(old.me.session.id, closed);
    const { cb, token } = await login(subj.ann, { existingSession: old.cookie });
    expect(cb.headers.location).not.toBe(LOGIN_FAILED_PATH);
    expect(closed).toHaveBeenCalledTimes(1);
    expect((await get('/api/v1/household-data', old.cookie)).statusCode).toBe(401);
    expect((await get('/api/v1/household-data', `${SESSION_COOKIE}=${token!}`)).statusCode).toBe(
      200,
    );
    const { rows } = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM device_sessions WHERE id = $1',
      [old.me.session.id],
    );
    expect(rows[0]!.revoked_at).not.toBeNull();
  });

  it('a failed re-login leaves the old session untouched', async () => {
    const old = await signedIn(subj.ann);
    const closed = vi.fn();
    revocations.subscribe(old.me.session.id, closed);
    const { cb } = await login(subj.ann, { existingSession: old.cookie, authTimeOffset: -3600 });
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(closed).not.toHaveBeenCalled();
    expect((await get('/api/v1/household-data', old.cookie)).statusCode).toBe(200);
  });

  it("the partner signing in on the same browser revokes the previous member's session", async () => {
    const ann = await signedIn(subj.ann);
    const { cb, token } = await login(subj.bob, { existingSession: ann.cookie });
    expect(cb.headers.location).not.toBe(LOGIN_FAILED_PATH);
    expect((await get('/api/v1/household-data', ann.cookie)).statusCode).toBe(401);
    const me = MeResponse.parse(
      (await get('/api/v1/auth/me', `${SESSION_COOKIE}=${token!}`)).json(),
    );
    expect(me.member.id).toBe(memberIds['bob']);
  });

  it('a forced callback with a mismatched state cannot revoke the victim session', async () => {
    const victim = await signedIn(subj.ann);
    const closed = vi.fn();
    revocations.subscribe(victim.me.session.id, closed);
    const { cb } = await login(subj.cat, {
      existingSession: victim.cookie,
      stateOverride: 'attacker-state',
    });
    expect(cb.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(closed).not.toHaveBeenCalled();
    expect((await get('/api/v1/household-data', victim.cookie)).statusCode).toBe(200);
  });

  it('a session of the other household on the same browser is revoked, nothing else', async () => {
    const cat = await signedIn(subj.cat);
    const dan = await signedIn(subj.dan);
    const { cb } = await login(subj.ann, { existingSession: cat.cookie });
    expect(cb.headers.location).not.toBe(LOGIN_FAILED_PATH);
    expect((await get('/api/v1/household-data', cat.cookie)).statusCode).toBe(401);
    expect((await get('/api/v1/household-data', dan.cookie)).statusCode).toBe(200);
  });

  it('a new login without a session cookie revokes nothing', async () => {
    const other = await signedIn(subj.ann);
    await signedIn(subj.ann);
    expect((await get('/api/v1/household-data', other.cookie)).statusCode).toBe(200);
  });
});

describe('NFR-01: sliding and absolute expiry', () => {
  it('expires after 90 idle days', async () => {
    const s = await signedIn(subj.ann);
    clockMs += 90 * DAY + 1000;
    expect((await get('/api/v1/household-data', s.cookie)).statusCode).toBe(401);
  });

  it('activity slides the idle expiry, but never beyond 180 days', async () => {
    const s = await signedIn(subj.ann);
    const t0 = clockMs;
    for (const day of [80, 160]) {
      clockMs = t0 + day * DAY;
      expect((await get('/api/v1/household-data', s.cookie)).statusCode, `day ${day}`).toBe(200);
    }
    const { rows } = await pool.query<{ idle_expires_at: Date; absolute_expires_at: Date }>(
      'SELECT idle_expires_at, absolute_expires_at FROM device_sessions WHERE id = $1',
      [s.me.session.id],
    );
    expect(rows[0]!.idle_expires_at.getTime()).toBe(rows[0]!.absolute_expires_at.getTime());
    clockMs = rows[0]!.absolute_expires_at.getTime() + 1;
    expect((await get('/api/v1/household-data', s.cookie)).statusCode).toBe(401);
  });
});

describe('operator commands never mint sessions (ADR-003, lost-device runbook)', () => {
  it('revoke-sessions revokes every live session of a member', async () => {
    const a = await signedIn(subj.cat);
    const b = await signedIn(subj.cat);
    const before = await sessionCount();
    const { revoked } = await createOperatorService(pool).revokeSessions([memberIds['cat']!]);
    expect(revoked).toBeGreaterThanOrEqual(2);
    expect(await sessionCount()).toBe(before);
    expect((await get('/api/v1/household-data', a.cookie)).statusCode).toBe(401);
    expect((await get('/api/v1/household-data', b.cookie)).statusCode).toBe(401);
  });

  it('link-identity moves a member to a new subject, revokes old sessions, creates none', async () => {
    const old = await signedIn(subj.dan);
    const before = await sessionCount();
    const newSubject = `dan2-${tag}`;
    await createOperatorService(pool).linkIdentity(memberIds['dan']!, TEST_ISSUER, newSubject);
    expect(await sessionCount()).toBe(before);
    expect((await get('/api/v1/household-data', old.cookie)).statusCode).toBe(401);
    expect((await login(subj.dan)).cb.headers.location).toBe(LOGIN_FAILED_PATH);
    const fresh = await signedIn(newSubject);
    expect(fresh.me.member.id).toBe(memberIds['dan']);
    await createOperatorService(pool).linkIdentity(memberIds['dan']!, TEST_ISSUER, subj.dan);
  });

  it('link-identity refuses an identity that belongs to another user', async () => {
    await expect(
      createOperatorService(pool).linkIdentity(memberIds['dan']!, TEST_ISSUER, subj.cat),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
