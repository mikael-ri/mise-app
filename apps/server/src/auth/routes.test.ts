// Route and middleware behaviour with a stub service (no database). The DB-backed AC-11 flows are in
// auth.int.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ErrorBody } from '@mise/contracts';
import type { DeviceSessionId, HouseholdId, MemberId, UserId } from '@mise/contracts';
import { buildApp } from '../app.js';
import { CSRF_HEADER, createRateLimiter, issueCsrfToken } from '../platform/index.js';
import { testConfig } from '../platform/test-support.js';
import {
  LOGIN_STATE_COOKIE,
  SESSION_COOKIE,
  loginStateKey,
  newSessionToken,
  sealLoginState,
} from './cookies.js';
import { OidcError } from './oidc.js';
import { LOGIN_FAILED_PATH, LOGIN_NOT_PROVISIONED_PATH } from './routes.js';
import type { AuthService } from './service.js';

const GOOD = newSessionToken();
const actor = {
  userId: '22222222-2222-4222-8222-222222222222' as UserId,
  householdId: '33333333-3333-4333-8333-333333333333' as HouseholdId,
  memberId: '44444444-4444-4444-8444-444444444444' as MemberId,
  deviceSessionId: '11111111-1111-4111-8111-111111111111' as DeviceSessionId,
};
const key = loginStateKey('k'.repeat(32));
const ORIGIN = testConfig.publicOrigin;
const LOGOUT_URL = 'https://auth.mise.test/logout';

function stubService(): AuthService {
  return {
    startLogin: vi.fn(async (returnTo) => ({
      authorizationUrl: 'https://auth.mise.test/api/oidc/authorization?x=1',
      state: {
        state: 's'.repeat(43),
        nonce: 'n'.repeat(43),
        codeVerifier: 'v'.repeat(64),
        startedAt: Date.now(),
        returnTo: returnTo ?? '/',
      },
    })),
    completeLogin: vi.fn(async (_q, state) => {
      if (state === null) throw new OidcError('login_state_invalid');
      return {
        token: GOOD,
        sessionId: actor.deviceSessionId,
        returnTo: state.returnTo,
        maxAgeSeconds: 100,
      };
    }),
    authenticate: vi.fn(async (token) => (token === GOOD ? actor : null)),
    me: vi.fn(),
    listDevices: vi.fn(async () => []),
    revokeDevice: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  };
}

let app: FastifyInstance;
let service: AuthService;
afterEach(async () => {
  await app.close();
});

function makeApp(limitMax = 100): FastifyInstance {
  service = stubService();
  app = buildApp({
    checkReady: async () => {},
    config: testConfig,
    auth: {
      service,
      publicOrigin: ORIGIN,
      postLoginLogoutUrl: LOGOUT_URL,
      loginStateKey: key,
      limiter: createRateLimiter({ windowMs: 60_000, max: limitMax }),
    },
  });
  app.get('/api/v1/protected', async () => ({ ok: true }));
  app.post('/api/v1/protected', async () => ({ ok: true }));
  return app;
}

const cookie = (token = GOOD) => `${SESSION_COOKIE}=${token}`;

