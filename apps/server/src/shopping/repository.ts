import type { Queryable } from '../platform/index.js';
import { scopedQuery } from '../platform/index.js';

// All SQL for shopping lists, items, categories and household ingredient settings. Every statement is
// household-scoped. System-default categories have household_id NULL and are visible to every
// household, so category reads use `(household_id = $1 OR household_id IS NULL)`.

export interface CategoryRow {
  id: string;
  householdId: string | null;
  systemCode: string | null;
  name: string;
  sortOrder: number;
}

export interface ListRow {
  id: string;
  name: string;
  status: 'active' | 'archived';
  changeSeq: number;
  revision: number;
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemRow {
  id: string;
  listId: string;
  origin: 'user' | 'generated';
  name: string;
  normalizedKey: string | null;
  amountMin: string | null;
  amountMax: string | null;
  unitCode: string | null;
  originalQuantityText: string | null;
  note: string | null;
  categoryId: string | null;
  picked: boolean;
  pickedAt: Date | null;
  pickedByMemberId: string | null;
  userModified: boolean;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Columns a detail edit may set. Quantity fields always change together. */
export interface ItemDetails {
  name: string;
  normalizedKey: string | null;
  amountMin: string | null;
  amountMax: string | null;
  unitCode: string | null;
  originalQuantityText: string | null;
  note: string | null;
  categoryId: string | null;
}

// ---------------------------------------------------------------------------------------------
// Categories

const CATEGORY_COLS = `id, household_id AS "householdId", system_code AS "systemCode", name,
  sort_order AS "sortOrder"`;

export async function listCategories(q: Queryable, householdId: string): Promise<CategoryRow[]> {
  const { rows } = await scopedQuery<CategoryRow>(
    q,
    householdId,
    `SELECT ${CATEGORY_COLS} FROM shopping_categories
      WHERE (household_id = $1 OR household_id IS NULL)
      ORDER BY sort_order, name, id`,
  );
  return rows;
}

/** A system category or one of the household's own; absent and foreign are indistinguishable. */
export async function getVisibleCategory(
  q: Queryable,
  householdId: string,
  id: string,
): Promise<CategoryRow | undefined> {
  const { rows } = await scopedQuery<CategoryRow>(
    q,
    householdId,
    `SELECT ${CATEGORY_COLS} FROM shopping_categories
      WHERE (household_id = $1 OR household_id IS NULL) AND id = $2`,
    [id],
  );
  return rows[0];
}

/** The `other` fallback category (FR-36), seeded by migration 0001. */
export async function getOtherCategoryId(q: Queryable, householdId: string): Promise<string> {
  const { rows } = await scopedQuery<{ id: string }>(
    q,
    householdId,
    `SELECT id FROM shopping_categories
      WHERE (household_id = $1 OR household_id IS NULL) AND system_code = 'other'`,
  );
  const row = rows[0];
  if (!row) throw new Error('system category "other" is missing (migration 0001)');
  return row.id;
}

/**
 * Serializes category name changes within one household for the rest of the transaction, so the
 * case-insensitive uniqueness check cannot race (the schema's unique index is case-sensitive).
 * An advisory lock, not a row lock: locking `households` would contend with FK checks elsewhere.
 */
export async function lockCategoryNames(q: Queryable, householdId: string): Promise<void> {
  await q.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('mise.shopping_categories:' || $1::text, 0))`,
    [householdId],
  );
}

/**
 * True when a system or household category already uses the name, ignoring case and surrounding
 * spaces. System names are the stored fallback labels (e.g. "Other").
 */
export async function categoryNameTaken(
  q: Queryable,
  householdId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const { rowCount } = await scopedQuery(
    q,
    householdId,
    `SELECT 1 FROM shopping_categories
      WHERE (household_id = $1 OR household_id IS NULL)
        AND lower(btrim(name)) = lower(btrim($2))
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [name, exceptId],
  );
  return (rowCount ?? 0) > 0;
}

/** 10 after the last visible category other than the `other` fallback (gapped ordering). */
export async function nextCategorySortOrder(q: Queryable, householdId: string): Promise<number> {
  const { rows } = await scopedQuery<{ next: number }>(
    q,
    householdId,
    `SELECT coalesce(max(sort_order), 0) + 10 AS next FROM shopping_categories
      WHERE (household_id = $1 OR household_id IS NULL) AND system_code IS DISTINCT FROM 'other'`,
  );
  return rows[0]!.next;
}

export async function insertCategory(
  q: Queryable,
  householdId: string,
  name: string,
  sortOrder: number,
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO shopping_categories (household_id, name, sort_order, is_system_default)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [householdId, name, sortOrder],
  );
  return rows[0]!.id;
}

