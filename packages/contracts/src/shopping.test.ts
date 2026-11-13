import { describe, expect, it } from 'vitest';
import {
  AddShoppingItemRequest,
  PatchShoppingItemRequest,
  ShoppingItem,
  ShoppingListEvent,
  isSetPicked,
} from './shopping.js';

const ID = '00000000-0000-4000-8000-000000000001';

describe('PatchShoppingItemRequest (FR-37, ADR-013)', () => {
  it.each([
    ['set picked true', { picked: true }, true],
    ['set picked false', { picked: false }, true],
    ['detail edit', { name: 'Maito', quantityText: '2 l' }, true],
    ['clear note', { note: null }, true],
    ['mixing checkoff and edit', { picked: true, name: 'Maito' }, false],
    ['toggle command', { toggle: true }, false],
    ['empty body', {}, false],
    ['picked as string', { picked: 'true' }, false],
    ['client sets revision', { name: 'x', revision: 3 }, false],
  ])('%s', (_name, value, ok) => {
    expect(PatchShoppingItemRequest.safeParse(value).success).toBe(ok);
  });

  it('distinguishes checkoff from edit', () => {
    expect(isSetPicked(PatchShoppingItemRequest.parse({ picked: true }))).toBe(true);
    expect(isSetPicked(PatchShoppingItemRequest.parse({ name: 'x' }))).toBe(false);
  });
});

describe('AddShoppingItemRequest (FR-35, FR-39)', () => {
  it.each([
    ['non-food item without quantity', { name: 'Talouspaperi' }, true],
    [
      'with quantity text and note',
      { name: 'Maito', quantityText: '2 l', note: 'laktoositon' },
      true,
    ],
    ['client chooses origin', { name: 'x', origin: 'generated' }, false],
    ['client sets user_modified', { name: 'x', userModified: true }, false],
    ['blank name', { name: ' ' }, false],
  ])('%s', (_name, value, ok) => {
    expect(AddShoppingItemRequest.safeParse(value).success).toBe(ok);
  });
});

describe('ShoppingItem response', () => {
  const item = {
    id: ID,
    listId: ID,
    origin: 'user',
    name: 'Maito',
    normalizedKey: 'maito',
    amountMin: '2',
    amountMax: null,
    unitCode: 'l',
    originalQuantityText: '2 l',
    note: null,
    categoryId: null,
    picked: false,
    pickedAt: null,
    pickedByMemberId: null,
    userModified: false,
    revision: 1,
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00+02:00',
  };

  it('accepts numeric amounts only as decimal strings', () => {
    expect(ShoppingItem.safeParse(item).success).toBe(true);
    expect(ShoppingItem.safeParse({ ...item, amountMin: 2 }).success).toBe(false);
  });
});

describe('ShoppingListEvent (ADR-004)', () => {
  it('carries only listId and seq', () => {
    expect(ShoppingListEvent.safeParse({ listId: ID, seq: 3 }).success).toBe(true);
    expect(ShoppingListEvent.safeParse({ listId: ID, seq: 3, item: { name: 'x' } }).success).toBe(
      false,
    );
  });
});
