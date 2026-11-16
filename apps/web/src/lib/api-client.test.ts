import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient } from './api-client.js';

const Thing = z.object({ ok: z.boolean() });

function setup(response: Response | Error, csrf: string | undefined = 'tok') {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const onSessionEnded = vi.fn();
  const client = createApiClient({ getCsrfToken: () => csrf, onSessionEnded, fetchImpl });
  return { client, fetchImpl, onSessionEnded };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sentHeaders(fetchImpl: ReturnType<typeof setup>['fetchImpl']): Record<string, string> {
  return (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

describe('api client (NFR-04, FR-30)', () => {
  it('sends X-CSRF-Token on mutations only, never on GET', async () => {
    const get = setup(json({ ok: true }));
    await get.client.request({ path: '/api/v1/x', schema: Thing });
    expect(sentHeaders(get.fetchImpl)['X-CSRF-Token']).toBeUndefined();

    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const mutation = setup(new Response(null, { status: 204 }));
      await mutation.client.request({ method, path: '/api/v1/x' });
      expect(sentHeaders(mutation.fetchImpl)['X-CSRF-Token']).toBe('tok');
    }
  });

  it('is same-origin only: relative URL, same-origin credentials, rejects other paths', async () => {
    const { client, fetchImpl } = setup(json({ ok: true }));
    await client.request({ path: '/api/v1/x', schema: Thing });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/x');
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('same-origin');
    await expect(client.request({ path: 'https://evil.example/api/' })).rejects.toThrow();
    await expect(client.request({ path: '//evil.example/api/' })).rejects.toThrow();
  });

  it('parses the response with the contract schema', async () => {
    const ok = setup(json({ ok: true }));
    await expect(ok.client.request({ path: '/api/v1/x', schema: Thing })).resolves.toEqual({
      ok: true,
    });
    const bad = setup(json({ nope: 1 }));
    await expect(bad.client.request({ path: '/api/v1/x', schema: Thing })).rejects.toMatchObject({
      code: 'unexpected_response',
    });
  });

  it('parses the error body into an ApiError with correlationId', async () => {
    const { client } = setup(
      json({ code: 'not_found', message: 'gone', correlationId: 'abc', details: { a: 1 } }, 404),
    );
    const error = await client.request({ path: '/api/v1/x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: 'not_found',
      correlationId: 'abc',
      details: { a: 1 },
    });
  });

  it('maps 401 to the session-ended handler and an unauthenticated error', async () => {
    const { client, onSessionEnded } = setup(
      json({ code: 'unauthenticated', message: 'x', correlationId: 'c' }, 401),
    );
    const error = await client.request({ path: '/api/v1/x' }).catch((e: unknown) => e);
    expect(onSessionEnded).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ status: 401, isUnauthenticated: true });
  });

  it('surfaces 409 as a conflict error without ending the session', async () => {
    const { client, onSessionEnded } = setup(
      json({ code: 'stale_revision', message: 'x', correlationId: 'c' }, 409),
    );
    const error = await client.request({ method: 'PATCH', path: '/api/v1/x' }).catch((e) => e);
    expect(error).toMatchObject({ isConflict: true, code: 'stale_revision' });
    expect(onSessionEnded).not.toHaveBeenCalled();
  });

  it('handles non-JSON error bodies and network failures', async () => {
    const proxy = setup(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(proxy.client.request({ path: '/api/v1/x' })).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_response',
    });
    const offline = setup(new TypeError('failed'));
    await expect(offline.client.request({ path: '/api/v1/x' })).rejects.toMatchObject({
      code: 'network_error',
    });
  });
});
