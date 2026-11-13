import { z } from 'zod';
import {
  Instant,
  MemberId,
  RationalString,
  RecipeId,
  RecipeVersionId,
  Revision,
  NormalizedKey,
  multilineText,
  nonEmptyText,
} from './common.js';
import { RECIPE_SOURCE_TYPES, SCALE_POLICIES } from './enums.js';

// ---------------------------------------------------------------------------------------------
// Recipe version content, schema v1 (DB §5.2, tech §5.1). Stored verbatim in
// `recipe_versions.content` (JSONB), so its keys are snake_case in the API too.
// Original text and units are always preserved next to any parsed values (hard rule 3).
// ---------------------------------------------------------------------------------------------

export const RECIPE_CONTENT_SCHEMA_VERSION = 1;

const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const IngredientGroupV1 = z.strictObject({
  id: z.uuid(),
  name: nonEmptyText(200),
  order: z.int().min(1),
});

export const IngredientAlternativeV1 = z.strictObject({
  display_name: nonEmptyText(200),
  original_quantity_text: nullableText(100),
});

export const IngredientLineV1 = z
  .strictObject({
    id: z.uuid(), // stable line ID, kept across versions; shopping sources reference it later
    group_id: z.uuid().nullable(),
    display_name: nonEmptyText(200),
    normalized_key: NormalizedKey.nullable(),
    original_quantity_text: nullableText(100), // verbatim, e.g. "1 prk", "1-2", "maun mukaan"
    amount_min: RationalString.nullable(),
    amount_max: RationalString.nullable(),
    original_unit: nullableText(40), // verbatim, e.g. "prk"
    canonical_unit_code: nullableText(40), // code from the domain unit table, e.g. "package"
    preparation_note: nullableText(500),
    scale_policy: z.enum(SCALE_POLICIES),
    alternatives: z.array(IngredientAlternativeV1).max(10),
    uncertainties: z.array(nonEmptyText(300)).max(20),
  })
  // Comparing min <= max needs rational maths; the service checks it with @mise/domain.
  .refine((l) => l.amount_max === null || l.amount_min !== null, {
    message: 'amount_max requires amount_min',
    path: ['amount_max'],
  });

export const InstructionStepV1 = z.strictObject({
  id: z.uuid(),
  order: z.int().min(1),
  text: multilineText(4000),
});

export const RecipeYieldV1 = z.strictObject({
  quantity: RationalString.refine((v) => /[1-9]/.test(v.split('/')[0] ?? ''), 'must be positive'),
  unit: nonEmptyText(40),
});

const duplicates = (values: readonly (string | number)[]): boolean =>
  new Set(values).size !== values.length;

export const RecipeContentV1 = z
  .strictObject({
    schema_version: z.literal(RECIPE_CONTENT_SCHEMA_VERSION),
    yield: RecipeYieldV1,
    prep_minutes: z.int().min(0).max(10_000).nullable(),
    cook_minutes: z.int().min(0).max(10_000).nullable(),
    ingredient_groups: z.array(IngredientGroupV1).max(30),
    ingredients: z.array(IngredientLineV1).max(200),
    instructions: z.array(InstructionStepV1).max(100),
  })
  .superRefine((c, ctx) => {
    const groupIds = c.ingredient_groups.map((g) => g.id);
    if (duplicates(groupIds))
      ctx.addIssue({ code: 'custom', message: 'duplicate group id', path: ['ingredient_groups'] });
    if (duplicates(c.ingredient_groups.map((g) => g.order)))
      ctx.addIssue({
        code: 'custom',
        message: 'duplicate group order',
        path: ['ingredient_groups'],
      });
    if (duplicates(c.ingredients.map((l) => l.id)))
      ctx.addIssue({
        code: 'custom',
        message: 'duplicate ingredient line id',
        path: ['ingredients'],
      });
    const known = new Set(groupIds);
    c.ingredients.forEach((l, i) => {
      if (l.group_id !== null && !known.has(l.group_id))
        ctx.addIssue({
          code: 'custom',
          message: 'unknown group_id',
          path: ['ingredients', i, 'group_id'],
        });
    });
    if (duplicates(c.instructions.map((s) => s.id)))
      ctx.addIssue({ code: 'custom', message: 'duplicate instruction id', path: ['instructions'] });
    if (duplicates(c.instructions.map((s) => s.order)))
      ctx.addIssue({
        code: 'custom',
        message: 'duplicate instruction order',
        path: ['instructions'],
      });
  })
  .meta({ id: 'RecipeContentV1' });
export type RecipeContentV1 = z.infer<typeof RecipeContentV1>;

/** All accepted content versions. Add new versions here; never change v1 in place. */
export const RecipeContent = RecipeContentV1;
export type RecipeContent = RecipeContentV1;

// ---------------------------------------------------------------------------------------------
// Recipe API DTOs (camelCase).
// ---------------------------------------------------------------------------------------------

