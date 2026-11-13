import { z } from 'zod';

// Opaque UUID identifiers, branded so one kind of ID cannot be passed where another is expected.
export const UserId = z.uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;
export const HouseholdId = z.uuid().brand<'HouseholdId'>();
export type HouseholdId = z.infer<typeof HouseholdId>;
export const MemberId = z.uuid().brand<'MemberId'>();
export type MemberId = z.infer<typeof MemberId>;
export const DeviceSessionId = z.uuid().brand<'DeviceSessionId'>();
export type DeviceSessionId = z.infer<typeof DeviceSessionId>;
export const RecipeId = z.uuid().brand<'RecipeId'>();
export type RecipeId = z.infer<typeof RecipeId>;
export const RecipeVersionId = z.uuid().brand<'RecipeVersionId'>();
export type RecipeVersionId = z.infer<typeof RecipeVersionId>;
export const ShoppingListId = z.uuid().brand<'ShoppingListId'>();
export type ShoppingListId = z.infer<typeof ShoppingListId>;
export const ShoppingItemId = z.uuid().brand<'ShoppingItemId'>();
export type ShoppingItemId = z.infer<typeof ShoppingItemId>;
export const ShoppingCategoryId = z.uuid().brand<'ShoppingCategoryId'>();
export type ShoppingCategoryId = z.infer<typeof ShoppingCategoryId>;

/** Instant in UTC, ISO 8601 with offset (DB `timestamptz`). */
export const Instant = z.iso.datetime({ offset: true });

/** Per-resource edit revision; also the ETag value. */
export const Revision = z.int().min(1).max(2_147_483_647);

/**
 * Non-negative exact decimal as a string, e.g. "0.5" or "12". Never a JS number (hard rule 3).
 * Matches DB `numeric` columns.
 */
export const DecimalString = z
  .string()
  .max(40)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'expected a non-negative decimal string');

/**
 * Non-negative exact rational as a string: a decimal ("1.5") or a simple fraction ("1/3").
 * Used inside recipe content, where thirds must stay exact.
 */
export const RationalString = z
  .string()
  .max(40)
  .regex(
    /^((0|[1-9]\d*)(\.\d+)?|(0|[1-9]\d*)\/[1-9]\d*)$/,
    'expected a non-negative decimal or fraction string',
  );

/** Trimmed, non-empty single-line text. */
export const nonEmptyText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]*$/, 'must be a single line');

/** Trimmed free text (may contain newlines), non-empty. */
export const multilineText = (max: number) => z.string().trim().min(1).max(max);

/** Normalized ingredient key: lowercased and trimmed (ADR-015, Milestone A). */
export const NormalizedKey = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v === v.trim().toLowerCase(), 'must be lowercased and trimmed');
