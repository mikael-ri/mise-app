import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, customType, timestamp } from 'drizzle-orm/pg-core';

// Drizzle 0.45 has no bytea column; digests (token, request hash) are stored as raw bytes.
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** `col IN ('a','b')` for text + CHECK enums (ADR-002 addendum). Values come from @mise/contracts. */
export const isIn = (col: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${col} IN (${sql.join(
    values.map((v) => sql.raw(`'${v.replaceAll("'", "''")}'`)),
    sql`, `,
  )})`;
