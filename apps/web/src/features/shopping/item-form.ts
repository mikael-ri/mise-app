import type { EditShoppingItemRequest, ShoppingCategory, ShoppingItem } from '@mise/contracts';

/** Item sheet form state (S4). Category '' means "Automatic". */
export interface ItemFormValues {
  name: string;
  quantity: string;
  note: string;
  categoryId: string;
  picked: boolean;
}

export function formFromItem(item: ShoppingItem): ItemFormValues {
  return {
    name: item.name,
    quantity: item.originalQuantityText ?? '',
    note: item.note ?? '',
    categoryId: item.categoryId ?? '',
    picked: item.picked,
  };
}

export type ItemFormIssue = 'nameRequired';

export function validateForm(values: ItemFormValues): ItemFormIssue | null {
  return values.name.trim() === '' ? 'nameRequired' : null;
}

/**
 * Only changed fields are sent. `categoryId` is included only when the user changed it from the
 * initial value, so an untouched select can never trigger the household-correction rule (A13);
 * choosing Automatic after an override sends `null`. Cleared quantity/note send `null`.
 * Returns null when nothing but possibly `picked` changed.
 */
export function buildEditBody(
  initial: ItemFormValues,
  current: ItemFormValues,
): EditShoppingItemRequest | null {
  const body: {
    name?: string;
    quantityText?: string | null;
    note?: string | null;
    categoryId?: ShoppingCategory['id'] | null;
  } = {};
  if (current.name.trim() !== initial.name.trim()) body.name = current.name.trim();
  if (current.quantity.trim() !== initial.quantity.trim()) {
    body.quantityText = current.quantity.trim() === '' ? null : current.quantity.trim();
  }
  if (current.note.trim() !== initial.note.trim()) {
    body.note = current.note.trim() === '' ? null : current.note.trim();
  }
  if (current.categoryId !== initial.categoryId) {
    body.categoryId =
      current.categoryId === '' ? null : (current.categoryId as ShoppingCategory['id']);
  }
  return Object.keys(body).length === 0 ? null : body;
}

/** Normalized name shown in "Remember this category for ..." (lowercased, trimmed). */
export function rememberKey(item: ShoppingItem, name: string): string {
  const trimmed = name.trim();
  if (trimmed === item.name.trim() && item.normalizedKey !== null) return item.normalizedKey;
  return trimmed.toLowerCase();
}

/**
 * "Show latest" after a stale edit: fields the user changed (against the revision they started
 * from) keep their draft value; every other field takes the latest server value.
 */
export function mergeLatest(
  initial: ItemFormValues,
  draft: ItemFormValues,
  latest: ItemFormValues,
): ItemFormValues {
  const pick = <K extends keyof ItemFormValues>(key: K): ItemFormValues[K] =>
    draft[key] === initial[key] ? latest[key] : draft[key];
  return {
    name: pick('name'),
    quantity: pick('quantity'),
    note: pick('note'),
    categoryId: pick('categoryId'),
    picked: pick('picked'),
  };
}
