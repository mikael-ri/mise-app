import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import { addTag, draftFromRecipe, updateLine } from './form-model.js';
import { salmonRecipe, uuid } from './recipe-fixtures.js';
import type { RecipesApi } from './recipes-api.js';
import { isStaleRevision, saveMineAsNewest } from './save-flow.js';

const stale = () =>
  new ApiError({ status: 409, code: 'stale_revision', message: 'x', correlationId: 'c' });

function fakeApi(over: Partial<RecipesApi>): RecipesApi {
  return {
    search: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    patch: vi.fn(),
    listVersions: vi.fn(),
    getVersion: vi.fn(),
    restore: vi.fn(),
    ...over,
  };
}

const baseline = salmonRecipe({ revision: 3 });
const draft = updateLine(draftFromRecipe(baseline), uuid(11), { amountMin: '200' });

describe('conflict resolution: Save mine as newest (FR-03, AC-03, R3a)', () => {
  it('refetches the latest recipe and patches the draft against the latest revision', async () => {
    const latest = salmonRecipe({ revision: 5 });
    const saved = salmonRecipe({ revision: 6 });
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(latest),
      patch: vi.fn().mockResolvedValue(saved),
    });
    const result = await saveMineAsNewest(api, baseline.id, draft, baseline);
    expect(result).toEqual({ kind: 'saved', recipe: saved });
    expect(api.get).toHaveBeenCalledWith(baseline.id);
    expect(api.patch).toHaveBeenCalledWith(
      baseline.id,
      5,
      expect.objectContaining({ content: expect.anything() }),
    );
  });

  it('a second 409 returns conflict and leaves the draft untouched (nothing lost)', async () => {
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(salmonRecipe({ revision: 5 })),
      patch: vi.fn().mockRejectedValue(stale()),
    });
    const before = structuredClone(draft);
    const result = await saveMineAsNewest(api, baseline.id, draft, baseline);
    expect(result).toEqual({ kind: 'conflict' });
    expect(draft).toEqual(before);
    // The user can choose again: the next attempt refetches again and uses the newest revision.
    vi.mocked(api.get).mockResolvedValue(salmonRecipe({ revision: 6 }));
    vi.mocked(api.patch).mockResolvedValue(salmonRecipe({ revision: 7 }));
    await expect(saveMineAsNewest(api, baseline.id, draft, baseline)).resolves.toMatchObject({
      kind: 'saved',
    });
    expect(api.patch).toHaveBeenLastCalledWith(baseline.id, 6, expect.anything());
  });

  it('other errors propagate; metadata-only drafts also work on top of the latest', async () => {
    const boom = new ApiError({ status: 500, code: 'internal_error', message: 'x' });
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(salmonRecipe({ revision: 5 })),
      patch: vi.fn().mockRejectedValue(boom),
    });
    await expect(
      saveMineAsNewest(api, baseline.id, addTag(draftFromRecipe(baseline), 'uuni'), baseline),
    ).rejects.toBe(boom);
  });

  it('when both sides edited the same ingredient, mine overwrites those fields (documented behaviour)', async () => {
    const theirs = salmonRecipe({ revision: 5 });
    theirs.content.ingredients = theirs.content.ingredients.map((l) =>
      l.id === uuid(11)
        ? { ...l, original_quantity_text: '300 g', amount_min: '300', amount_max: '300' }
        : l,
    );
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(theirs),
      patch: vi.fn().mockResolvedValue(salmonRecipe({ revision: 6 })),
    });
    await saveMineAsNewest(api, baseline.id, draft, baseline);
    const body = vi.mocked(api.patch).mock.calls[0]?.[2];
    const sent = body?.content?.ingredients.find((l) => l.id === uuid(11));
    expect(sent).toMatchObject({ amount_min: '200', original_quantity_text: '200 g' });
  });

  it('only a stale_revision 409 counts as an edit race', () => {
    expect(isStaleRevision(stale())).toBe(true);
    expect(isStaleRevision(new ApiError({ status: 409, code: 'conflict', message: 'x' }))).toBe(
      false,
    );
  });
});
