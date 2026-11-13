// Integration tests against real PostgreSQL (DATABASE_URL, migrations applied). Data is committed
// (the code under test opens its own transactions) and removed in afterAll.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, withTransaction } from './db.js';
import { runIdempotent, sweepExpiredKeys } from './idempotency.js';
import type { IdempotencyScope, ResultRef } from './idempotency.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required for integration tests');
const pool = createPool(url, 8);

let userId: string;
let householdId: string;
let memberId: string;
let scope: IdempotencyScope;
const key = () => randomUUID();

beforeAll(async () => {
  householdId = (
    await pool.query('INSERT INTO households (name) VALUES ($1) RETURNING id', ['A06'])
  ).rows[0].id;
  userId = (
    await pool.query(
      `INSERT INTO users (oidc_issuer, oidc_subject, display_name) VALUES ('https://auth.test', $1, 'T') RETURNING id`,
      [randomUUID()],
    )
  ).rows[0].id;
  memberId = (
    await pool.query(
      `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id`,
      [householdId, userId],
    )
  ).rows[0].id;
  scope = { householdId, actorMemberId: memberId, operation: 'test.create' };
});

afterAll(async () => {
  await pool.query('DELETE FROM idempotency_keys WHERE household_id = $1', [householdId]);
  await pool.query('DELETE FROM household_members WHERE household_id = $1', [householdId]);
  await pool.query('DELETE FROM households WHERE id = $1', [householdId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
});

const ref = (id: string): ResultRef => ({ status: 201, resourceType: 'thing', resourceId: id });

async function count(requestKey: string): Promise<number> {
  const r = await pool.query(
    'SELECT count(*)::int AS n FROM idempotency_keys WHERE household_id = $1 AND request_key = $2',
    [householdId, requestKey],
  );
  return r.rows[0].n;
}

describe('withTransaction', () => {
  it('commits on success and rolls back on throw, releasing the client', async () => {
    const k = key();
    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query(
          `INSERT INTO idempotency_keys (household_id, actor_member_id, operation, request_key, request_hash, result_ref, expires_at)
           VALUES ($1,$2,'test.tx',$3, decode(repeat('00',32),'hex'), '{}', now() + interval '1 hour')`,
          [householdId, memberId, k],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await count(k)).toBe(0);
    expect(pool.waitingCount).toBe(0);
  });
});

describe('runIdempotent (NFR-04, ADR-013)', () => {
  it('runs the effect once and replays the stored ref for the same key and payload', async () => {
    const k = key();
    let runs = 0;
    const effect = async () => {
      runs += 1;
      return { resultRef: ref('r1'), value: 'made' };
    };
    const first = await runIdempotent(pool, scope, k, { a: 1, b: 2 }, effect);
    const second = await runIdempotent(pool, scope, k, { b: 2, a: 1 }, effect);
    expect(first).toEqual({ replayed: false, resultRef: ref('r1'), value: 'made' });
    expect(second).toEqual({ replayed: true, resultRef: ref('r1') });
    expect(runs).toBe(1);
  });

  it('rejects the same key with a different payload as 422 idempotency_key_reused', async () => {
    const k = key();
    await runIdempotent(pool, scope, k, { a: 1 }, async () => ({ resultRef: ref('r1'), value: 1 }));
    await expect(
      runIdempotent(pool, scope, k, { a: 2 }, async () => ({ resultRef: ref('r2'), value: 2 })),
    ).rejects.toMatchObject({ code: 'idempotency_key_reused' });
  });

  it('does not leave a key row when the effect fails, so a retry can succeed', async () => {
    const k = key();
    await expect(
      runIdempotent(pool, scope, k, {}, async () => {
        throw new Error('effect failed');
      }),
    ).rejects.toThrow('effect failed');
    expect(await count(k)).toBe(0);
    const retry = await runIdempotent(pool, scope, k, {}, async () => ({
      resultRef: ref('r3'),
      value: 3,
    }));
    expect(retry.replayed).toBe(false);
  });

  it('scopes keys by operation', async () => {
    const k = key();
    await runIdempotent(pool, scope, k, {}, async () => ({ resultRef: ref('a'), value: 1 }));
    const other = await runIdempotent(
      pool,
      { ...scope, operation: 'test.other' },
      k,
      {},
      async () => ({
        resultRef: ref('b'),
        value: 2,
      }),
    );
    expect(other.replayed).toBe(false);
  });

  it('serialises concurrent duplicates: one effect, the other replays', async () => {
    const k = key();
    let runs = 0;
    const effect = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 150));
      return { resultRef: ref('race'), value: runs };
    };
    const results = await Promise.all([
      runIdempotent(pool, scope, k, { x: 1 }, effect),
      runIdempotent(pool, scope, k, { x: 1 }, effect),
      runIdempotent(pool, scope, k, { x: 1 }, effect),
    ]);
    expect(runs).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(2);
    expect(await count(k)).toBe(1);
  });

  it('concurrent duplicates with different payloads: loser gets 422', async () => {
    const k = key();
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { resultRef: ref('p'), value: 0 };
    };
    const settled = await Promise.allSettled([
      runIdempotent(pool, scope, k, { v: 1 }, slow),
      runIdempotent(pool, scope, k, { v: 2 }, slow),
    ]);
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'idempotency_key_reused',
    });
  });

  it('treats an expired key as absent and the sweep removes expired rows', async () => {
    const k = key();
    await runIdempotent(pool, scope, k, { a: 1 }, async () => ({
      resultRef: ref('old'),
      value: 1,
    }));
    await pool.query(
      `UPDATE idempotency_keys SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        WHERE household_id = $1 AND request_key = $2`,
      [householdId, k],
    );
    const again = await runIdempotent(pool, scope, k, { a: 99 }, async () => ({
      resultRef: ref('new'),
      value: 2,
    }));
    expect(again).toMatchObject({ replayed: false, resultRef: ref('new') });

    const k2 = key();
    await runIdempotent(pool, scope, k2, {}, async () => ({ resultRef: ref('x'), value: 1 }));
    await pool.query(
      `UPDATE idempotency_keys SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        WHERE household_id = $1 AND request_key = $2`,
      [householdId, k2],
    );
    expect(await sweepExpiredKeys(pool)).toBeGreaterThanOrEqual(1);
    expect(await count(k2)).toBe(0);
  });
});