const Tag = nonEmptyText(50);
const Tags = z
  .array(Tag)
  .max(30)
  .refine((t) => !duplicates(t), 'duplicate tag');
const Title = nonEmptyText(200);
const Description = multilineText(2000);
const GeneralNotes = multilineText(10_000);
const ChangeReason = nonEmptyText(500);
/** Recipe source link. http(s) only; it is stored and shown, never fetched in Milestone A. */
const SourceUrl = z.url({ protocol: /^https?$/ }).max(2048);

export const RecipeVersionMeta = z
  .strictObject({
    id: RecipeVersionId,
    versionNo: z.int().min(1),
    schemaVersion: z.int().min(1),
    createdByMemberId: MemberId,
    changeReason: z.string().nullable(),
    createdAt: Instant,
  })
  .meta({ id: 'RecipeVersionMeta' });
export type RecipeVersionMeta = z.infer<typeof RecipeVersionMeta>;

export const Recipe = z
  .strictObject({
    id: RecipeId,
    title: z.string(),
    description: z.string().nullable(),
    tags: z.array(z.string()),
    generalNotes: z.string().nullable(),
    sourceType: z.enum(RECIPE_SOURCE_TYPES).nullable(),
    sourceUrl: z.string().nullable(),
    archivedAt: Instant.nullable(),
    revision: Revision, // ETag; bumps on metadata edits and on new versions
    createdAt: Instant,
    updatedAt: Instant,
    currentVersion: RecipeVersionMeta,
    content: RecipeContentV1,
  })
  .meta({ id: 'Recipe' });
export type Recipe = z.infer<typeof Recipe>;

export const RecipeSummary = z
  .strictObject({
    id: RecipeId,
    title: z.string(),
    tags: z.array(z.string()),
    archivedAt: Instant.nullable(),
    revision: Revision,
    updatedAt: Instant,
  })
  .meta({ id: 'RecipeSummary' });
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const RecipeList = z
  .strictObject({ items: z.array(RecipeSummary) })
  .meta({ id: 'RecipeList' });
export type RecipeList = z.infer<typeof RecipeList>;

const QueryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

export const RecipeSearchQuery = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
  tag: z.union([Tag, z.array(Tag).max(10)]).optional(), // repeatable: ?tag=a&tag=b
  includeArchived: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type RecipeSearchQuery = z.infer<typeof RecipeSearchQuery>;

export const RecipeParams = z.strictObject({ id: RecipeId });
export const RecipeVersionParams = z.strictObject({ id: RecipeId, versionId: RecipeVersionId });

/** POST /recipes. Requires `Idempotency-Key`. Creates the recipe and version 1 atomically. */
export const CreateRecipeRequest = z
  .strictObject({
    title: Title,
    description: Description.optional(),
    tags: Tags.optional(),
    generalNotes: GeneralNotes.optional(),
    sourceUrl: SourceUrl.optional(),
    content: RecipeContentV1,
  })
  .meta({ id: 'CreateRecipeRequest' });
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequest>;

/**
 * PATCH /recipes/:id. Requires `If-Match`. `content` creates a new immutable version (FR-03);
 * the other fields are mutable metadata and create no version. `changeReason` only goes with `content`.
 */
export const PatchRecipeRequest = z
  .strictObject({
    title: Title.optional(),
    description: Description.nullable().optional(),
    tags: Tags.optional(),
    generalNotes: GeneralNotes.nullable().optional(),
    sourceUrl: SourceUrl.nullable().optional(),
    archived: z.boolean().optional(),
    content: RecipeContentV1.optional(),
    changeReason: ChangeReason.optional(),
  })
  .refine((p) => Object.keys(p).some((k) => k !== 'changeReason'), { message: 'no changes given' })
  .refine((p) => p.changeReason === undefined || p.content !== undefined, {
    message: 'changeReason requires content',
    path: ['changeReason'],
  })
  .meta({ id: 'PatchRecipeRequest' });
export type PatchRecipeRequest = z.infer<typeof PatchRecipeRequest>;

/** POST /recipes/:id/restore. Requires `If-Match` and `Idempotency-Key`. Copies an old version into a new one. */
export const RestoreRecipeRequest = z
  .strictObject({ versionId: RecipeVersionId, changeReason: ChangeReason.optional() })
  .meta({ id: 'RestoreRecipeRequest' });
export type RestoreRecipeRequest = z.infer<typeof RestoreRecipeRequest>;

export const RecipeVersionList = z
  .strictObject({ items: z.array(RecipeVersionMeta) })
  .meta({ id: 'RecipeVersionList' });
export type RecipeVersionList = z.infer<typeof RecipeVersionList>;

export const RecipeVersion = z
  .strictObject({ version: RecipeVersionMeta, content: RecipeContentV1 })
  .meta({ id: 'RecipeVersion' });
export type RecipeVersion = z.infer<typeof RecipeVersion>;
