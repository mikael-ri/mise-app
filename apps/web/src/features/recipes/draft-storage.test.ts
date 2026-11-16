import { describe, expect, it } from 'vitest';
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from './draft-storage.js';
import { draftFromRecipe } from './form-model.js';
import { salmonRecipe } from './recipe-fixtures.js';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};
const draft = draftFromRecipe(salmonRecipe());

describe('draft storage (FR-01)', () => {
  it('round-trips a draft with its base revision, keyed by recipe id', () => {
    const store = memoryStore();
    expect(saveDraft('r1', draft, 3, store)).toBe(true);
    expect(loadDraft('r1', store)).toMatchObject({
      baseRevision: 3,
      draft: { title: 'Uunilohi ja perunat' },
    });
    expect(loadDraft('r2', store)).toBeNull();
    expect(loadDraft(null, store)).toBeNull();
    saveDraft(null, draft, null, store);
    expect(loadDraft(null, store)?.baseRevision).toBeNull();
  });

  it('clear removes only that draft', () => {
    const store = memoryStore();
    saveDraft('r1', draft, 3, store);
    saveDraft(null, draft, null, store);
    clearDraft('r1', store);
    expect(loadDraft('r1', store)).toBeNull();
    expect(loadDraft(null, store)).not.toBeNull();
  });

  it('treats corrupt or foreign values as no draft', () => {
    const store = memoryStore();
    store.setItem('mise.recipe-draft.v1.r1', '{not json');
    expect(loadDraft('r1', store)).toBeNull();
    store.setItem('mise.recipe-draft.v1.r1', JSON.stringify({ draft: { title: 1 } }));
    expect(loadDraft('r1', store)).toBeNull();
  });

  it('drops a wrong-shape draft, a line missing quantity fields and a stale format version', () => {
    const store = memoryStore();
    const key = 'mise.recipe-draft.v1.r1';
    const good = { version: 1, draft, baseRevision: 3, savedAt: 'x' };
    store.setItem(key, JSON.stringify({ ...good, draft: { ...draft, lines: 'nope' } }));
    expect(loadDraft('r1', store)).toBeNull();
    const [first, ...rest] = draft.lines;
    const broken = Object.fromEntries(
      Object.entries(first ?? {}).filter(([k]) => k !== 'amountMin'),
    );
    store.setItem(key, JSON.stringify({ ...good, draft: { ...draft, lines: [broken, ...rest] } }));
    expect(loadDraft('r1', store)).toBeNull();
    store.setItem(key, JSON.stringify({ ...good, version: 0 }));
    expect(loadDraft('r1', store)).toBeNull();
    store.setItem(key, JSON.stringify(good));
    expect(loadDraft('r1', store)?.baseRevision).toBe(3);
  });

  it('clearAllDrafts removes every draft key and nothing else, and never throws', () => {
    const map = new Map<string, string>([
      ['mise.recipe-draft.v1.a', '1'],
      ['mise.recipe-draft.v1.new', '1'],
      ['other', '1'],
    ]);
    const store = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    clearAllDrafts(store);
    expect([...map.keys()]).toEqual(['other']);
    expect(() =>
      clearAllDrafts({
        ...store,
        length: 1,
        key: () => {
          throw new Error('denied');
        },
      }),
    ).not.toThrow();
    expect(() => clearAllDrafts(null)).not.toThrow();
  });

  it('never throws when storage throws or is unavailable', () => {
    expect(saveDraft('r1', draft, 3, throwing)).toBe(false);
    expect(loadDraft('r1', throwing)).toBeNull();
    expect(() => clearDraft('r1', throwing)).not.toThrow();
    expect(saveDraft('r1', draft, 3, null)).toBe(false);
    expect(loadDraft('r1', null)).toBeNull();
  });
});
