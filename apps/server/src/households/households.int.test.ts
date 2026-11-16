// Integration tests against real PostgreSQL as the app role (shared test config, freshly migrated).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ErrorBody, HouseholdMemberList } from '@mise/contracts';
import { buildApp } from '../app.js';
import { createPool, scopedQuery } from '../platform/index.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import type { Pool, RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { createHouseholdsService } from './index.js';
import type { ActorMembership } from './index.js';

const pool: Pool = createPool(loadTestDatabaseConfig().appUrl, 4);
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

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  recipeA = await sample.insert(h.a.householdId, h.a.memberId, 'A secret recipe');
});

afterAll(async () => {
  await pool.end();
});

describe('cross-household isolation (FR-30, FR-31)', () => {
  it('household B cannot read household A entity', async () => {
    expect(await sample.get(h.b.householdId, recipeA)).toHaveLength(0);
    expect(await sample.list(h.b.householdId)).toHaveLength(0);
    expect(await sample.get(h.a.householdId, recipeA)).toHaveLength(1);
  });

  it('household B cannot update household A entity', async () => {
    expect(await sample.rename(h.b.householdId, recipeA, 'hijacked')).toBe(0);
    expect((await sample.get(h.a.householdId, recipeA))[0]!.title).toBe('A secret recipe');
  });

  it('nobody can delete recipes through the app role at all (ADR-018: recipes are archived)', async () => {
    for (const household of [h.a.householdId, h.b.householdId]) {
      await expect(sample.remove(household, recipeA)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await sample.get(h.a.householdId, recipeA)).toHaveLength(1);
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
    await svc.provisionHousehold(first);
    const dup = input();
    dup.members[1] = first.members[0];
    await expect(svc.provisionHousehold({ ...dup, name: 'Prov-atomic' })).rejects.toMatchObject({
      code: 'conflict',
    });
    const left = await pool.query(`SELECT 1 FROM households WHERE name = 'Prov-atomic'`);
    expect(left.rowCount).toBe(0);
  });
});

describe('GET /api/v1/household/members (FR-34, FR-37)', () => {
  let app: FastifyInstance;
  let a2MemberId: string;

  beforeAll(async () => {
    const userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (oidc_issuer, oidc_subject, display_name)
         VALUES ('https://auth.test', $1, 'Second A') RETURNING id`,
        [randomUUID()],
      )
    ).rows[0]!.id;
    a2MemberId = (
      await pool.query<{ id: string }>(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, 'member') RETURNING id`,
        [h.a.householdId, userId],
      )
    ).rows[0]!.id;
    app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null, households: svc });
    // Test-only stand-in for the session hook (the real one is covered in auth/*.int.test.ts).
    app.addHook('onRequest', async (request) => {
      const who = request.headers['x-test-actor'];
      if (who === 'none') {
        request.actor = null;
        return;
      }
      const f = who === 'b' ? h.b : h.a;
      request.actor = { ...f, deviceSessionId: randomUUID() } as unknown as RequestContext;
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (who: 'a' | 'b' | 'none') =>
    app.inject({
      method: 'GET',
      url: '/api/v1/household/members',
      headers: { 'x-test-actor': who },
    });

  it('household A sees exactly its own members, with id and displayName only', async () => {
    const res = await get('a');
    expect(res.statusCode).toBe(200);
    const body = HouseholdMemberList.parse(res.json());
    expect(body.items.map((m) => m.id).sort()).toEqual([h.a.memberId, a2MemberId].sort());
    expect(body.items.map((m) => m.id)).not.toContain(h.b.memberId);
    for (const item of res.json<{ items: object[] }>().items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'id']);
    }
  });

  it('household B never sees A members', async () => {
    const body = HouseholdMemberList.parse((await get('b')).json());
    expect(body.items.map((m) => m.id)).toEqual([h.b.memberId]);
  });

  it('unauthenticated gets 401', async () => {
    const res = await get('none');
    expect(res.statusCode).toBe(401);
    expect(ErrorBody.parse(res.json()).code).toBe('unauthenticated');
  });
});
