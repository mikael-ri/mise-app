import { RECIPE_SOURCE_TYPES } from '@mise/contracts';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, isIn, tsvector, updatedAt } from './columns';
import { householdMembers, households } from './identity';

// DB §5.1. Mutable metadata lives here; cooking content lives in immutable recipe_versions.
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    // NULL only inside the create transaction, before version 1 exists (DB §5.1).
    currentVersionId: uuid('current_version_id'),
    title: text('title').notNull(),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generalNotes: text('general_notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    sourceType: text('source_type', { enum: RECIPE_SOURCE_TYPES }),
    sourceUrl: text('source_url'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    // Search projection (ADR-010 addendum, A02). The service rewrites the three flattened columns in
    // the same transaction as any title/tag/note change or version insert.
    searchTitle: text('search_title').notNull().default(''),
    searchIngredients: text('search_ingredients').notNull().default(''), // names, prep notes, tags
    searchBody: text('search_body').notNull().default(''), // directions + notes
    searchDocument: tsvector('search_document')
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('finnish'::regconfig, search_title), 'A') || setweight(to_tsvector('simple'::regconfig, search_title), 'A') || setweight(to_tsvector('finnish'::regconfig, search_ingredients), 'B') || setweight(to_tsvector('simple'::regconfig, search_ingredients), 'B') || setweight(to_tsvector('finnish'::regconfig, search_body), 'C') || setweight(to_tsvector('simple'::regconfig, search_body), 'C')`,
      ),
    // Folded (ä/ö/å -> a/o/a, lower case) text for the substring/trigram fallback only.
    // fold() is created in migration 0000.
    searchFold: text('search_fold')
      .notNull()
      .generatedAlwaysAs(
        sql`fold(search_title || ' ' || search_ingredients || ' ' || search_body)`,
      ),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Pointer must reference a version of the SAME recipe. MATCH SIMPLE: null pointer is allowed.
    foreignKey({
      name: 'recipes_current_version_same_recipe_fk',
      columns: [t.id, t.currentVersionId],
      foreignColumns: [recipeVersions.recipeId, recipeVersions.id] as [AnyPgColumn, AnyPgColumn],
    }).onDelete('restrict'),
    foreignKey({
      name: 'recipes_creator_same_household_fk',
      columns: [t.householdId, t.createdByMemberId],
      foreignColumns: [householdMembers.householdId, householdMembers.id],
    }).onDelete('restrict'),
    // Target for later household-scoped composite FKs to recipes (plans, cooking events).
    unique('recipes_household_id_uq').on(t.householdId, t.id),
    index('recipes_search_document_gin').using('gin', t.searchDocument),
    index('recipes_search_fold_trgm').using('gin', t.searchFold.op('gin_trgm_ops')),
    check('recipes_title_nonempty_ck', sql`btrim(${t.title}) <> ''`),
    check('recipes_revision_ck', sql`${t.revision} >= 1`),
    check(
      'recipes_source_type_ck',
      sql`${t.sourceType} IS NULL OR ${isIn(t.sourceType, RECIPE_SOURCE_TYPES)}`,
    ),
  ],
);

// Immutable after insert (trigger in migration 0001). Restore = new version copied from an old one.
export const recipeVersions = pgTable(
  'recipe_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id, { onDelete: 'restrict' }),
    versionNo: integer('version_no').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    content: jsonb('content').notNull(),
    createdByMemberId: uuid('created_by_member_id')
      .notNull()
      .references(() => householdMembers.id, { onDelete: 'restrict' }),
    changeReason: text('change_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('recipe_versions_recipe_version_no_uq').on(t.recipeId, t.versionNo),
    // Target for the composite FK from recipes.
    unique('recipe_versions_recipe_id_id_uq').on(t.recipeId, t.id),
    check('recipe_versions_version_no_ck', sql`${t.versionNo} >= 1`),
    check('recipe_versions_schema_version_ck', sql`${t.schemaVersion} >= 1`),
    // The content document declares the same schema_version as the column. NULL-safe: a missing key
    // must fail (a plain `=` yields NULL, which a CHECK accepts).
    check(
      'recipe_versions_content_schema_version_ck',
      sql`jsonb_typeof(${t.content}) = 'object' AND (${t.content} -> 'schema_version') IS NOT DISTINCT FROM to_jsonb(${t.schemaVersion})`,
    ),
  ],
);
