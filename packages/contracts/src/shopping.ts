import { z } from 'zod';
import {
  DecimalString,
  Instant,
  MemberId,
  NormalizedKey,
  Revision,
  ShoppingCategoryId,
  ShoppingItemId,
  ShoppingListId,
  multilineText,
  nonEmptyText,
} from './common.js';
import { SHOPPING_ITEM_ORIGINS, SHOPPING_LIST_STATUSES, SYSTEM_CATEGORY_CODES } from './enums.js';

export const ShoppingCategory = z
  .strictObject({
    id: ShoppingCategoryId,
    /** Set for system defaults; the web shows the i18n string for the code instead of `name`. */
    systemCode: z.enum(SYSTEM_CATEGORY_CODES).nullable(),
    name: z.string(),
    sortOrder: z.int(),
  })
  .meta({ id: 'ShoppingCategory' });
export type ShoppingCategory = z.infer<typeof ShoppingCategory>;

export const ShoppingCategoryList = z
  .strictObject({ items: z.array(ShoppingCategory) })
  .meta({ id: 'ShoppingCategoryList' });

export const ShoppingList = z
  .strictObject({
    id: ShoppingListId,
    name: z.string(),
    status: z.enum(SHOPPING_LIST_STATUSES),
    /** SSE sync cursor only; never a write-conflict token (ADR-013). */
    changeSeq: z.int().min(0),
    /** ETag for list edits (name, status). */
    revision: Revision,
    createdByMemberId: MemberId,
    createdAt: Instant,
    updatedAt: Instant,
  })
  .meta({ id: 'ShoppingList' });
export type ShoppingList = z.infer<typeof ShoppingList>;

export const ShoppingItem = z
  .strictObject({
    id: ShoppingItemId,
    listId: ShoppingListId,
    origin: z.enum(SHOPPING_ITEM_ORIGINS),
    name: z.string(),
    normalizedKey: NormalizedKey.nullable(),
    amountMin: DecimalString.nullable(),
    amountMax: DecimalString.nullable(),
    unitCode: z.string().nullable(),
    /** Verbatim quantity text as entered or generated. */
    originalQuantityText: z.string().nullable(),
    note: z.string().nullable(),
    categoryId: ShoppingCategoryId.nullable(),
    picked: z.boolean(),
    pickedAt: Instant.nullable(),
    pickedByMemberId: MemberId.nullable(),
    userModified: z.boolean(),
    /** ETag for detail edits; checkoff does not require it. */
    revision: Revision,
    createdAt: Instant,
    updatedAt: Instant,
  })
  .meta({ id: 'ShoppingItem' });
export type ShoppingItem = z.infer<typeof ShoppingItem>;

export const ShoppingListSummaryList = z
  .strictObject({ items: z.array(ShoppingList) })
  .meta({ id: 'ShoppingListSummaryList' });

/** Authoritative snapshot (GET /shopping-lists/:id). Clients refetch this after any SSE event. */
export const ShoppingListSnapshot = z
  .strictObject({ list: ShoppingList, items: z.array(ShoppingItem) })
  .meta({ id: 'ShoppingListSnapshot' });
export type ShoppingListSnapshot = z.infer<typeof ShoppingListSnapshot>;

export const ShoppingListsQuery = z.strictObject({
  status: z.enum(SHOPPING_LIST_STATUSES).optional(),
});
export const ShoppingListParams = z.strictObject({ id: ShoppingListId });
export const ShoppingItemParams = z.strictObject({ id: ShoppingItemId });

const ListName = nonEmptyText(100);
const ItemName = nonEmptyText(200);
/** Free quantity text ("2 kg", "1-2 prk"); the server parses it and keeps the original. */
const QuantityText = nonEmptyText(100);
const Note = multilineText(500);

/** POST /shopping-lists. Requires `Idempotency-Key`. */
export const CreateShoppingListRequest = z
  .strictObject({ name: ListName })
  .meta({ id: 'CreateShoppingListRequest' });
export type CreateShoppingListRequest = z.infer<typeof CreateShoppingListRequest>;

/** PATCH /shopping-lists/:id. Requires `If-Match`. */
export const PatchShoppingListRequest = z
  .strictObject({ name: ListName.optional(), status: z.enum(SHOPPING_LIST_STATUSES).optional() })
  .refine((p) => Object.keys(p).length > 0, { message: 'no changes given' })
  .meta({ id: 'PatchShoppingListRequest' });
export type PatchShoppingListRequest = z.infer<typeof PatchShoppingListRequest>;

/** POST /shopping-lists/:id/items. Requires `Idempotency-Key`. Always creates an `origin: user` row (FR-35). */
export const AddShoppingItemRequest = z
  .strictObject({
    name: ItemName,
    quantityText: QuantityText.optional(),
    note: Note.optional(),
    categoryId: ShoppingCategoryId.optional(),
  })
  .meta({ id: 'AddShoppingItemRequest' });
export type AddShoppingItemRequest = z.infer<typeof AddShoppingItemRequest>;

/** Checkoff: explicit desired state, never a toggle. No `If-Match`; server-time last write wins (ADR-013). */
export const SetPickedRequest = z
  .strictObject({ picked: z.boolean() })
  .meta({ id: 'SetPickedRequest' });
export type SetPickedRequest = z.infer<typeof SetPickedRequest>;

/** Detail edit. Requires `If-Match`; stale -> 409. */
export const EditShoppingItemRequest = z
  .strictObject({
    name: ItemName.optional(),
    quantityText: QuantityText.nullable().optional(),
    note: Note.nullable().optional(),
    categoryId: ShoppingCategoryId.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'no changes given' })
  .meta({ id: 'EditShoppingItemRequest' });
export type EditShoppingItemRequest = z.infer<typeof EditShoppingItemRequest>;

/**
 * PATCH /shopping-items/:id: either a checkoff or a detail edit, never both in one request,
 * so a checkoff can never be rejected by an unrelated revision (strict objects enforce this).
 */
export const PatchShoppingItemRequest = z
  .union([SetPickedRequest, EditShoppingItemRequest])
  .meta({ id: 'PatchShoppingItemRequest' });
export type PatchShoppingItemRequest = z.infer<typeof PatchShoppingItemRequest>;

export const isSetPicked = (p: PatchShoppingItemRequest): p is SetPickedRequest => 'picked' in p;

/** SSE `data` payload on GET /shopping-lists/:id/events. Carries no item data (ADR-004). */
export const ShoppingListEvent = z
  .strictObject({ listId: ShoppingListId, seq: z.int().min(0) })
  .meta({ id: 'ShoppingListEvent' });
export type ShoppingListEvent = z.infer<typeof ShoppingListEvent>;
