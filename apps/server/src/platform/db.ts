import pg from 'pg';

export type Pool = pg.Pool;
export type Tx = pg.PoolClient;
/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(databaseUrl: string, max: number): Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max });
  // An idle-client error must not crash the process; the next query surfaces the failure.
  pool.on('error', () => {});
  return pool;
}

/**
 * Runs `fn` in one READ COMMITTED transaction: commit on success, rollback on any throw.
 * Callers must not make external calls (AI provider, HTTP) inside `fn` (hard rule 8).
 */
export async function withTransaction<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true; // connection is broken: drop it instead of returning it to the pool
    }
    throw err;
  } finally {
    client.release(discard);
  }
}

export async function checkDatabaseReady(pool: Pool): Promise<void> {
  await pool.query('select 1');
}

/** What the connected role may do beyond the ADR-018 app-role grants. */
export interface DatabaseRoleFacts {
  superuser: boolean;
  /** Relations (tables, sequences, views, indexes) in schema `public` owned by the role. */
  ownedRelations: number;
  /** Functions in `public` (including the trigger function) owned by the role or a role it is a member of. */
  ownedFunctions: number;
  /** CREATEROLE or BYPASSRLS. */
  elevated: boolean;
  ownsPublicSchema: boolean;
  ownsDatabase: boolean;
}

export async function readDatabaseRoleFacts(db: Queryable): Promise<DatabaseRoleFacts> {
  const { rows } = await db.query<{
    superuser: boolean;
    owned_relations: number;
    owned_functions: number;
    elevated: boolean;
    owns_public_schema: boolean;
    owns_database: boolean;
  }>(
    `SELECT r.rolsuper AS superuser,
            (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS owned_relations,
            (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND pg_has_role(current_user, p.proowner, 'MEMBER')) AS owned_functions,
            EXISTS (SELECT 1 FROM pg_namespace n
              WHERE n.nspname = 'public' AND pg_has_role(current_user, n.nspowner, 'MEMBER')) AS owns_public_schema,
            EXISTS (SELECT 1 FROM pg_database d
              WHERE d.datname = current_database() AND pg_has_role(current_user, d.datdba, 'MEMBER')) AS owns_database,
            (r.rolcreaterole OR r.rolbypassrls) AS elevated
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('current database role not found in pg_roles');
  return {
    superuser: row.superuser,
    ownedRelations: row.owned_relations,
    ownedFunctions: row.owned_functions,
    elevated: row.elevated,
    ownsPublicSchema: row.owns_public_schema,
    ownsDatabase: row.owns_database,
  };
}

/**
 * ADR-018 startup check: the server's role must not be a superuser or own anything (tables,
 * schema, database), otherwise it could disable the `recipe_versions` immutability trigger.
 * Returns the problems (empty when the role is a proper app role). Never includes the URL.
 */
export function databaseRoleProblems(facts: DatabaseRoleFacts): string[] {
  const problems: string[] = [];
  if (facts.superuser) problems.push('the role is a superuser');
  if (facts.ownedRelations > 0)
    problems.push(`the role owns ${facts.ownedRelations} relations in schema public`);
  if (facts.ownedFunctions > 0)
    problems.push(`the role owns ${facts.ownedFunctions} functions in schema public`);
  if (facts.elevated) problems.push('the role has CREATEROLE or BYPASSRLS');
  if (facts.ownsPublicSchema) problems.push('the role owns schema public');
  if (facts.ownsDatabase) problems.push('the role owns the database');
  return problems;
}
