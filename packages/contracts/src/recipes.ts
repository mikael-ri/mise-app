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
    yield: RecipeYieldV1.nullable(), // null: servings not stated (ADR-015 addendum); no version bump
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
    /** Prep + cook minutes of the current version (one unknown counts as 0); null when both unknown. */
    totalMinutes: z.int().min(0).nullable(),
    /** Yield of the current version, passed through as stored. */
    yield: RecipeYieldV1.nullable(),
  })
  .meta({ id: 'RecipeSummary' });
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const RecipeList = z
  .strictObject({
    items: z.array(RecipeSummary),
    /** Offset for the next page; null when this was the last one. */
    nextOffset: z.int().min(0).nullable(),
  })
  .meta({ id: 'RecipeList' });
export type RecipeList = z.infer<typeof RecipeList>;

const QueryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

export const RecipeSearchQuery = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((q) => q.split(/\s+/).length <= 8, 'at most 8 words')
    .optional(),
  // Repeatable (?tags=a&tags=b); a recipe must carry every listed tag.
  tags: z
    .union([Tag, z.array(Tag).max(10)])
    .transform((t) => (typeof t === 'string' ? [t] : t))
    .optional(),
  /** Maximum prep + cook minutes. Recipes without any time data are included. */
  maxTime: z.coerce.number().int().min(0).max(20_000).optional(),
  includeArchived: QueryBoolean.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
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

// ---------------------------------------------------------------------------------------------
// Export (FR-32) and the file format of the ops loader. Both are snake_case like the stored content.
// ---------------------------------------------------------------------------------------------

export const RECIPE_EXPORT_FORMAT_VERSION = 1;

export const RecipeExportVersion = z.strictObject({
  id: RecipeVersionId,
  version_no: z.int().min(1),
  schema_version: z.int().min(1),
  change_reason: z.string().nullable(),
  created_at: Instant,
  content: RecipeContentV1,
});
export type RecipeExportVersion = z.infer<typeof RecipeExportVersion>;

export const RecipeExportRecipe = z.strictObject({
  id: RecipeId,
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  general_notes: z.string().nullable(),
  source_type: z.enum(RECIPE_SOURCE_TYPES).nullable(),
  source_url: z.string().nullable(),
  archived: z.boolean(),
  created_at: Instant,
  updated_at: Instant,
  current_version_id: RecipeVersionId,
  /** Every immutable version, oldest first. */
  versions: z.array(RecipeExportVersion).min(1),
});
export type RecipeExportRecipe = z.infer<typeof RecipeExportRecipe>;

/** GET /recipes/export?format=json. All recipes of the household, archived ones included. */
export const RecipeExport = z
  .strictObject({
    format_version: z.literal(RECIPE_EXPORT_FORMAT_VERSION),
    exported_at: Instant,
    recipes: z.array(RecipeExportRecipe),
  })
  .meta({ id: 'RecipeExport' });
export type RecipeExport = z.infer<typeof RecipeExport>;

export const RecipeExportQuery = z.strictObject({
  format: z.enum(['json', 'md']).default('json'),
});
export type RecipeExportQuery = z.infer<typeof RecipeExportQuery>;

const FileId = nonEmptyText(100); // human-written ids such as "g1" or "l3"

/**
 * One recipe file as read by the loader and stored in `tests/fixtures/recipes/*.json`. Ids are
 * file-local labels (the loader derives UUIDs); times live at the top level and move into the content.
 * `yield_text`, `time_text`, `total_minutes` and `passive_minutes` are descriptive only and not stored.
 */
export const RecipeLoadFile = z.strictObject({
  title: nonEmptyText(200),
  tags: z.array(nonEmptyText(50)).max(30),
  source_url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable(),
  yield_text: z.string().nullable().optional(),
  time_text: z.string().nullable().optional(),
  prep_minutes: z.int().min(0).max(10_000).nullable(),
  cook_minutes: z.int().min(0).max(10_000).nullable(),
  total_minutes: z.int().min(0).nullable().optional(),
  passive_minutes: z.int().min(0).nullable().optional(),
  general_notes: multilineText(10_000).nullable(),
  _flags: z.array(z.string()).optional(), // reviewer notes about the source, ignored by the loader
  content: z.strictObject({
    schema_version: z.literal(RECIPE_CONTENT_SCHEMA_VERSION),
    yield: RecipeYieldV1.nullable(), // null when the source states no servings
    ingredient_groups: z.array(
      z.strictObject({ id: FileId, name: nonEmptyText(200), order: z.int().min(1) }),
    ),
    ingredients: z.array(
      z.strictObject({
        id: FileId,
        group_id: FileId.nullable(),
        display_name: nonEmptyText(200),
        normalized_key: NormalizedKey.nullable().optional(),
        original_quantity_text: nullableText(100),
        amount_min: RationalString.nullable(),
        amount_max: RationalString.nullable(),
        original_unit: nullableText(40),
        canonical_unit_code: nullableText(40).optional(),
        preparation_note: nullableText(500).optional(),
        scale_policy: z.enum(SCALE_POLICIES),
        alternatives: z.array(nonEmptyText(200)).optional(), // plain text in files
        uncertainties: z.array(nonEmptyText(300)).optional(),
      }),
    ),
    instructions: z.array(
      z.strictObject({ id: FileId, order: z.int().min(1), text: multilineText(4000) }),
    ),
  }),
});
export type RecipeLoadFile = z.infer<typeof RecipeLoadFile>;
