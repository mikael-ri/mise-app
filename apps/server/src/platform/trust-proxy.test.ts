// A19 / A06 carry-over: behind the proxy Pi, rate limits must key on the real client IP, and only
// the configured proxy address may set it (TRUST_PROXY=<proxy IP>, never a blanket `true`).
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createRateLimiter, rateLimitHook } from './security.js';
import { testConfig } from './test-support.js';

const PROXY = '192.168.1.10';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

function makeApp(): FastifyInstance {
  app = buildApp({
    checkReady: async () => {},
    config: { ...testConfig, trustProxy: [PROXY] },
    auth: null,
  });
  const limited = rateLimitHook(createRateLimiter({ windowMs: 60_000, max: 1 }));
  app.get('/probe', { onRequest: limited }, async (request) => ({ ip: request.ip }));
  return app;
}

const from = (remoteAddress: string, forwardedFor?: string) => ({
  method: 'GET' as const,
  url: '/probe',
  remoteAddress,
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
});

describe('TRUST_PROXY and client IP (NFR-01 rate limiting)', () => {
  it.each<[string, string, string | undefined, string]>([
    ['uses X-Forwarded-For from the trusted proxy', PROXY, '203.0.113.7', '203.0.113.7'],
    [
      'ignores X-Forwarded-For from any other sender',
      '192.168.1.99',
      '203.0.113.7',
      '192.168.1.99',
    ],
    [
      'takes the hop the proxy appended, not a spoofed left entry',
      PROXY,
      '1.2.3.4, 203.0.113.7',
      '203.0.113.7',
    ],
    ['falls back to the proxy address without the header', PROXY, undefined, PROXY],
  ])('%s', async (_name, remote, xff, expected) => {
    const res = await makeApp().inject(from(remote, xff));
    expect(res.json()).toEqual({ ip: expected });
  });

  it('gives each client behind the proxy its own rate-limit bucket', async () => {
    makeApp();
    expect((await app.inject(from(PROXY, '203.0.113.7'))).statusCode).toBe(200);
    expect((await app.inject(from(PROXY, '203.0.113.8'))).statusCode).toBe(200);
    const again = await app.inject(from(PROXY, '203.0.113.7'));
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('a direct sender cannot dodge its limit by rotating X-Forwarded-For', async () => {
    makeApp();
    expect((await app.inject(from('192.168.1.99', '203.0.113.1'))).statusCode).toBe(200);
    expect((await app.inject(from('192.168.1.99', '203.0.113.2'))).statusCode).toBe(429);
  });
});