/** Household rows only: system defaults are never updated by the app. */
export async function updateCategory(
  q: Queryable,
  householdId: string,
  id: string,
  change: { name?: string | undefined; sortOrder?: number | undefined },
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `UPDATE shopping_categories
        SET name = coalesce($3, name), sort_order = coalesce($4, sort_order)
      WHERE household_id = $1 AND id = $2`,
    [id, change.name ?? null, change.sortOrder ?? null],
  );
}

// ---------------------------------------------------------------------------------------------
// Household ingredient settings (ADR-015: category override and staple flag per normalized key)

export async function getCategoryOverride(
  q: Queryable,
  householdId: string,
  normalizedKey: string,
): Promise<string | null> {
  const { rows } = await scopedQuery<{ categoryId: string | null }>(
    q,
    householdId,
    `SELECT shopping_category_id AS "categoryId" FROM household_ingredient_settings
      WHERE household_id = $1 AND normalized_key = $2`,
    [normalizedKey],
  );
  return rows[0]?.categoryId ?? null;
}

/** Upsert; the revision only moves when the stored value actually changes. */
export async function upsertCategoryOverride(
  q: Queryable,
  householdId: string,
  normalizedKey: string,
  categoryId: string | null,
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `INSERT INTO household_ingredient_settings AS s (household_id, normalized_key, shopping_category_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (household_id, normalized_key) DO UPDATE
        SET shopping_category_id = EXCLUDED.shopping_category_id,
            revision = s.revision + 1, updated_at = now()
      WHERE s.household_id = $1
        AND s.shopping_category_id IS DISTINCT FROM EXCLUDED.shopping_category_id`,
    [normalizedKey, categoryId],
  );
}

export async function upsertStaple(
  q: Queryable,
  householdId: string,
  normalizedKey: string,
  isStaple: boolean,
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `INSERT INTO household_ingredient_settings AS s (household_id, normalized_key, is_staple)
     VALUES ($1, $2, $3)
     ON CONFLICT (household_id, normalized_key) DO UPDATE
        SET is_staple = EXCLUDED.is_staple, revision = s.revision + 1, updated_at = now()
      WHERE s.household_id = $1 AND s.is_staple IS DISTINCT FROM EXCLUDED.is_staple`,
    [normalizedKey, isStaple],
  );
}

// ---------------------------------------------------------------------------------------------
// Lists

const LIST_COLS = `id, name, status, change_seq AS "changeSeq", revision,
  created_by_member_id AS "createdByMemberId", created_at AS "createdAt", updated_at AS "updatedAt"`;

// bigint arrives as a string from pg; change_seq stays far below 2^53 for a household app.
const toList = (r: ListRow): ListRow => ({ ...r, changeSeq: Number(r.changeSeq) });

export async function listLists(
  q: Queryable,
  householdId: string,
  status: 'active' | 'archived',
): Promise<ListRow[]> {
  const { rows } = await scopedQuery<ListRow>(
    q,
    householdId,
    `SELECT ${LIST_COLS} FROM shopping_lists WHERE household_id = $1 AND status = $2
      ORDER BY created_at DESC, id`,
    [status],
  );
  return rows.map(toList);
}

/**
 * `lock` takes the list row lock. Every write that touches a list's items takes it first, so writers
 * on one list are serialized and always lock list -> item (no deadlocks).
 */
