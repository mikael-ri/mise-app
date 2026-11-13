import type { Tx } from './db.js';

// All SQL for idempotency_keys. Every statement is scoped by household and actor member.
export interface KeyScope {
  householdId: string;
  actorMemberId: string;
  operation: string;
  requestKey: string;
}

export interface StoredKey {
  requestHash: Buffer;
  resultRef: unknown;
}

export async function deleteExpiredForScope(tx: Tx, s: KeyScope): Promise<void> {
  await tx.query(
    `DELETE FROM idempotency_keys
      WHERE household_id = $1 AND actor_member_id = $2 AND operation = $3 AND request_key = $4
        AND expires_at <= now()`,
    [s.householdId, s.actorMemberId, s.operation, s.requestKey],
  );
}

export async function findLive(tx: Pick<Tx, 'query'>, s: KeyScope): Promise<StoredKey | null> {
  const { rows } = await tx.query<{ request_hash: Buffer; result_ref: unknown }>(
    `SELECT request_hash, result_ref FROM idempotency_keys
      WHERE household_id = $1 AND actor_member_id = $2 AND operation = $3 AND request_key = $4
        AND expires_at > now()`,
    [s.householdId, s.actorMemberId, s.operation, s.requestKey],
  );
  const row = rows[0];
  return row ? { requestHash: row.request_hash, resultRef: row.result_ref } : null;
}

/** First write of the effect transaction. A duplicate blocks on the unique index, then raises 23505. */
export async function insertKey(
  tx: Tx,
  s: KeyScope,
  requestHash: Buffer,
  ttlHours: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO idempotency_keys
       (household_id, actor_member_id, operation, request_key, request_hash, result_ref, expires_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now() + make_interval(hours => $6))`,
    [s.householdId, s.actorMemberId, s.operation, s.requestKey, requestHash, ttlHours],
  );
}

export async function storeResultRef(tx: Tx, s: KeyScope, resultRef: unknown): Promise<void> {
  await tx.query(
    `UPDATE idempotency_keys SET result_ref = $5::jsonb
      WHERE household_id = $1 AND actor_member_id = $2 AND operation = $3 AND request_key = $4`,
    [s.householdId, s.actorMemberId, s.operation, s.requestKey, JSON.stringify(resultRef)],
  );
}

/** Platform maintenance job, deliberately not household-scoped: removes every expired key. */
export async function deleteAllExpired(tx: Pick<Tx, 'query'>): Promise<number> {
  const res = await tx.query('DELETE FROM idempotency_keys WHERE expires_at <= now()');
  return res.rowCount ?? 0;
}
