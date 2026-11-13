import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerErrorHandling } from './errors.js';
import { buildLoggerOptions } from './logging.js';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

function capture(): { lines: string[]; app: FastifyInstance } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  app = Fastify({ logger: { ...buildLoggerOptions('info'), stream } });
  return { lines, app };
}

describe('log redaction (NFR-08)', () => {
  it('redacts tokens, cookies, chat and profile data and strips query strings', async () => {
    const { lines, app } = capture();
    app.get('/cb', async (req) => {
      req.log.info(
        {
          token: 'TOKEN-1',
          nested: {
            accessToken: 'TOKEN-2',
            password: 'PW-1',
            messages: ['CHAT-TEXT'],
            profile: { allergy: 'PROFILE-DATA' },
            content: 'CHAT-2',
          },
          req: { headers: { authorization: 'Bearer TOKEN-3', cookie: '__Host-s=COOKIE-1' } },
        },
        'probe',
      );
      return {};
    });
    await app.inject({ method: 'GET', url: '/cb?code=OIDC-CODE&state=OIDC-STATE' });
    const out = lines.join('');
    for (const secret of [
      'TOKEN-1',
      'TOKEN-2',
      'TOKEN-3',
      'PW-1',
      'CHAT-TEXT',
      'CHAT-2',
      'PROFILE-DATA',
      'COOKIE-1',
      'OIDC-CODE',
      'OIDC-STATE',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
    expect(out).toContain('"url":"/cb"');
    // every line is JSON
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('does not log pg error detail, parameters or message on 5xx', async () => {
    const { lines, app } = capture();
    registerErrorHandling(app);
    app.get('/boom', async () => {
      throw Object.assign(new Error('duplicate key value (ROW-VALUE)'), {
        code: '23505',
        constraint: 'x_uq',
        detail: 'Key (email)=(DETAIL-VALUE) exists',
        parameters: ['PARAM-VALUE'],
      });
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const out = lines.join('');
    for (const v of ['ROW-VALUE', 'DETAIL-VALUE', 'PARAM-VALUE']) expect(out).not.toContain(v);
    expect(out).toContain('23505');
  });

  it('keeps the error code visible on 4xx logs', async () => {
    const { lines, app } = capture();
    registerErrorHandling(app);
    await app.inject({ method: 'GET', url: '/missing' });
    expect(lines.join('')).not.toContain('"errorCode":"[redacted]"');
  });
});
