import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

describe('health routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it('live returns 200', async () => {
    app = buildApp({ checkReady: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('ready returns 200 when the check passes', async () => {
    app = buildApp({ checkReady: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('ready returns 503 when the check fails', async () => {
    app = buildApp({
      checkReady: async () => {
        throw new Error('down');
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
  });
});
