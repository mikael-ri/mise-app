import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  customType,
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

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id').notNull(),
    currentVersionId: uuid('current_version_id'),
    title: text('title').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Flattened text (title, ingredients, steps, notes) is written by the service
    // in the same transaction as the version insert.
    searchText: text('search_text').notNull().default(''),
    searchDocument: tsvector('search_document').generatedAlwaysAs(
      sql`to_tsvector('finnish'::regconfig, search_text)`,
    ),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    // Pointer must reference a version of the SAME recipe. MATCH SIMPLE: null pointer is allowed.
    foreignKey({
      name: 'recipes_current_version_same_recipe_fk',
      columns: [t.id, t.currentVersionId],
      foreignColumns: [recipeVersions.recipeId, recipeVersions.id] as [AnyPgColumn, AnyPgColumn],
    }),
    index('recipes_search_document_gin').using('gin', t.searchDocument),
    index('recipes_search_text_trgm').using('gin', t.searchText.op('gin_trgm_ops')),
  ],
);

export const recipeVersions = pgTable(
  'recipe_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references((): AnyPgColumn => recipes.id),
    versionNo: integer('version_no').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    content: jsonb('content').notNull(),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    changeReason: text('change_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('recipe_versions_recipe_version_no_uq').on(t.recipeId, t.versionNo),
    // Target for the composite FK from recipes.
    unique('recipe_versions_recipe_id_id_uq').on(t.recipeId, t.id),
  ],
);
