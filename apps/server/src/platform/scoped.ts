import type { QueryResult, QueryResultRow } from 'pg';
import { AppError } from './errors.js';
import type { Queryable } from './db.js';

// Household scoping for repositories (hard rule 2, DB §3). The household always comes from the
// actor context, never from client input.

const SCOPE_PREDICATE = /\bhousehold_id\s*=\s*\$1\b/;

/**
 * Runs a household-scoped statement. `$1` is always the household ID; caller params start at `$2`.
 * The SQL must contain `household_id = $1`, so a repository cannot forget the scope: an unscoped
 * statement fails fast instead of leaking another household's rows. This is a guard against forgetting the scope,
 * not proof of correctness (it cannot tell `OR household_id = $1` from a real filter): the
 * cross-household tests per entity are the proof.
 */
export function scopedQuery<R extends QueryResultRow = QueryResultRow>(
  q: Queryable,
  householdId: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  if (!SCOPE_PREDICATE.test(sql)) {
    throw new Error('scopedQuery: SQL must contain "household_id = $1"');
  }
  return q.query<R>(sql, [householdId, ...params]);
}

/**
 * Composite-FK guard for guarded inserts/updates: confirms `memberId` belongs to `householdId`
 * before a row references it. The database enforces the same pair through composite foreign keys
 * on `(household_id, member_id)`; this gives a clean `not_found` instead of an FK error. Absence and
 * cross-household are indistinguishable on purpose.
 */
export async function assertMemberInHousehold(
  q: Queryable,
  householdId: string,
  memberId: string,
): Promise<void> {
  const { rowCount } = await scopedQuery(
    q,
    householdId,
    'SELECT 1 FROM household_members WHERE household_id = $1 AND id = $2',
    [memberId],
  );
  if (!rowCount) throw new AppError('not_found', 'member not found');
}
