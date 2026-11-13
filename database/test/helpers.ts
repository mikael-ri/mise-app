import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });

/** Runs `fn` in a transaction that is always rolled back, so tests leave no rows behind. */
export async function inRolledBackTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

/** Expects the statement to fail with the given constraint name or SQLSTATE; keeps the outer tx usable. */
export async function expectPgError(
  c: pg.PoolClient,
  text: string,
  values: unknown[],
  expected: { constraint?: string; code?: string },
): Promise<void> {
  await c.query('SAVEPOINT expect_error');
  let err: (Error & { constraint?: string; code?: string }) | undefined;
  try {
    await c.query(text, values);
  } catch (e) {
    err = e as Error & { constraint?: string; code?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT expect_error');
  if (!err)
    throw new Error(
      `expected failure (${JSON.stringify(expected)}) but statement succeeded: ${text}`,
    );
  if (expected.constraint && err.constraint !== expected.constraint) {
    throw new Error(
      `expected constraint ${expected.constraint}, got ${err.constraint ?? err.code}: ${err.message}`,
    );
  }
  if (expected.code && err.code !== expected.code) {
    throw new Error(`expected SQLSTATE ${expected.code}, got ${err.code}: ${err.message}`);
  }
}

export interface Household {
  householdId: string;
  memberId: string;
  userId: string;
}

export async function createHousehold(c: pg.ClientBase, name = 'Koti'): Promise<Household> {
  const { rows: h } = await c.query<{ id: string }>(
    'INSERT INTO households (name) VALUES ($1) RETURNING id',
    [name],
  );
  const { rows: u } = await c.query<{ id: string }>(
    `INSERT INTO users (oidc_issuer, oidc_subject, display_name) VALUES ('https://auth.test', $1, 'Test') RETURNING id`,
    [randomUUID()],
  );
  const { rows: m } = await c.query<{ id: string }>(
    `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id`,
    [h[0]!.id, u[0]!.id],
  );
  return { householdId: h[0]!.id, memberId: m[0]!.id, userId: u[0]!.id };
}

export const contentV1 = (title = 'x') => ({
  schema_version: 1,
  yield: { quantity: '4', unit: 'annosta' },
  prep_minutes: null,
  cook_minutes: null,
  ingredient_groups: [],
  ingredients: [],
  instructions: [{ id: randomUUID(), order: 1, text: title }],
});

/** Inserts a recipe plus version 1 and sets the pointer, as the create service will. */
export async function createRecipe(c: pg.ClientBase, h: Household, title = 'Lohikeitto') {
  const { rows: r } = await c.query<{ id: string }>(
    `INSERT INTO recipes (household_id, title, created_by_member_id, search_title) VALUES ($1, $2, $3, $2) RETURNING id`,
    [h.householdId, title, h.memberId],
  );
  const recipeId = r[0]!.id;
  const { rows: v } = await c.query<{ id: string }>(
    `INSERT INTO recipe_versions (recipe_id, version_no, schema_version, content, created_by_member_id)
     VALUES ($1, 1, 1, $2, $3) RETURNING id`,
    [recipeId, JSON.stringify(contentV1(title)), h.memberId],
  );
  const versionId = v[0]!.id;
  await c.query('UPDATE recipes SET current_version_id = $1 WHERE id = $2', [versionId, recipeId]);
  return { recipeId, versionId };
}

export async function createList(
  c: pg.ClientBase,
  h: Household,
  name = 'Ruokakauppa',
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO shopping_lists (household_id, name, created_by_member_id) VALUES ($1, $2, $3) RETURNING id',
    [h.householdId, name, h.memberId],
  );
  return rows[0]!.id;
}

export const digest = (): Buffer => randomBytes(32);
