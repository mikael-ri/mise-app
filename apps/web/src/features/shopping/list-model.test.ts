import { describe, expect, it } from 'vitest';
import {
  applyCheckoff,
  buildListView,
  diffItems,
  formatUpdated,
  insertUnit,
  isRejected,
  sortCategories,
} from './list-model.js';
import { CAT, CATEGORIES, groceries, shoppingItem, uuid } from './shopping-fixtures.js';

describe('buildListView (FR-36, FR-37)', () => {
  it('FR-36: groups by category in sortOrder with Other last; empty categories are hidden', () => {
    const view = buildListView(groceries(), CATEGORIES);
    expect(view.open.map((g) => g.category.systemCode)).toEqual(['vegetables', 'dairy', 'other']);
    expect(view.total).toBe(3);
    expect(view.pickedCount).toBe(0);
  });

  it('FR-36: Other stays last even when its sortOrder is lower than a household category', () => {
    const mine = { id: uuid(50), systemCode: null, name: 'Pets', sortOrder: 2000 } as const;
    const categories = [...CATEGORIES, mine] as typeof CATEGORIES;
    expect(sortCategories(categories).map((c) => c.name)).toEqual([
      'Vegetables',
      'Fruit',
      'Dairy',
      'Meat',
      'Dry goods',
      'Household supplies',
      'Pets',
      'Other',
    ]);
  });

  it.each([
    ['null category', null],
    ['a category the household no longer has', uuid(99)],
  ])('FR-36: an item with %s falls into Other', (_name, categoryId) => {
    const item = shoppingItem(1, { categoryId: categoryId as never });
    const view = buildListView([item], CATEGORIES);
    expect(view.open).toHaveLength(1);
    expect(view.open[0]?.category.systemCode).toBe('other');
  });

  it('FR-37: picked items leave the open groups, stay grouped by category, and are counted', () => {
    const items = [
      shoppingItem(1, { categoryId: CAT.dairy, picked: true }),
      shoppingItem(2, { categoryId: CAT.dairy }),
      shoppingItem(3, { categoryId: CAT.vegetables, picked: true }),
    ];
    const view = buildListView(items, CATEGORIES);
    expect(view.open.map((g) => g.items.map((i) => i.name))).toEqual([['Item 2']]);
    expect(view.picked.map((g) => g.category.systemCode)).toEqual(['vegetables', 'dairy']);
    expect(view.pickedCount).toBe(2);
    expect(view.total).toBe(3);
  });

  it('works without categories loaded: everything is under Other', () => {
    const view = buildListView(groceries(), []);
    expect(view.open).toHaveLength(1);
    expect(view.open[0]?.items).toHaveLength(3);
  });

  it('orders items within a group by creation time', () => {
    const items = [shoppingItem(2), shoppingItem(1)];
    expect(buildListView(items, CATEGORIES).open[0]?.items.map((i) => i.name)).toEqual([
      'Item 1',
      'Item 2',
    ]);
  });
});

describe('optimistic checkoff state (FR-37)', () => {
  const item = shoppingItem(1);
  it('a pending entry shows the desired state', () => {
    const shown = applyCheckoff([item], new Map([[item.id, { desired: true, status: 'pending' }]]));
    expect(shown[0]?.picked).toBe(true);
  });
  it('a rejected entry shows the server state (reverted)', () => {
    const shown = applyCheckoff(
      [item],
      new Map([[item.id, { desired: true, status: 'rejected' }]]),
    );
    expect(shown[0]?.picked).toBe(false);
  });
  it.each([
    [
      'rejected and the server disagrees',
      { desired: true, status: 'rejected' as const },
      false,
      true,
    ],
    [
      'rejected but the server now agrees',
      { desired: true, status: 'rejected' as const },
      true,
      false,
    ],
    ['pending', { desired: true, status: 'pending' as const }, false, false],
    ['no entry', undefined, false, false],
  ])('isRejected: %s', (_name, entry, picked, expected) => {
    expect(isRejected({ ...item, picked }, entry)).toBe(expected);
  });
});

describe('diffItems (announcements, FR-34)', () => {
  const a = shoppingItem(1);
  const b = shoppingItem(2);
  it.each([
    ['added', [a], [a, b], 'added'],
    ['removed', [a, b], [a], 'removed'],
    ['picked', [a], [{ ...a, picked: true, revision: 2 }], 'picked'],
    ['unpicked', [{ ...a, picked: true }], [a], 'unpicked'],
    ['edited', [a], [{ ...a, name: 'x', revision: 2 }], 'changed'],
  ])('%s', (_name, before, after, kind) => {
    expect(diffItems(before, after).map((c) => c.kind)).toEqual([kind]);
  });
  it('no change, no announcement', () => {
    expect(diffItems([a, b], [a, b])).toEqual([]);
  });
});

describe('insertUnit (S4 unit chips)', () => {
  it.each([
    ['', 'l', 'l'],
    ['2', 'l', '2 l'],
    ['2 ', 'dl', '2 dl'],
    ['2 l', 'kg', '2 kg'],
    ['1,5 dl', 'g', '1,5 g'],
    ['2kg', 'prk', '2 prk'],
    ['1-2', 'kpl', '1-2 kpl'],
    ['pieni', 'kpl', 'pieni kpl'],
  ])('insertUnit(%j, %s) = %j', (text, unit, expected) => {
    expect(insertUnit(text, unit)).toBe(expected);
  });
});

describe('formatUpdated', () => {
  const options = { locale: 'fi-FI', timeZone: 'Europe/Helsinki' };
  const now = new Date('2026-11-16T12:00:00Z');
  it('shows the time for today in the household timezone', () => {
    expect(formatUpdated('2026-11-16T08:42:00Z', now, options)).toBe('10.42');
  });
  it('uses the local date, not the UTC date (22:30Z is already tomorrow in Helsinki)', () => {
    expect(formatUpdated('2026-11-16T22:30:00Z', new Date('2026-11-17T08:00:00Z'), options)).toBe(
      '0.30',
    );
  });
  it('shows weekday and date for older updates', () => {
    expect(formatUpdated('2026-11-09T08:42:00Z', now, options)).toMatch(/9\.11\./);
  });
});
