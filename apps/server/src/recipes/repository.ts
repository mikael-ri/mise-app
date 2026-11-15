import type { Queryable } from '../platform/index.js';
import { scopedQuery } from '../platform/index.js';

// All SQL for recipes, recipe_versions and their audit events. Every statement is household-scoped;
// recipe_versions has no household column, so it is always reached through a join on `recipes`.

export interface RecipeRow {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  generalNotes: string | null;
  sourceType: 'manual' | 'url' | 'text' | 'photo' | null;
  sourceUrl: string | null;
  archivedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionRow {
  id: string;
  versionNo: number;
  schemaVersion: number;
  content: unknown;
  createdByMemberId: string;
  changeReason: string | null;
  createdAt: Date;
}

export interface RecipeWithVersionRow extends RecipeRow {
  version: VersionRow;
}

export interface SearchProjection {
  title: string;
  ingredients: string;
  body: string;
}

const RECIPE_COLUMNS = `r.id, r.title, r.description, r.tags, r.general_notes, r.source_type,
  r.source_url, r.archived_at, r.revision, r.created_at, r.updated_at`;
const VERSION_COLUMNS = `v.id AS v_id, v.version_no, v.schema_version, v.content,
  v.created_by_member_id AS v_member, v.change_reason, v.created_at AS v_created_at`;

interface RawRecipe {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  general_notes: string | null;
  source_type: RecipeRow['sourceType'];
  source_url: string | null;
  archived_at: Date | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
interface RawVersion {
  v_id: string;
  version_no: number;
  schema_version: number;
  content: unknown;
  v_member: string;
  change_reason: string | null;
  v_created_at: Date;
}

const toRecipe = (r: RawRecipe): RecipeRow => ({
  id: r.id,
  title: r.title,
  description: r.description,
  tags: r.tags,
  generalNotes: r.general_notes,
  sourceType: r.source_type,
  sourceUrl: r.source_url,
  archivedAt: r.archived_at,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toVersion = (r: RawVersion): VersionRow => ({
  id: r.v_id,
  versionNo: r.version_no,
  schemaVersion: r.schema_version,
  content: r.content,
  createdByMemberId: r.v_member,
  changeReason: r.change_reason,
  createdAt: r.v_created_at,
});

/**
 * Reads a recipe with its current version. `forUpdate` first takes the row lock that serializes edits,
 * then reads. The lock is a separate statement on purpose: with `FOR UPDATE` on the join, a concurrent
 * edit that commits while we wait changes `current_version_id`, PostgreSQL re-checks the join against
 * the new row version and the row silently disappears (a losing writer would see "not found" instead
 * of the stale-revision conflict).
 */
export async function getRecipeWithVersion(
  q: Queryable,
  householdId: string,
  id: string,
  forUpdate = false,
): Promise<RecipeWithVersionRow | null> {
  if (forUpdate) {
    const locked = await scopedQuery(
      q,
      householdId,
      'SELECT 1 FROM recipes WHERE household_id = $1 AND id = $2 FOR UPDATE',
      [id],
    );
    if (locked.rowCount === 0) return null;
  }
  const { rows } = await scopedQuery<RawRecipe & RawVersion>(
    q,
    householdId,
    `SELECT ${RECIPE_COLUMNS}, ${VERSION_COLUMNS}
       FROM recipes r
       JOIN recipe_versions v ON v.recipe_id = r.id AND v.id = r.current_version_id
      WHERE r.household_id = $1 AND r.id = $2`,
    [id],
  );
  const row = rows[0];
  return row ? { ...toRecipe(row), version: toVersion(row) } : null;
}

export async function listVersions(
  q: Queryable,
  householdId: string,
  recipeId: string,
): Promise<VersionRow[]> {
  const { rows } = await scopedQuery<RawVersion>(
    q,
    householdId,
    `SELECT ${VERSION_COLUMNS}
       FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id
      WHERE r.household_id = $1 AND r.id = $2
      ORDER BY v.version_no DESC`,
    [recipeId],
  );
  return rows.map(toVersion);
}

export async function getVersion(
  q: Queryable,
  householdId: string,
  recipeId: string,
  versionId: string,
): Promise<VersionRow | null> {
  const { rows } = await scopedQuery<RawVersion>(
    q,
    householdId,
    `SELECT ${VERSION_COLUMNS}
       FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id
      WHERE r.household_id = $1 AND r.id = $2 AND v.id = $3`,
    [recipeId, versionId],
  );
  return rows[0] ? toVersion(rows[0]) : null;
}

export interface NewRecipe {
  title: string;
  description: string | null;
  tags: string[];
  generalNotes: string | null;
  sourceType: 'manual' | 'url';
  sourceUrl: string | null;
}

/** Inserts the recipe with a null pointer; the caller inserts version 1 and sets the pointer next. */
export async function insertRecipe(
  q: Queryable,
  householdId: string,
  memberId: string,
  r: NewRecipe,
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO recipes (household_id, created_by_member_id, title, description, tags,
                          general_notes, source_type, source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      householdId,
      memberId,
      r.title,
      r.description,
      r.tags,
      r.generalNotes,
      r.sourceType,
      r.sourceUrl,
    ],
  );
  return rows[0]!.id;
}

/** Appends a version. Callers hold the recipe row lock, so `max + 1` cannot race. */
export async function insertVersion(
  q: Queryable,
  householdId: string,
  recipeId: string,
  memberId: string,
  schemaVersion: number,
  content: unknown,
  changeReason: string | null,
): Promise<string> {
  const { rows } = await scopedQuery<{ id: string }>(
    q,
    householdId,
    `INSERT INTO recipe_versions (recipe_id, version_no, schema_version, content,
                                  created_by_member_id, change_reason)
     SELECT r.id,
            COALESCE((SELECT max(version_no) FROM recipe_versions WHERE recipe_id = r.id), 0) + 1,
            $3, $4::jsonb, $5, $6
       FROM recipes r WHERE r.household_id = $1 AND r.id = $2
     RETURNING id`,
    [recipeId, schemaVersion, JSON.stringify(content), memberId, changeReason],
  );
  return rows[0]!.id;
}

export interface RecipeUpdate {
  title?: string;
  description?: string | null;
  tags?: string[];
  generalNotes?: string | null;
  sourceUrl?: string | null;
  sourceType?: 'manual' | 'url';
  archivedAt?: Date | null;
  currentVersionId?: string;
  search?: SearchProjection;
}

const COLUMN_OF: Record<Exclude<keyof RecipeUpdate, 'search'>, string> = {
  title: 'title',
  description: 'description',
  tags: 'tags',
  generalNotes: 'general_notes',
  sourceUrl: 'source_url',
  sourceType: 'source_type',
  archivedAt: 'archived_at',
  currentVersionId: 'current_version_id',
};

/**
 * Applies the given changes, bumps `revision` and `updated_at`. Column names come from the fixed
 * map above, never from input. The search projection is rewritten in the same statement.
 */
export async function updateRecipe(
  q: Queryable,
  householdId: string,
  id: string,
  u: RecipeUpdate,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length + 1}`);
  };
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    const value = u[key as keyof typeof COLUMN_OF];
    if (value !== undefined) add(column, value);
  }
  if (u.search) {
    add('search_title', u.search.title);
    add('search_ingredients', u.search.ingredients);
    add('search_body', u.search.body);
  }
  await scopedQuery(
    q,
    householdId,
    `UPDATE recipes SET ${sets.join(', ')}, revision = revision + 1, updated_at = now()
      WHERE household_id = $1 AND id = $2`,
    params,
  );
}

export async function setInitialPointer(
  q: Queryable,
  householdId: string,
  id: string,
  versionId: string,
  search: SearchProjection,
): Promise<void> {
  await scopedQuery(
    q,
    householdId,
    `UPDATE recipes SET current_version_id = $3, search_title = $4, search_ingredients = $5,
                        search_body = $6
      WHERE household_id = $1 AND id = $2`,
    [id, versionId, search.title, search.ingredients, search.body],
  );
}

export async function insertAuditEvent(
  q: Queryable,
  householdId: string,
  actorMemberId: string,
  action: string,
  recipeId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO audit_events (household_id, actor_member_id, action, entity_type, entity_id, summary)
     VALUES ($1, $2, $3, 'recipe', $4, $5::jsonb)`,
    [householdId, actorMemberId, action, recipeId, JSON.stringify(summary)],
  );
}
