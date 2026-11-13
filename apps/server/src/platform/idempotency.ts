import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IDEMPOTENCY_KEY_TTL_HOURS, IdempotencyKeyHeader } from '@mise/contracts';
import { withTransaction } from './db.js';
import type { Pool, Tx } from './db.js';
import { AppError } from './errors.js';
import * as repo from './idempotency-repository.js';

/** What is stored per key (ADR-013 addendum): a reference, never a response body. */
export const ResultRef = z.strictObject({
  status: z.int().min(200).max(299),
  resourceType: z.string().min(1).max(64),
  resourceId: z.string().min(1).max(128),
});
export type ResultRef = z.infer<typeof ResultRef>;

export interface IdempotencyScope {
  /** From the session, never from the client. */
  householdId: string;
  actorMemberId: string;
  /** e.g. `recipes.create`; must match `^[a-z][a-z0-9_.]{0,63}$`. */
  operation: string;
}

export type IdempotentOutcome<T> =
  { replayed: false; resultRef: ResultRef; value: T } | { replayed: true; resultRef: ResultRef };

/** Canonical JSON: sorted keys, no whitespace, `undefined` properties dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** SHA-256 of the canonical request: operation, path params and body. */
export function requestHash(operation: string, payload: unknown): Buffer {
  return createHash('sha256').update(canonicalJson({ operation, payload })).digest();
}

/** Validates the raw `Idempotency-Key` header value. */
export function parseIdempotencyKey(header: unknown): string {
  if (header === undefined) {
    throw new AppError('idempotency_key_required', 'Idempotency-Key header is required');
  }
  const parsed = IdempotencyKeyHeader.safeParse(header);
  if (!parsed.success) throw new AppError('validation_failed', 'Idempotency-Key is malformed');
  return parsed.data;
}

function reused(): AppError {
  return new AppError(
    'idempotency_key_reused',
    'Idempotency-Key was used with a different request',
  );
}

function replayOf(stored: repo.StoredKey, hash: Buffer): { replayed: true; resultRef: ResultRef } {
  if (!stored.requestHash.equals(hash)) throw reused();
  const ref = ResultRef.safeParse(stored.resultRef);
  if (!ref.success) throw new AppError('internal_error', 'stored idempotency result is invalid');
  return { replayed: true, resultRef: ref.data };
}

const UNIQUE_VIOLATION = '23505';
const KEY_CONSTRAINT = 'idempotency_keys_scope_uq';

/**
 * Runs `effect` at most once per (household, member, operation, key).
 * 1. Replay first: a live key with the same hash returns the stored ref; a different hash is 422.
 * 2. Otherwise, in one transaction: delete the expired row, insert the key row FIRST, run `effect`
 *    (which does the real writes through `tx`), store the result ref, commit.
 * 3. A concurrent duplicate blocks on the unique index; after the first commits it gets 23505, its
 *    transaction is rolled back and the stored outcome is replayed from a fresh read.
 * `effect` must not make external calls (hard rule 8). Callers re-read the resource on replay.
 */
export async function runIdempotent<T>(
  pool: Pool,
  scope: IdempotencyScope,
  key: string,
  payload: unknown,
  effect: (tx: Tx) => Promise<{ resultRef: ResultRef; value: T }>,
): Promise<IdempotentOutcome<T>> {
  const keyScope: repo.KeyScope = { ...scope, requestKey: parseIdempotencyKey(key) };
  const hash = requestHash(scope.operation, payload);

  const existing = await repo.findLive(pool, keyScope);
  if (existing) return replayOf(existing, hash);

  try {
    return await withTransaction(pool, async (tx) => {
      await repo.deleteExpiredForScope(tx, keyScope);
      await repo.insertKey(tx, keyScope, hash, IDEMPOTENCY_KEY_TTL_HOURS);
      const { resultRef, value } = await effect(tx);
      const checked = ResultRef.parse(resultRef);
      await repo.storeResultRef(tx, keyScope, checked);
      return { replayed: false as const, resultRef: checked, value };
    });
  } catch (err) {
    const pgErr = err as { code?: string; constraint?: string } | null;
    // Only the key's own unique index means "duplicate request"; the effect's violations propagate.
    if (pgErr?.code !== UNIQUE_VIOLATION || pgErr.constraint !== KEY_CONSTRAINT) throw err;
    const committed = await repo.findLive(pool, keyScope);
    if (!committed) throw new AppError('conflict', 'concurrent request, retry');
    return replayOf(committed, hash);
  }
}

/** Expiry sweep (ADR-013 addendum "still to verify"); schedule from the app process. */
export async function sweepExpiredKeys(pool: Pool): Promise<number> {
  return repo.deleteAllExpired(pool);
}
