import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { recipes, recipeVersions } from '../schema/index';
import { createRecipe } from '../src/create-recipe';
import { createDb, withTransaction } from '../src/transaction';

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
const db = createDb(pool);
const household = randomUUID();
const member = randomUUID();
afterAll(() => pool.end());

// Drizzle wraps driver errors in DrizzleQueryError; the PostgreSQL message is on `cause`.
const pgMessage = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as { cause?: Error }).cause?.message ?? String(e);
  }
  return 'NO ERROR';
};

const make = (title: string, searchText: string) =>
  createRecipe(db, {
    householdId: household,
    memberId: member,
    title,
    content: { steps: [] },
    searchText,
  });

describe('A01 recipes spike (ADR-002)', () => {
  it('creates recipe + version 1 + pointer atomically', async () => {
    const { recipeId, versionId } = await make('Uunilohi', 'uunilohi lohi peruna');
    const [r] = await db
      .select()
      .from(recipes)
      .where(sql`${recipes.id} = ${recipeId}`);
    expect(r?.currentVersionId).toBe(versionId);
  });

  it('rolls back everything when the transaction fails', async () => {
    const id = randomUUID();
    await expect(
      withTransaction(db, async (tx) => {
        await tx.insert(recipes).values({ id, householdId: household, title: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db
      .select()
      .from(recipes)
      .where(sql`${recipes.id} = ${id}`);
    expect(rows).toHaveLength(0);
  });

  it("rejects a pointer to another recipe's version (composite FK)", async () => {
    const a = await make('A', 'a');
    const b = await make('B', 'b');
    expect(
      await pgMessage(
        db.execute(
          sql`UPDATE recipes SET current_version_id = ${b.versionId} WHERE id = ${a.recipeId}`,
        ),
      ),
    ).toMatch(/recipes_current_version_same_recipe_fk/);
  });

  it('rejects duplicate (recipe_id, version_no)', async () => {
    const a = await make('Dup', 'dup');
    expect(
      await pgMessage(
        db.insert(recipeVersions).values({
          recipeId: a.recipeId,
          versionNo: 1,
          schemaVersion: 1,
          content: {},
          createdByMemberId: member,
        }),
      ),
    ).toMatch(/recipe_versions_recipe_version_no_uq/);
  });

  it('blocks UPDATE, DELETE and TRUNCATE on recipe_versions', async () => {
    const a = await make('Imm', 'imm');
    expect(
      await pgMessage(
        db.execute(sql`UPDATE recipe_versions SET content = '{}' WHERE id = ${a.versionId}`),
      ),
    ).toMatch(/immutable/);
    expect(
      await pgMessage(db.execute(sql`DELETE FROM recipe_versions WHERE id = ${a.versionId}`)),
    ).toMatch(/immutable/);
    expect(await pgMessage(db.execute(sql`TRUNCATE recipe_versions CASCADE`))).toMatch(/immutable/);
  });

  it('create-recipe leaves no recipe or version behind when the pointer update fails (DB §5.1)', async () => {
    const title = `atomic-${randomUUID()}`;
    // null search_text violates NOT NULL on the final UPDATE, after both inserts succeeded
    await expect(make(title, null as unknown as string)).rejects.toThrow();
    const rows = await db
      .select()
      .from(recipes)
      .where(sql`${recipes.title} = ${title}`);
    expect(rows).toHaveLength(0);
  });

  it('finds Finnish inflections via generated tsvector and typos via pg_trgm', async () => {
    await make('Lohikeitto', 'lohikeitto lohta perunoita');
    const fts = await db.execute(
      sql`SELECT id FROM recipes WHERE household_id = ${household}
          AND search_document @@ plainto_tsquery('finnish', 'lohi')`,
    );
    expect(fts.rows.length).toBeGreaterThan(0);
    const trgm = await db.execute(
      sql`SELECT id FROM recipes WHERE household_id = ${household}
          AND search_text % 'lohikeito'`,
    );
    expect(trgm.rows.length).toBeGreaterThan(0);
  });
});
