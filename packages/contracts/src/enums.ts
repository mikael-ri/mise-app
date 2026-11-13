// Single source of truth for closed value sets. The database uses these lists for its
// `text` + CHECK columns (ADR-002 addendum: no PostgreSQL enums).

export const MEMBER_ROLES = ['owner', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const RECIPE_SOURCE_TYPES = ['manual', 'url', 'text', 'photo'] as const;
export type RecipeSourceType = (typeof RECIPE_SOURCE_TYPES)[number];

export const SCALE_POLICIES = ['linear', 'round_to_whole', 'to_taste', 'not_scalable'] as const;
export type ScalePolicy = (typeof SCALE_POLICIES)[number];

export const SHOPPING_LIST_STATUSES = ['active', 'archived'] as const;
export type ShoppingListStatus = (typeof SHOPPING_LIST_STATUSES)[number];

export const SHOPPING_ITEM_ORIGINS = ['user', 'generated'] as const;
export type ShoppingItemOrigin = (typeof SHOPPING_ITEM_ORIGINS)[number];

// System-default shopping categories (FR-36). The web maps each code to an i18n key; `other` is the fallback.
export const SYSTEM_CATEGORY_CODES = [
  'vegetables',
  'fruit',
  'dairy',
  'meat',
  'dry_goods',
  'household_supplies',
  'other',
] as const;
export type SystemCategoryCode = (typeof SYSTEM_CATEGORY_CODES)[number];