export async function getList(
  q: Queryable,
  householdId: string,
  id: string,
  lock = false,
): Promise<ListRow | undefined> {
  const { rows } = await scopedQuery<ListRow>(
    q,
    householdId,
    `SELECT ${LIST_COLS} FROM shopping_lists WHERE household_id = $1 AND id = $2
      ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toList(rows[0]) : undefined;
}

export async function insertList(
  q: Queryable,
  householdId: string,
  memberId: string,
  name: string,
): Promise<string> {
  const { rows } = await scopedQuery<{ id: string }>(
    q,
    householdId,
    `INSERT INTO shopping_lists (household_id, created_by_member_id, name)
     SELECT $1, $2, $3 FROM household_members WHERE household_id = $1 AND id = $2
     RETURNING id`,
    [memberId, name],
  );
  const row = rows[0];
  if (!row) throw new Error('actor member is not in the household');
  return row.id;
}

/** Name/status change: bumps the list revision and the sync cursor (open views refetch). */
export async function updateList(
  q: Queryable,
  householdId: string,
  id: string,
  change: { name: string; status: 'active' | 'archived' },
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `UPDATE shopping_lists
        SET name = $3, status = $4, revision = revision + 1, change_seq = change_seq + 1,
            updated_at = now()
      WHERE household_id = $1 AND id = $2`,
    [id, change.name, change.status],
  );
}

/** Advances the sync cursor in the caller's transaction (ADR-013, DB §8.2). */
export async function bumpChangeSeq(
  q: Queryable,
  householdId: string,
  listId: string,
): Promise<number> {
  const { rows } = await scopedQuery<{ seq: string }>(
    q,
    householdId,
    `UPDATE shopping_lists SET change_seq = change_seq + 1
      WHERE household_id = $1 AND id = $2 RETURNING change_seq AS seq`,
    [listId],
  );
  const row = rows[0];
  if (!row) throw new Error('shopping list vanished inside its own transaction');
  return Number(row.seq);
}

// ---------------------------------------------------------------------------------------------
// Items

const ITEM_COLS = `id, shopping_list_id AS "listId", origin, name, normalized_key AS "normalizedKey",
  amount_min::text AS "amountMin", amount_max::text AS "amountMax", unit_code AS "unitCode",
  original_quantity_text AS "originalQuantityText", note, category_id AS "categoryId", picked,
  picked_at AS "pickedAt", picked_by_member_id AS "pickedByMemberId",
  user_modified AS "userModified", revision, created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listItems(
  q: Queryable,
  householdId: string,
  listId: string,
): Promise<ItemRow[]> {
  const { rows } = await scopedQuery<ItemRow>(
    q,
    householdId,
    `SELECT ${ITEM_COLS} FROM shopping_items WHERE household_id = $1 AND shopping_list_id = $2
      ORDER BY created_at, id`,
    [listId],
  );
  return rows;
}

export async function getItem(
  q: Queryable,
  householdId: string,
  id: string,
  lock = false,
): Promise<ItemRow | undefined> {
  const { rows } = await scopedQuery<ItemRow>(
    q,
    householdId,
    `SELECT ${ITEM_COLS} FROM shopping_items WHERE household_id = $1 AND id = $2
      ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0];
}

/**
 * Always `origin = 'user'` in Milestone A (FR-35). The composite FK (household_id, shopping_list_id)
 * rejects a list from another household.
 */
export async function insertUserItem(
  q: Queryable,
  householdId: string,
  listId: string,
  d: ItemDetails,
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO shopping_items (household_id, shopping_list_id, origin, name, normalized_key,
       amount_min, amount_max, unit_code, original_quantity_text, note, category_id)
     VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      householdId,
      listId,
      d.name,
      d.normalizedKey,
      d.amountMin,
      d.amountMax,
      d.unitCode,
      d.originalQuantityText,
      d.note,
      d.categoryId,
    ],
  );
  return rows[0]!.id;
}

/** Detail edit: bumps only this item's revision and marks it user-modified. */
export async function updateItemDetails(
  q: Queryable,
  householdId: string,
  id: string,
  d: ItemDetails,
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `UPDATE shopping_items
        SET name = $3, normalized_key = $4, amount_min = $5, amount_max = $6, unit_code = $7,
            original_quantity_text = $8, note = $9, category_id = $10, user_modified = true,
            revision = revision + 1, updated_at = clock_timestamp()
      WHERE household_id = $1 AND id = $2`,
    [
      id,
      d.name,
      d.normalizedKey,
      d.amountMin,
      d.amountMax,
      d.unitCode,
      d.originalQuantityText,
      d.note,
      d.categoryId,
    ],
  );
}

/**
 * Desired-state checkoff. Writes only when the state differs (idempotent) and returns whether it
 * did. Does not touch `revision`, so a checkoff never makes a concurrent detail edit stale.
 * `clock_timestamp()`: the time this write took effect, after waiting for the list lock, so the
 * later committed write also carries the later time (server-time last write wins).
 */
export async function setPicked(
  q: Queryable,
  householdId: string,
  id: string,
  picked: boolean,
  memberId: string,
): Promise<boolean> {
  const { rowCount } = await scopedQuery(
    q,
    householdId,
    `UPDATE shopping_items
        SET picked = $3,
            picked_at = CASE WHEN $3 THEN clock_timestamp() END,
            picked_by_member_id = CASE WHEN $3 THEN $4::uuid END,
            updated_at = clock_timestamp()
      WHERE household_id = $1 AND id = $2 AND picked IS DISTINCT FROM $3`,
    [id, picked, memberId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteItem(q: Queryable, householdId: string, id: string): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    'DELETE FROM shopping_items WHERE household_id = $1 AND id = $2',
    [id],
  );
}