describe('session middleware (AC-11, NFR-01)', () => {
  it('denies unauthenticated access to every non-public route, including unknown paths', async () => {
    makeApp();
    for (const [method, url] of [
      ['GET', '/api/v1/protected'],
      ['GET', '/api/v1/auth/me'],
      ['GET', '/api/v1/auth/devices'],
      ['GET', '/api/v1/does-not-exist'],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, url).toBe(401);
      expect(ErrorBody.parse(res.json()).code).toBe('unauthenticated');
    }
    expect((await app.inject({ url: '/api/v1/health/live' })).statusCode).toBe(200);
  });

  it('accepts only the __Host- cookie: a bearer header with a valid token is ignored', async () => {
    makeApp();
    const bearer = await app.inject({
      url: '/api/v1/protected',
      headers: { authorization: `Bearer ${GOOD}` },
    });
    expect(bearer.statusCode).toBe(401);
    const plainName = await app.inject({
      url: '/api/v1/protected',
      headers: { cookie: `mise_session=${GOOD}` },
    });
    expect(plainName.statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/protected', headers: { cookie: cookie() } })).statusCode,
    ).toBe(200);
  });

  it('a revoked or unknown session cookie gets 401 and is cleared', async () => {
    makeApp();
    const res = await app.inject({
      url: '/api/v1/protected',
      headers: { cookie: cookie(newSessionToken()) },
    });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  });

  it('cookie-authenticated mutations still need Origin and the CSRF token (A06 carry-over)', async () => {
    makeApp();
    const csrf = issueCsrfToken(testConfig.csrfSecret, actor.deviceSessionId);
    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie() },
    });
    expect(noOrigin.statusCode).toBe(403);
    const noToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie(), origin: ORIGIN },
    });
    expect(noToken.statusCode).toBe(403);
    expect(service.logout).not.toHaveBeenCalled();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookie(), origin: ORIGIN, [CSRF_HEADER]: csrf },
    });
    expect(ok.statusCode).toBe(204);
    expect(service.logout).toHaveBeenCalledWith(actor);
    expect(String(ok.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  });

  it('revoking the current device clears its cookie', async () => {
    makeApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${actor.deviceSessionId}`,
      headers: {
        cookie: cookie(),
        origin: ORIGIN,
        [CSRF_HEADER]: issueCsrfToken(testConfig.csrfSecret, actor.deviceSessionId),
      },
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('rejects a malformed device id with 400', async () => {
    makeApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/devices/not-a-uuid',
      headers: {
        cookie: cookie(),
        origin: ORIGIN,
        [CSRF_HEADER]: issueCsrfToken(testConfig.csrfSecret, actor.deviceSessionId),
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('OIDC routes', () => {
  it('start redirects to the IdP and sets the encrypted __Host- login-state cookie', async () => {
    makeApp();
    const res = await app.inject({ url: '/api/v1/auth/oidc/start?returnTo=/recipes' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://auth.mise.test/api/oidc/authorization?x=1');
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(
      new RegExp(
        `^${LOGIN_STATE_COOKIE}=[A-Za-z0-9_-]+; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`,
      ),
    );
    expect(set).not.toContain('v'.repeat(10));
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('start refuses an off-site returnTo (open redirect)', async () => {
    makeApp();
    for (const r of ['//evil.test', 'https://evil.test', '/\\evil.test']) {
      const res = await app.inject({
        url: `/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(r)}`,
      });
      expect(res.statusCode, r).toBe(400);
    }
  });

  it('callback without a login-state cookie fails generically and sets no session', async () => {
    makeApp();
    const res = await app.inject({ url: '/api/v1/auth/oidc/callback?code=c&state=s' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(String(res.headers['set-cookie'])).not.toContain(`${SESSION_COOKIE}=`);
  });

  it('callback with neither code nor error fails generically', async () => {
    makeApp();
    const res = await app.inject({ url: '/api/v1/auth/oidc/callback?state=s' });
    expect(res.headers.location).toBe(LOGIN_FAILED_PATH);
    expect(service.completeLogin).not.toHaveBeenCalled();
  });

  it('callback success sets the session cookie and hops through the Authelia logout (D4)', async () => {
    makeApp();
    const sealed = sealLoginState(key, {
      state: 's'.repeat(43),
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(64),
      startedAt: Date.now(),
      returnTo: '/plan',
    });
    const res = await app.inject({
      url: `/api/v1/auth/oidc/callback?code=c&state=${'s'.repeat(43)}`,
      headers: { cookie: `${LOGIN_STATE_COOKIE}=${sealed}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${LOGOUT_URL}?rd=${encodeURIComponent(`${ORIGIN}/plan`)}`);
    const set = res.headers['set-cookie'] as string[];
    expect(set).toContain(
      `${LOGIN_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(set).toContain(
      `${SESSION_COOKIE}=${GOOD}; Path=/; Max-Age=100; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  const sealedState = () =>
    sealLoginState(key, {
      state: 's'.repeat(43),
      nonce: 'n'.repeat(43),
      codeVerifier: 'v'.repeat(64),
      startedAt: Date.now(),
      returnTo: '/',
    });

  it('callback hands the session the browser still holds to the service for revocation (AC-11)', async () => {
    makeApp();
    await app.inject({
      url: `/api/v1/auth/oidc/callback?code=c&state=${'s'.repeat(43)}`,
      headers: {
        cookie: `${LOGIN_STATE_COOKIE}=${sealedState()}; ${cookie()}`,
        'user-agent': 'UA/1',
      },
    });
    expect(service.completeLogin).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userAgent: 'UA/1',
      replacing: actor,
    });
  });

  it('callback with a dead session cookie: clears it before setting the new one', async () => {
    makeApp();
    const res = await app.inject({
      url: `/api/v1/auth/oidc/callback?code=c&state=${'s'.repeat(43)}`,
      headers: { cookie: `${LOGIN_STATE_COOKIE}=${sealedState()}; ${cookie(newSessionToken())}` },
    });
    expect(service.completeLogin).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ replacing: null }),
    );
    const sessionCookies = (res.headers['set-cookie'] as string[]).filter((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    );
    expect(sessionCookies).toEqual([
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      `${SESSION_COOKIE}=${GOOD}; Path=/; Max-Age=100; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it.each([
    ['subject_not_provisioned', LOGIN_NOT_PROVISIONED_PATH],
    ['signature_invalid', LOGIN_FAILED_PATH],
    ['auth_time_stale', LOGIN_FAILED_PATH],
  ] as const)(
    'callback failing with %s redirects to %s, clears login state, sets no session',
    async (reason, path) => {
      makeApp();
      vi.mocked(service.completeLogin).mockRejectedValueOnce(new OidcError(reason));
      const res = await app.inject({
        url: `/api/v1/auth/oidc/callback?code=c&state=${'s'.repeat(43)}`,
        headers: { cookie: `${LOGIN_STATE_COOKIE}=${sealedState()}` },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(path);
      expect(res.headers['cache-control']).toBe('no-store');
      const set = String(res.headers['set-cookie']);
      expect(set).toBe(`${LOGIN_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
      expect(set).not.toContain(`${SESSION_COOKIE}=`);
    },
  );

  it('rate-limits the auth routes per client IP', async () => {
    makeApp(2);
    const codes = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await app.inject({ url: '/api/v1/auth/oidc/start' })).statusCode);
    }
    expect(codes).toEqual([302, 302, 429]);
    expect(
      (await app.inject({ url: '/api/v1/auth/oidc/callback?state=s&code=c' })).statusCode,
    ).toBe(429);
  });
});
