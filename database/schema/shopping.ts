import {
  SHOPPING_ITEM_ORIGINS,
  SHOPPING_LIST_STATUSES,
  SYSTEM_CATEGORY_CODES,
} from '@mise/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, isIn, updatedAt } from './columns';
import { householdMembers, households } from './identity';

// Shopping categories (DB design, ingredient/category tables). System defaults have household_id NULL and a system_code; household overrides
// have a household_id. A household may only reference system rows or its own rows: enforced in the
// shopping service (A13), not by a trigger (owner decision, A04).
export const shoppingCategories = pgTable(
  'shopping_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'restrict' }),
    systemCode: text('system_code', { enum: SYSTEM_CATEGORY_CODES }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    isSystemDefault: boolean('is_system_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('shopping_categories_system_code_uq').on(t.systemCode),
    unique('shopping_categories_household_name_uq').on(t.householdId, t.name),
    check(
      'shopping_categories_scope_ck',
      sql`(${t.isSystemDefault} AND ${t.householdId} IS NULL AND ${t.systemCode} IS NOT NULL) OR (NOT ${t.isSystemDefault} AND ${t.householdId} IS NOT NULL AND ${t.systemCode} IS NULL)`,
    ),
    check(
      'shopping_categories_system_code_ck',
      sql`${t.systemCode} IS NULL OR ${isIn(t.systemCode, SYSTEM_CATEGORY_CODES)}`,
    ),
    check('shopping_categories_name_nonempty_ck', sql`btrim(${t.name}) <> ''`),
  ],
);

// Per-household rules keyed by normalized ingredient key (ADR-015). Affects shopping only, never recipe text.
export const householdIngredientSettings = pgTable(
  'household_ingredient_settings',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    normalizedKey: text('normalized_key').notNull(),
    isStaple: boolean('is_staple').notNull().default(false),
    shoppingCategoryId: uuid('shopping_category_id').references(() => shoppingCategories.id, {
      onDelete: 'restrict',
    }),
    preferredLabel: text('preferred_label'),
    revision: integer('revision').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'household_ingredient_settings_pk',
      columns: [t.householdId, t.normalizedKey],
    }),
    check(
      'household_ingredient_settings_key_ck',
      sql`${t.normalizedKey} <> '' AND ${t.normalizedKey} = btrim(${t.normalizedKey})`,
    ),
    check('household_ingredient_settings_revision_ck', sql`${t.revision} >= 1`),
  ],
);

// DB §8. Independent of plans (FR-34).
export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: text('status', { enum: SHOPPING_LIST_STATUSES }).notNull().default('active'),
    // SSE sync cursor only, never a write-conflict token (ADR-013). Incremented in the item-change transaction.
    changeSeq: bigint('change_seq', { mode: 'number' }).notNull().default(0),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Target for the composite FK from shopping_items.
    unique('shopping_lists_household_id_uq').on(t.householdId, t.id),
    foreignKey({
      name: 'shopping_lists_creator_same_household_fk',
      columns: [t.householdId, t.createdByMemberId],
      foreignColumns: [householdMembers.householdId, householdMembers.id],
    }).onDelete('restrict'),
    index('shopping_lists_household_status_idx').on(t.householdId, t.status),
    check('shopping_lists_status_ck', isIn(t.status, SHOPPING_LIST_STATUSES)),
    check('shopping_lists_change_seq_ck', sql`${t.changeSeq} >= 0`),
    check('shopping_lists_revision_ck', sql`${t.revision} >= 1`),
    check('shopping_lists_name_nonempty_ck', sql`btrim(${t.name}) <> ''`),
  ],
);

// origin / normalized_key / user_modified / revision exist from Milestone A so D needs no destructive
// migration (DB §14). household_id is denormalised here so composite FKs keep the list and the picker
// in the same household (DB §3).
export const shoppingItems = pgTable(
  'shopping_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id').notNull(),
    shoppingListId: uuid('shopping_list_id').notNull(),
    origin: text('origin', { enum: SHOPPING_ITEM_ORIGINS }).notNull(),
    name: text('name').notNull(),
    normalizedKey: text('normalized_key'),
    amountMin: numeric('amount_min'),
    amountMax: numeric('amount_max'),
    unitCode: text('unit_code'),
    originalQuantityText: text('original_quantity_text'),
    note: text('note'), // FR-35
    categoryId: uuid('category_id').references(() => shoppingCategories.id, {
      onDelete: 'restrict',
    }),
    picked: boolean('picked').notNull().default(false),
    pickedAt: timestamp('picked_at', { withTimezone: true }),
    pickedByMemberId: uuid('picked_by_member_id'),
    userModified: boolean('user_modified').notNull().default(false),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'shopping_items_list_same_household_fk',
      columns: [t.householdId, t.shoppingListId],
      foreignColumns: [shoppingLists.householdId, shoppingLists.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'shopping_items_picker_same_household_fk',
      columns: [t.householdId, t.pickedByMemberId],
      foreignColumns: [householdMembers.householdId, householdMembers.id],
    }).onDelete('restrict'),
    index('shopping_items_list_idx').on(t.shoppingListId),
    check('shopping_items_origin_ck', isIn(t.origin, SHOPPING_ITEM_ORIGINS)),
    check('shopping_items_name_nonempty_ck', sql`btrim(${t.name}) <> ''`),
    check(
      'shopping_items_normalized_key_ck',
      sql`${t.normalizedKey} IS NULL OR (${t.normalizedKey} <> '' AND ${t.normalizedKey} = btrim(${t.normalizedKey}))`,
    ),
    check(
      'shopping_items_amounts_ck',
      sql`(${t.amountMin} IS NULL OR ${t.amountMin} >= 0) AND (${t.amountMax} IS NULL OR (${t.amountMin} IS NOT NULL AND ${t.amountMax} >= ${t.amountMin}))`,
    ),
    // Desired-state checkoff keeps attribution consistent with the flag.
    check(
      'shopping_items_picked_ck',
      sql`(${t.picked} AND ${t.pickedAt} IS NOT NULL AND ${t.pickedByMemberId} IS NOT NULL) OR (NOT ${t.picked} AND ${t.pickedAt} IS NULL AND ${t.pickedByMemberId} IS NULL)`,
    ),
    check('shopping_items_revision_ck', sql`${t.revision} >= 1`),
  ],
);
