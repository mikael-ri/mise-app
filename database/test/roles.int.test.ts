// ADR-018: the application role has least privilege; the owner role owns everything.
// Runs against the migrated test database: owner connection for inspection, app connection for the attempts.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { loadTestDatabaseConfig } from '../../tests/support/test-database-config';
import { APP_DELETE_TABLES } from '../roles/grants';
import { inRolledBackTx, pool as ownerPool } from './helpers';

const config = loadTestDatabaseConfig();
const appPool = new pg.Pool({ connectionString: config.appUrl });
afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

const INSUFFICIENT_PRIVILEGE = '42501';

interface PrivilegeRow {
  table: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  del: boolean;
  truncate: boolean;
  trigger: boolean;
  references: boolean;
}

const privileges = async (): Promise<PrivilegeRow[]> =>
  (
    await ownerPool.query<PrivilegeRow>(
      `SELECT c.relname AS "table",
              has_table_privilege($1, c.oid, 'SELECT')     AS "select",
              has_table_privilege($1, c.oid, 'INSERT')     AS "insert",
              has_table_privilege($1, c.oid, 'UPDATE')     AS "update",
              has_table_privilege($1, c.oid, 'DELETE')     AS "del",
              has_table_privilege($1, c.oid, 'TRUNCATE')   AS "truncate",
              has_table_privilege($1, c.oid, 'TRIGGER')    AS "trigger",
              has_table_privilege($1, c.oid, 'REFERENCES') AS "references"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`,
      [config.appRole],
    )
  ).rows;

describe('ADR-018: roles and ownership', () => {
  it('the app role is a plain login role: no superuser, no createdb, no createrole, no bypassrls', async () => {
    const { rows } = await ownerPool.query(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [config.appRole],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
    });
  });

  it('every table is owned by the owner role, none by the app role', async () => {
    const { rows } = await ownerPool.query<{ tableowner: string }>(
      `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(rows.map((r) => r.tableowner)).toEqual([config.ownerRole]);
  });

  it('app role: SELECT/INSERT/UPDATE everywhere; DELETE only on the listed tables; never TRUNCATE/TRIGGER/REFERENCES', async () => {
    const rows = await privileges();
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect([r.table, r.select, r.insert, r.update]).toEqual([r.table, true, true, true]);
      expect([r.table, r.truncate, r.trigger, r.references]).toEqual([
        r.table,
        false,
        false,
        false,
      ]);
    }
    expect(rows.filter((r) => r.del).map((r) => r.table)).toEqual([...APP_DELETE_TABLES].sort());
  });

  it('app role has no database-level CREATE/TEMP and no access to the drizzle schema', async () => {
    const { rows } = await ownerPool.query(
      `SELECT has_database_privilege($1, current_database(), 'CREATE') AS db_create,
              has_database_privilege($1, current_database(), 'TEMP')   AS db_temp,
              has_schema_privilege($1, 'public', 'CREATE')             AS schema_create,
              has_schema_privilege($1, 'public', 'USAGE')              AS schema_usage,
              has_schema_privilege($1, 'drizzle', 'USAGE')             AS drizzle_usage`,
      [config.appRole],
    );
    expect(rows[0]).toEqual({
      db_create: false,
      db_temp: false,
      schema_create: false,
      schema_usage: true,
      drizzle_usage: false,
    });
  });

  it('schema and functions are owned by the owner role, never the app role', async () => {
    const { rows } = await ownerPool.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'
       UNION
       SELECT DISTINCT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f' AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
    );
    expect(rows.map((r) => r.owner)).toEqual([config.ownerRole]);
  });

  it('every table listed for DELETE exists (a typo would silently grant nothing)', async () => {
    const names = (await privileges()).map((r) => r.table);
    for (const t of APP_DELETE_TABLES) expect(names).toContain(t);
  });

  it('a table created later by the owner is usable by the app role without a grant (default privileges)', async () => {
    await inRolledBackTx(async (c) => {
      await c.query('CREATE TABLE adr018_probe (id int)');
      const { rows } = await c.query(
        `SELECT has_table_privilege($1, 'adr018_probe', 'SELECT')  AS s,
                has_table_privilege($1, 'adr018_probe', 'INSERT')  AS i,
                has_table_privilege($1, 'adr018_probe', 'UPDATE')  AS u,
                has_table_privilege($1, 'adr018_probe', 'DELETE')  AS d,
                has_table_privilege($1, 'adr018_probe', 'TRUNCATE') AS t`,
        [config.appRole],
      );
      expect(rows[0]).toEqual({ s: true, i: true, u: true, d: false, t: false });
    });
  });

  it.each([
    ['CREATE TABLE', 'CREATE TABLE app_made_this (id int)'],
    ['CREATE TEMP TABLE', 'CREATE TEMP TABLE app_temp (id int)'],
    ['CREATE FUNCTION', 'CREATE FUNCTION app_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'],
    ['CREATE SCHEMA', 'CREATE SCHEMA app_schema'],
    [
      'UPDATE ... DISABLE TRIGGER on recipe_versions',
      'ALTER TABLE recipe_versions DISABLE TRIGGER USER',
    ],
    ['DROP TABLE', 'DROP TABLE recipes CASCADE'],
    ['ALTER TABLE', 'ALTER TABLE recipes ADD COLUMN x int'],
    ['DISABLE TRIGGER', 'ALTER TABLE recipe_versions DISABLE TRIGGER ALL'],
    ['DROP TRIGGER', 'DROP TRIGGER recipe_versions_no_update_delete ON recipe_versions'],
    ['TRUNCATE', 'TRUNCATE households CASCADE'],
    ['DELETE households', 'DELETE FROM households'],
    ['DELETE recipes', 'DELETE FROM recipes'],
  ])('app role cannot %s', async (_name, sql) => {
    await expect(appPool.query(sql)).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('app role can delete where the domain deletes (idempotency_keys)', async () => {
    await expect(
      appPool.query(`DELETE FROM idempotency_keys WHERE expires_at <= now()`),
    ).resolves.toBeDefined();
  });
});
