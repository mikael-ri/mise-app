import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../schema/index';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

// Default READ COMMITTED. Callers must not make external calls inside `fn` (hard rule 8).
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
