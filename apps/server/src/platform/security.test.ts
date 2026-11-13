import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ErrorBody } from '@mise/contracts';
import type { DeviceSessionId, HouseholdId, MemberId, UserId } from '@mise/contracts';
import { buildApp } from '../app.js';
import {
  CSRF_HEADER,
  createRateLimiter,
  issueCsrfToken,
  rateLimitHook,
  verifyCsrfToken,
} from './security.js';
import { requireActor } from './request-context.js';
import { testConfig } from './test-support.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const actor = {
  userId: '22222222-2222-4222-8222-222222222222' as UserId,
  householdId: '33333333-3333-4333-8333-333333333333' as HouseholdId,
  memberId: '44444444-4444-4444-8444-444444444444' as MemberId,
  deviceSessionId: SESSION as DeviceSessionId,
};

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

/** Test stand-in for the A07 auth hook: an `x-test-actor` header means "authenticated". */
function makeApp(): FastifyInstance {
  app = buildApp({ checkReady: async () => {}, config: testConfig });
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-actor'] === '1') req.actor = actor;
  });
  app.post('/api/v1/mutate', async (req) => ({ who: requireActor(req).memberId }));
  app.post('/api/v1/public', async () => ({ ok: true }));
  app.get('/api/v1/read', async () => ({ ok: true }));
  return app;
}

const cookieHeaders = { cookie: '__Host-session=abc', 'x-test-actor': '1' };
const goodOrigin = testConfig.publicOrigin;
const goodToken = issueCsrfToken(testConfig.csrfSecret, SESSION);

describe('Origin and CSRF (NFR-04)', () => {
  it('accepts a cookie-authenticated mutation with matching Origin and CSRF token', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/api/v1/mutate',
      headers: { ...cookieHeaders, origin: goodOrigin, [CSRF_HEADER]: goodToken },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['missing Origin', undefined],
    ['foreign Origin', 'https://evil.test'],
    ['Origin "null"', 'null'],
    ['Origin with different scheme', 'http://mise.test'],
  ])('rejects %s', async (_n, origin) => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/api/v1/mutate',
      headers: { ...cookieHeaders, ...(origin ? { origin } : {}), [CSRF_HEADER]: goodToken },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(ErrorBody.parse(res.json()).code).toBe('forbidden');
  });

  it.each([
    ['missing token', undefined],
    ['wrong token', 'AAAA'],
    ['token of another session', issueCsrfToken(testConfig.csrfSecret, 'other-session')],
    ['token under another secret', issueCsrfToken('another-secret-another-secret-123456', SESSION)],
  ])('rejects %s', async (_n, token) => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/api/v1/mutate',
      headers: { ...cookieHeaders, origin: goodOrigin, ...(token ? { [CSRF_HEADER]: token } : {}) },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a cookie-bearing mutation with no actor and a bad Origin', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/api/v1/public',
      headers: { cookie: 'x=y', origin: 'https://evil.test' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not require Origin for safe methods or for cookie-less, actor-less requests', async () => {
    makeApp();
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/read', headers: cookieHeaders })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/public', payload: {} })).statusCode,
    ).toBe(200);
  });

  it('verifyCsrfToken is false for non-strings and wrong lengths', () => {
    expect(verifyCsrfToken('s'.repeat(32), SESSION, undefined)).toBe(false);
    expect(verifyCsrfToken('s'.repeat(32), SESSION, 'short')).toBe(false);
  });

  it('never sends CORS allow headers', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: '/api/v1/read',
      headers: { origin: 'https://evil.test' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security headers (NFR-04)', () => {
  it('sets CSP and standard headers on success and error responses', async () => {
    makeApp();
    for (const url of ['/api/v1/read', '/api/v1/missing']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('rate limiting hooks (NFR-04)', () => {
  it('limits per key within a window and resets after it', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => t });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.hit('b').allowed).toBe(true);
    t = 61_000;
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('returns 429 rate_limited with Retry-After through the hook', async () => {
    makeApp();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    app.get('/api/v1/limited', { onRequest: rateLimitHook(limiter) }, async () => ({ ok: true }));
    expect((await app.inject({ method: 'GET', url: '/api/v1/limited' })).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/v1/limited' });
    expect(res.statusCode).toBe(429);
    expect(ErrorBody.parse(res.json()).code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('request context (NFR-04)', () => {
  it('requireActor throws unauthenticated (401) when no actor is set', async () => {
    const res = await makeApp().inject({ method: 'POST', url: '/api/v1/mutate', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(ErrorBody.parse(res.json()).code).toBe('unauthenticated');
  });
});
