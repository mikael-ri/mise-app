import { describe, expect, it } from 'vitest';
import { buildEditBody, formFromItem, mergeLatest, rememberKey } from './item-form.js';
import { CAT, shoppingItem } from './shopping-fixtures.js';

const item = shoppingItem(1, {
  name: 'Maito',
  normalizedKey: 'maito',
  categoryId: CAT.dairy,
  originalQuantityText: '2 l',
  note: 'rasvaton',
});
const initial = formFromItem(item);

describe('buildEditBody (FR-35, FR-36)', () => {
  it('FR-36: an unchanged category is never sent', () => {
    expect(buildEditBody(initial, { ...initial, name: 'Maito 1,5 %' })).toEqual({
      name: 'Maito 1,5 %',
    });
  });
  it('sends nothing when nothing changed (picked is handled separately)', () => {
    expect(buildEditBody(initial, { ...initial, picked: true })).toBeNull();
  });
  it('FR-36: a changed category is sent', () => {
    expect(buildEditBody(initial, { ...initial, categoryId: CAT.vegetables })).toEqual({
      categoryId: CAT.vegetables,
    });
  });
  it('FR-36: choosing Automatic after an override sends null', () => {
    expect(buildEditBody(initial, { ...initial, categoryId: '' })).toEqual({ categoryId: null });
  });
  it('FR-36: Automatic that was already the initial value sends nothing', () => {
    const auto = { ...initial, categoryId: '' };
    expect(buildEditBody(auto, { ...auto })).toBeNull();
  });
  it('clearing quantity and note sends null; quantity text is sent verbatim, trimmed', () => {
    expect(buildEditBody(initial, { ...initial, quantity: '', note: '  ' })).toEqual({
      quantityText: null,
      note: null,
    });
    expect(buildEditBody(initial, { ...initial, quantity: ' 1,5 dl ' })).toEqual({
      quantityText: '1,5 dl',
    });
  });
  it('whitespace-only differences are not changes', () => {
    expect(buildEditBody(initial, { ...initial, name: ' Maito ', quantity: '2 l ' })).toBeNull();
  });
});

describe('rememberKey', () => {
  it('uses the stored normalized key while the name is unchanged, else lowercases the typed name', () => {
    expect(rememberKey(item, 'Maito')).toBe('maito');
    expect(rememberKey(item, ' Kerma ')).toBe('kerma');
  });
});

describe('mergeLatest (Show latest after a stale edit)', () => {
  const latest = { ...initial, name: 'Maito 1 l', quantity: '3 l', note: 'uusi', picked: true };
  it.each([
    ['nothing touched: everything refreshed', initial, latest],
    [
      'note touched: note kept, rest refreshed',
      { ...initial, note: 'minun' },
      { ...latest, note: 'minun' },
    ],
    [
      'all touched: draft kept',
      { name: 'a', quantity: 'b', note: 'c', categoryId: CAT.vegetables, picked: true },
      { name: 'a', quantity: 'b', note: 'c', categoryId: CAT.vegetables, picked: true },
    ],
  ])('%s', (_name, draft, expected) => {
    expect(mergeLatest(initial, draft, latest)).toEqual(expected);
  });
});
