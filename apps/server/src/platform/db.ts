import pg from 'pg';

export type Pool = pg.Pool;
export type Tx = pg.PoolClient;

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
