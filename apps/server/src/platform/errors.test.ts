import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorBody } from '@mise/contracts';
import { buildApp } from '../app.js';
import { AppError, generateCorrelationId } from './errors.js';
import { testConfig } from './test-support.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

function makeApp(): FastifyInstance {
  app = buildApp({ checkReady: async () => {}, config: testConfig });
  app.get('/boom', async () => {
    throw new Error('secret stack detail: password=hunter2');
  });
  app.get('/db', async () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint "users_pkey"'), {
      code: '23505',
      detail: 'Key (id)=(1) already exists.',
      table: 'users',
    });
  });
  app.get('/app-error', async () => {
    throw new AppError('stale_revision', 'stale', { currentRevision: 4 });
  });
  app.post('/zod', async (req) => z.strictObject({ n: z.int() }).parse(req.body));
  return app;
}

describe('error model (NFR-04)', () => {
  it('maps AppError to the standard body and status', async () => {
    const res = await makeApp().inject({ method: 'GET', url: '/app-error' });
    expect(res.statusCode).toBe(409);
    const body = ErrorBody.parse(res.json());
    expect(body).toMatchObject({ code: 'stale_revision', details: { currentRevision: 4 } });
  });

  it.each(['/boom', '/db'])('hides internals of unexpected errors (%s)', async (url) => {
    const res = await makeApp().inject({ method: 'GET', url });
    expect(res.statusCode).toBe(500);
    const body = ErrorBody.parse(res.json());
    expect(body.code).toBe('internal_error');
    expect(res.body).not.toMatch(/hunter2|unique constraint|users|23505|stack|at /);
  });

  it('maps Zod errors to 400 validation_failed without echoing input', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/zod',
      payload: { n: 'SECRET-VALUE' },
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorBody.parse(res.json()).code).toBe('validation_failed');
    expect(res.body).not.toContain('SECRET-VALUE');
  });

  it('maps malformed JSON to 400 and unknown routes to 404 in the standard shape', async () => {
    makeApp();
    const bad = await app.inject({
      method: 'POST',
      url: '/zod',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(bad.statusCode).toBe(400);
    expect(ErrorBody.parse(bad.json()).code).toBe('validation_failed');
    const missing = await app.inject({ method: 'GET', url: '/nothing' });
    expect(missing.statusCode).toBe(404);
    expect(ErrorBody.parse(missing.json()).code).toBe('not_found');
  });
});

describe('correlation ids (NFR-08)', () => {
  it('uses a well-formed inbound x-request-id in body and response header', async () => {
    const res = await makeApp().inject({
      method: 'GET',
      url: '/app-error',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(res.json().correlationId).toBe('req-12345678');
    expect(res.headers['x-request-id']).toBe('req-12345678');
  });

  it('mints a UUID when the inbound id is missing or malformed', async () => {
    makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/app-error',
      headers: { 'x-request-id': 'bad id\twith spaces' },
    });
    expect(res.json().correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(generateCorrelationId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
  });
});
