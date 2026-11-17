import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DeviceSessionId, HouseholdId, MemberId, UserId } from '@mise/contracts';
import { buildApp } from '../app.js';
import { loadSpaAssets } from './spa.js';
import type { SpaAssets } from './spa.js';
import { testConfig } from './test-support.js';

const INDEX = '<!doctype html><title>Mise</title>';
const BUNDLE = 'console.log("app")';
const SECRET = 'outside-dist-secret';

let root: string;
let assets: SpaAssets;
let app: FastifyInstance;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mise-spa-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'assets', 'index-AbC123.js'), BUNDLE);
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
  writeFileSync(join(root, 'secret.txt'), SECRET);
  symlinkSync(join(root, 'secret.txt'), join(dist, 'linked-secret.txt'));
  assets = loadSpaAssets(dist);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(async () => {
  await app.close();
});

const actor = {
  userId: '22222222-2222-4222-8222-222222222222' as UserId,
  householdId: '33333333-3333-4333-8333-333333333333' as HouseholdId,
  memberId: '44444444-4444-4444-8444-444444444444' as MemberId,
  deviceSessionId: '11111111-1111-4111-8111-111111111111' as DeviceSessionId,
};

/** `x-test-actor: 1` stands in for a valid session (the A07 hook is covered by its own tests). */
function makeApp(): FastifyInstance {
  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null, spa: assets });
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-actor'] === '1') req.actor = actor;
  });
  return app;
}

describe('SPA asset serving (tech §3, AC-11)', () => {
  it('serves index.html at / and for client-side routes, revalidated, with security headers', async () => {
    makeApp();
    for (const url of ['/', '/recipes/123', '/shopping?list=1']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toBe(INDEX);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('serves hashed bundles as immutable with the right content type', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/assets/index-AbC123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(BUNDLE);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers HEAD like GET without a body', async () => {
    const res = await makeApp().inject({ method: 'HEAD', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it.each([
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/linked-secret.txt',
    '/assets/missing.js',
  ])('never serves anything outside the loaded files: %s', async (url) => {
    const res = await makeApp().inject({ method: 'GET', url });
    expect(res.body).not.toContain(SECRET);
    expect(res.statusCode).toBe(404);
  });

  it('skips symlinks when loading', () => {
    expect(assets.has('/linked-secret.txt')).toBe(false);
    expect([...assets.keys()].sort()).toEqual([
      '/assets/index-AbC123.js',
      '/favicon.svg',
      '/index.html',
    ]);
  });

  it.each([
    '/api',
    '/api/',
    '/api/v1/unknown',
    '/api/v1/recipes/x/y/z',
    '/%61pi/v1/x',
    '/API/v1/x',
  ])(
    'AC-11: unknown API path %s is 401 without a session and 404 with one, never the SPA',
    async (url) => {
      makeApp();
      const anon = await app.inject({ method: 'GET', url });
      expect(anon.statusCode).toBe(401);
      expect(anon.json()).toMatchObject({ code: 'unauthenticated' });
      expect(anon.body).not.toBe(INDEX);
      const authed = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-test-actor': '1' },
      });
      expect(authed.statusCode).toBe(404);
      expect(authed.body).not.toBe(INDEX);
    },
  );

  it('does not shadow real API routes', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('refuses to start from a directory without index.html', () => {
    expect(() => loadSpaAssets(join(root, 'dist', 'assets'))).toThrow(/index\.html/);
  });
});
