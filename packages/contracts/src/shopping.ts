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
export type ShoppingCategoryList = z.infer<typeof ShoppingCategoryList>;

export const ShoppingCategoryParams = z.strictObject({ id: ShoppingCategoryId });

const CategoryName = nonEmptyText(50);
/**
 * Gapped ordering (system defaults use 10, 20, ... and `other` 1000): moving one category is one
 * PATCH of one row to a value between its new neighbours, never a renumbering of the others.
 * Ties sort by name, then id.
 */
const SortOrder = z.int().min(0).max(1_000_000);

/**
 * POST /shopping-categories (FR-36). Requires `Idempotency-Key`. A name must not match any system
 * or household category name, ignoring case and surrounding spaces (`409 category_name_taken`).
 * Without `sortOrder` the category goes 10 after the last non-`other` category.
 */
export const CreateShoppingCategoryRequest = z
  .strictObject({ name: CategoryName, sortOrder: SortOrder.optional() })
  .meta({ id: 'CreateShoppingCategoryRequest' });
export type CreateShoppingCategoryRequest = z.infer<typeof CreateShoppingCategoryRequest>;

/**
 * PATCH /shopping-categories/:id: rename or reorder a household category; system defaults are
 * read-only. Deliberately last-write-wins with no `If-Match` (owner decision, A13): concurrent
 * edits of one category are very unlikely and a revision column would change the frozen schema.
 * No delete in Milestone A.
 */
export const PatchShoppingCategoryRequest = z
  .strictObject({ name: CategoryName.optional(), sortOrder: SortOrder.optional() })
  .refine((p) => Object.keys(p).length > 0, { message: 'no changes given' })
  .meta({ id: 'PatchShoppingCategoryRequest' });
export type PatchShoppingCategoryRequest = z.infer<typeof PatchShoppingCategoryRequest>;

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
export type ShoppingListSummaryList = z.infer<typeof ShoppingListSummaryList>;

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

/**
 * POST /shopping-lists/:id/items. Requires `Idempotency-Key`. Always creates an `origin: user` row
 * (FR-35). A `categoryId` that differs from the categorizer's default for the name is stored as the
 * household correction for that name; one equal to the default writes nothing (ADR-015 addendum).
 * A replay re-reads the item (ADR-013 addendum), so a replay after the item was deleted is `404`.
 */
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

/**
 * Detail edit. Requires `If-Match`; stale -> 409. `categoryId`: a value that differs from the
 * categorizer's default for the name replaces the household correction; one equal to the default
 * writes nothing. `null` puts the item in its default category and never changes a correction.
 * A rename keeps the item's category.
 */
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
