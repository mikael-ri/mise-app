import {
  ShoppingCategory,
  ShoppingItem,
  ShoppingList,
  ShoppingListSnapshot,
} from '@mise/contracts';
import { ME } from '../../test/fixtures.js';

/** Valid v4 UUID from a small number. */
export const uuid = <T extends string = string>(n: number): T =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as T;

export const LIST_ID: ShoppingList['id'] = uuid(2000);

const category = (
  n: number,
  code: ShoppingCategory['systemCode'],
  name: string,
  sortOrder: number,
) => ShoppingCategory.parse({ id: uuid(n), systemCode: code, name, sortOrder });

export const CATEGORIES: ShoppingCategory[] = [
  category(1, 'vegetables', 'Vegetables', 10),
  category(2, 'fruit', 'Fruit', 20),
  category(3, 'dairy', 'Dairy', 30),
  category(4, 'meat', 'Meat', 40),
  category(5, 'dry_goods', 'Dry goods', 50),
  category(6, 'household_supplies', 'Household supplies', 60),
  category(7, 'other', 'Other', 1000),
];
export const CAT: Record<'vegetables' | 'dairy' | 'other', ShoppingCategory['id']> = {
  vegetables: uuid(1),
  dairy: uuid(3),
  other: uuid(7),
};

export function shoppingItem(n: number, over: Partial<ShoppingItem> = {}): ShoppingItem {
  return ShoppingItem.parse({
    id: uuid(3000 + n),
    listId: LIST_ID,
    origin: 'user',
    name: `Item ${n}`,
    normalizedKey: `item ${n}`,
    amountMin: null,
    amountMax: null,
    unitCode: null,
    originalQuantityText: null,
    note: null,
    categoryId: CAT.other,
    picked: false,
    pickedAt: null,
    pickedByMemberId: null,
    userModified: false,
    revision: 1,
    createdAt: `2026-11-16T08:${String(10 + n).padStart(2, '0')}:00Z`,
    updatedAt: `2026-11-16T08:${String(10 + n).padStart(2, '0')}:00Z`,
    ...over,
  });
}

export function shoppingList(over: Partial<ShoppingList> = {}): ShoppingList {
  return ShoppingList.parse({
    id: LIST_ID,
    name: 'Weekend shop',
    status: 'active',
    changeSeq: 1,
    revision: 1,
    createdByMemberId: ME.member.id,
    createdAt: '2026-11-16T08:00:00Z',
    updatedAt: '2026-11-16T08:30:00Z',
    ...over,
  });
}

export function snapshotOf(
  items: ShoppingItem[],
  list: Partial<ShoppingList> = {},
): ShoppingListSnapshot {
  return ShoppingListSnapshot.parse({ list: shoppingList(list), items });
}

/** milk (dairy), carrots (vegetables), batteries (other). */
export function groceries(): ShoppingItem[] {
  return [
    shoppingItem(1, {
      name: 'Milk',
      categoryId: CAT.dairy,
      originalQuantityText: '2 l',
      normalizedKey: 'milk',
    }),
    shoppingItem(2, {
      name: 'Carrots',
      categoryId: CAT.vegetables,
      originalQuantityText: '1 kg',
      normalizedKey: 'carrots',
    }),
    shoppingItem(3, {
      name: 'Batteries AA',
      categoryId: CAT.other,
      originalQuantityText: '4 kpl',
      normalizedKey: 'batteries aa',
    }),
  ];
}
