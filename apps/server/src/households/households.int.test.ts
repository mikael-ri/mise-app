// Integration tests against real PostgreSQL (DATABASE_URL, migrations applied).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, scopedQuery } from '../platform/index.js';
import type { Pool } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { createHouseholdsService } from './index.js';
import type { ActorMembership } from './index.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required for integration tests');
const pool: Pool = createPool(url, 4);
const svc = createHouseholdsService(pool);

// Sample household-scoped entity for the isolation proof: `recipes` (A04 schema), accessed through
// scopedQuery exactly as a real repository would.
const sample = {
  insert: async (householdId: string, memberId: string, title: string): Promise<string> =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO recipes (household_id, created_by_member_id, title)
         VALUES ($1, $2, $3) RETURNING id`,
        [householdId, memberId, title],
      )
    ).rows[0]!.id,
  get: async (householdId: string, id: string) =>
    (
      await scopedQuery<{ title: string }>(
        pool,
        householdId,
        'SELECT title FROM recipes WHERE household_id = $1 AND id = $2',
        [id],
      )
    ).rows,
  list: async (householdId: string) =>
    (await scopedQuery(pool, householdId, 'SELECT id FROM recipes WHERE household_id = $1')).rows,
  rename: async (householdId: string, id: string, title: string) =>
    (
      await scopedQuery(
        pool,
        householdId,
        'UPDATE recipes SET title = $3 WHERE household_id = $1 AND id = $2',
        [id, title],
      )
    ).rowCount,
  remove: async (householdId: string, id: string) =>
    (
      await scopedQuery(
        pool,
        householdId,
        'DELETE FROM recipes WHERE household_id = $1 AND id = $2',
        [id],
      )
    ).rowCount,
};

let h: TwoHouseholds;
let recipeA: string;
const provisioned: string[] = [];

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  recipeA = await sample.insert(h.a.householdId, h.a.memberId, 'A secret recipe');
});

afterAll(async () => {
  await pool.query('DELETE FROM household_members WHERE household_id = ANY($1)', [provisioned]);
  await pool.query('DELETE FROM households WHERE id = ANY($1)', [provisioned]);
  await pool.query(`DELETE FROM users WHERE oidc_issuer = 'https://prov.test'`);
  await h.cleanup(['recipes']);
  await pool.end();
});

describe('cross-household isolation (FR-30, FR-31)', () => {
  it('household B cannot read household A entity', async () => {
    expect(await sample.get(h.b.householdId, recipeA)).toHaveLength(0);
    expect(await sample.list(h.b.householdId)).toHaveLength(0);
    expect(await sample.get(h.a.householdId, recipeA)).toHaveLength(1);
  });

  it('household B cannot update or delete household A entity', async () => {
    expect(await sample.rename(h.b.householdId, recipeA, 'hijacked')).toBe(0);
    expect(await sample.remove(h.b.householdId, recipeA)).toBe(0);
    expect((await sample.get(h.a.householdId, recipeA))[0]!.title).toBe('A secret recipe');
  });

  it('household B cannot write a row attributed to household A member (composite FK)', async () => {
    await expect(sample.insert(h.b.householdId, h.a.memberId, 'forged')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('actor B sees only B household and members', async () => {
    const actorB = await svc.resolveActor(h.b.userId);
    expect(actorB.householdId).toBe(h.b.householdId);
    expect((await svc.getHousehold(actorB)).id).toBe(h.b.householdId);
    const members = await svc.listMembers(actorB);
    expect(members.map((m) => m.id)).toEqual([h.b.memberId]);
  });

  it('a deactivated user resolves to no actor', async () => {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [h.b.userId]);
    await expect(svc.resolveActor(h.b.userId)).rejects.toMatchObject({ code: 'forbidden' });
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [h.b.userId]);
  });
});

describe('provisionHousehold (FR-30)', () => {
  const input = () => ({
    name: 'Prov',
    members: [
      { oidcIssuer: 'https://prov.test', oidcSubject: randomUUID(), displayName: 'One' },
      { oidcIssuer: 'https://prov.test', oidcSubject: randomUUID(), displayName: 'Two' },
    ] as [
      { oidcIssuer: string; oidcSubject: string; displayName: string },
      { oidcIssuer: string; oidcSubject: string; displayName: string },
    ],
  });

  it('creates a household with an owner and a member', async () => {
    const created = await svc.provisionHousehold(input());
    provisioned.push(created.id);
    expect(created.timezone).toBe('Europe/Helsinki');
    const members = await svc.listMembers({
      userId: h.a.userId,
      householdId: created.id,
      memberId: h.a.memberId,
    } as ActorMembership);
    expect(members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
  });

  it('is atomic: a duplicate identity conflicts and leaves no household behind', async () => {
    const first = input();
    const created = await svc.provisionHousehold(first);
    provisioned.push(created.id);
    const dup = input();
    dup.members[1] = first.members[0];
    await expect(svc.provisionHousehold({ ...dup, name: 'Prov-atomic' })).rejects.toMatchObject({
      code: 'conflict',
    });
    const left = await pool.query(`SELECT 1 FROM households WHERE name = 'Prov-atomic'`);
    expect(left.rowCount).toBe(0);
  });
});
