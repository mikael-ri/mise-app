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

export interface RecipeSummaryRow extends RecipeRow {
  /** prep + cook minutes of the current version, null when both are unknown. */
  totalMinutes: number | null;
  yield: { quantity: string; unit: string } | null;
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

/** Prep + cook minutes of the current version (`v`); one unknown counts as 0. Shared by maxTime and display. */
const TOTAL_MINUTES_SQL = `coalesce((v.content ->> 'prep_minutes')::int, 0)
         + coalesce((v.content ->> 'cook_minutes')::int, 0)`;
const SUMMARY_COLUMNS = `${RECIPE_COLUMNS},
  CASE WHEN v.content ->> 'prep_minutes' IS NULL AND v.content ->> 'cook_minutes' IS NULL
       THEN NULL ELSE ${TOTAL_MINUTES_SQL} END AS total_minutes,
  v.content #>> '{yield,quantity}' AS yield_quantity, v.content #>> '{yield,unit}' AS yield_unit`;
const SUMMARY_JOIN = 'JOIN recipe_versions v ON v.recipe_id = r.id AND v.id = r.current_version_id';

interface RawSummary extends RawRecipe {
  total_minutes: number | null;
  yield_quantity: string | null;
  yield_unit: string | null;
}

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

export interface RecipeSearchParams {
  /** Query words; every word must match. Empty lists by title. */
  words: readonly string[];
  tags: readonly string[];
  maxTime: number | undefined;
  includeArchived: boolean;
  limit: number;
  offset: number;
}

/**
 * Search per the ADR-010 addendum (A02): strict tier (weighted finnish/simple full text OR folded
 * substring, every word must hit) followed by a fuzzy typo tier (word_similarity >= 0.6) for recipes
 * the strict tier did not return. The base CTE carries all filters, so both tiers are household-scoped.
 * `maxTime` is prep + cook minutes of the current version; unknown times count as 0, so recipes
 * without time data are included (they can be flagged as untimed later).
 */
export async function searchRecipes(
  q: Queryable,
  householdId: string,
  p: RecipeSearchParams,
): Promise<RecipeSummaryRow[]> {
  const params: unknown[] = [];
  const bind = (v: unknown): string => `$${params.push(v) + 1}`; // $1 is the household
  const filters: string[] = [];
  if (!p.includeArchived) filters.push('r.archived_at IS NULL');
  if (p.tags.length > 0) filters.push(`r.tags @> ${bind(p.tags)}::text[]`);
  if (p.maxTime !== undefined) {
    filters.push(`${TOTAL_MINUTES_SQL} <= ${bind(p.maxTime)}`);
  }
  const where = ['r.household_id = $1', ...filters].join(' AND ');
  const base = `base AS NOT MATERIALIZED (
    SELECT r.id, r.search_title, r.search_ingredients, r.search_body, r.search_document, r.search_fold
      FROM recipes r
      JOIN recipe_versions v ON v.recipe_id = r.id AND v.id = r.current_version_id
     WHERE ${where})`;

  let sql: string;
  if (p.words.length === 0) {
    sql = `WITH ${base}
      SELECT ${SUMMARY_COLUMNS} FROM base JOIN recipes r ON r.id = base.id ${SUMMARY_JOIN}
       ORDER BY lower(r.title), r.id LIMIT ${bind(p.limit)} OFFSET ${bind(p.offset)}`;
  } else {
    sql = `WITH ${base},
      q AS (
        SELECT w,
               ARRAY(SELECT DISTINCT '%' || replace(replace(replace(fold(x), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
                       FROM unnest(ARRAY[w, (tsvector_to_array(to_tsvector('finnish', w)))[1]]) AS x
                      WHERE x IS NOT NULL AND (x = w OR length(x) >= 5)) AS pats,
               plainto_tsquery('finnish', w) AS fi,
               plainto_tsquery('simple', w) AS si,
               fold(w) AS f
          FROM unnest(${bind(p.words)}::text[]) AS w),
      scored AS (
        SELECT b.id, q.w,
               greatest(ts_rank_cd('{0.02,0.1,0.3,1.0}', b.search_document, q.fi, 32),
                        ts_rank_cd('{0.02,0.1,0.3,1.0}', b.search_document, q.si, 32))
               + CASE WHEN fold(b.search_title)       LIKE ANY (q.pats) THEN 0.6  ELSE 0 END
               + CASE WHEN fold(b.search_ingredients) LIKE ANY (q.pats) THEN 0.2  ELSE 0 END
               + CASE WHEN fold(b.search_body)        LIKE ANY (q.pats) THEN 0.05 ELSE 0 END AS score
          FROM base b CROSS JOIN q
         WHERE b.search_document @@ q.fi OR b.search_document @@ q.si OR b.search_fold LIKE ANY (q.pats)),
      strict AS (
        SELECT id, sum(score) AS score FROM scored
         GROUP BY id HAVING count(*) = (SELECT count(*) FROM q)),
      fuzzy AS (
        SELECT b.id, sum(word_similarity(q.f, b.search_fold)) AS score
          FROM base b CROSS JOIN q
         WHERE q.f <% b.search_fold AND word_similarity(q.f, b.search_fold) >= 0.6
           AND NOT EXISTS (SELECT 1 FROM strict s WHERE s.id = b.id)
         GROUP BY b.id HAVING count(*) = (SELECT count(*) FROM q)),
      hits AS (
        SELECT id, 0 AS tier, score FROM strict
        UNION ALL SELECT id, 1, score FROM fuzzy)
      SELECT ${SUMMARY_COLUMNS} FROM hits JOIN recipes r ON r.id = hits.id ${SUMMARY_JOIN}
       ORDER BY hits.tier, hits.score DESC, lower(r.title), r.id
       LIMIT ${bind(p.limit)} OFFSET ${bind(p.offset)}`;
  }
  const { rows } = await scopedQuery<RawSummary>(q, householdId, sql, params);
  return rows.map((r) => ({
    ...toRecipe(r),
    totalMinutes: r.total_minutes,
    yield:
      r.yield_quantity !== null && r.yield_unit !== null
        ? { quantity: r.yield_quantity, unit: r.yield_unit }
        : null,
  }));
}

export interface ExportRecipeRow extends RecipeRow {
  currentVersionId: string;
}

/** Every recipe of the household (archived included) for export, with its pointer. */
export async function listRecipesForExport(
  q: Queryable,
  householdId: string,
): Promise<ExportRecipeRow[]> {
  const { rows } = await scopedQuery<RawRecipe & { current_version_id: string }>(
    q,
    householdId,
    `SELECT ${RECIPE_COLUMNS}, r.current_version_id
       FROM recipes r
      WHERE r.household_id = $1 AND r.current_version_id IS NOT NULL
      ORDER BY lower(r.title), r.id`,
  );
  return rows.map((r) => ({ ...toRecipe(r), currentVersionId: r.current_version_id }));
}

export interface ExportVersionRow extends VersionRow {
  recipeId: string;
}

/** Every version of every recipe of the household, oldest version first. */
export async function listVersionsForExport(
  q: Queryable,
  householdId: string,
): Promise<ExportVersionRow[]> {
  const { rows } = await scopedQuery<RawVersion & { recipe_id: string }>(
    q,
    householdId,
    `SELECT ${VERSION_COLUMNS}, v.recipe_id
       FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id
      WHERE r.household_id = $1
      ORDER BY v.recipe_id, v.version_no`,
  );
  return rows.map((r) => ({ ...toVersion(r), recipeId: r.recipe_id }));
}

/** Loader duplicate check: same title and same source link (both null counts as equal). */
export async function findRecipeForLoad(
  q: Queryable,
  householdId: string,
  title: string,
  sourceUrl: string | null,
): Promise<{ id: string; revision: number; versionCount: number; archived: boolean } | null> {
  const { rows } = await scopedQuery<{
    id: string;
    revision: number;
    version_count: number;
    archived_at: Date | null;
  }>(
    q,
    householdId,
    `SELECT r.id, r.revision, r.archived_at,
            (SELECT count(*)::int FROM recipe_versions v WHERE v.recipe_id = r.id) AS version_count
       FROM recipes r
      WHERE r.household_id = $1 AND r.title = $2 AND r.source_url IS NOT DISTINCT FROM $3
      ORDER BY r.created_at, r.id LIMIT 1`,
    [title, sourceUrl],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        revision: r.revision,
        versionCount: r.version_count,
        archived: r.archived_at !== null,
      }
    : null;
}
