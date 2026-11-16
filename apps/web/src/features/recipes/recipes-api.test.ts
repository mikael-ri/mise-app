import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../lib/api-client.js';
import { RECIPE_ID, salmonRecipe, uuid } from './recipe-fixtures.js';
import { createRecipesApi, searchPath } from './recipes-api.js';

function setup(body: unknown, status = 200) {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createApiClient({ getCsrfToken: () => 'tok', onSessionEnded: vi.fn(), fetchImpl });
  return { api: createRecipesApi(client), fetchImpl };
}
const sent = (f: ReturnType<typeof setup>['fetchImpl']) =>
  (f.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;

describe('recipes api (FR-01, FR-03)', () => {
  it('sends If-Match as the quoted recipe revision on patch', async () => {
    const { api, fetchImpl } = setup(salmonRecipe());
    await api.patch(RECIPE_ID, 7, { archived: true });
    expect(sent(fetchImpl)['If-Match']).toBe('"7"');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('sends If-Match and Idempotency-Key on restore, and the key on create', async () => {
    const restore = setup(salmonRecipe());
    await restore.api.restore(RECIPE_ID, 4, uuid(301), 'key-0123456789abcdef');
    expect(sent(restore.fetchImpl)['If-Match']).toBe('"4"');
    expect(sent(restore.fetchImpl)['idempotency-key']).toBe('key-0123456789abcdef');
    expect(JSON.parse(String(restore.fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      versionId: uuid(301),
    });
  });

  it('builds the search query with repeated tags and only the given filters', () => {
    expect(
      searchPath({ q: 'peruna', tags: ['kala', 'arki'], maxTime: 30, limit: 20, offset: 0 }),
    ).toBe('/api/v1/recipes?q=peruna&tags=kala&tags=arki&maxTime=30&limit=20&offset=0');
    expect(searchPath({})).toBe('/api/v1/recipes');
    expect(searchPath({ includeArchived: true })).toBe('/api/v1/recipes?includeArchived=true');
  });

  it('rejects a response that does not match the contract', async () => {
    const { api } = setup({ nope: true });
    await expect(api.get(RECIPE_ID)).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});
