// FR-34, FR-35, FR-36, FR-37, FR-39, AC-08 (server side), AC-10 against real PostgreSQL as the app role
// (shared test config, freshly migrated database per file).
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ErrorBody,
  HouseholdId,
  MemberId,
  ShoppingCategory,
  ShoppingCategoryId,
  ShoppingCategoryList,
  ShoppingItem,
  ShoppingList,
  ShoppingListSnapshot,
  ShoppingListSummaryList,
} from '@mise/contracts';
import { buildApp } from '../app.js';
import { CSRF_HEADER, createPool, issueCsrfToken } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import { createListEventHub, createShoppingService, registerShoppingRoutes } from './index.js';
import type { ShoppingActor } from './index.js';

const pool = createPool(loadTestDatabaseConfig().appUrl, 10);
const service = createShoppingService(pool, createListEventHub());

let h: TwoHouseholds;
/** Second member of household A, so two members can shop the same list (AC-08). */
let a2: { householdId: string; memberId: string };
let app: FastifyInstance;
const key = () => randomUUID();
const deviceSessionId = randomUUID();

const actor = (f: { householdId: string; memberId: string }): ShoppingActor => ({
  householdId: HouseholdId.parse(f.householdId),
  memberId: MemberId.parse(f.memberId),
});
const A = (): ShoppingActor => actor(h.a);
const A2 = (): ShoppingActor => actor(a2);
const B = (): ShoppingActor => actor(h.b);

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  const userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://auth.test', $1, 'User a2') RETURNING id`,
      [randomUUID()],
    )
  ).rows[0]!.id;
  const memberId = (
    await pool.query<{ id: string }>(
      `INSERT INTO household_members (household_id, user_id, role)
       VALUES ($1, $2, 'member') RETURNING id`,
      [h.a.householdId, userId],
    )
  ).rows[0]!.id;
  a2 = { householdId: h.a.householdId, memberId };

  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null });
  // Test-only stand-in for the session hook (the real one is covered in auth/*.int.test.ts).
  app.addHook('onRequest', async (request) => {
    const who = request.headers['x-test-actor'] === 'b' ? h.b : h.a;
    request.actor = {
      userId: who.userId,
      householdId: who.householdId,
      memberId: who.memberId,
      deviceSessionId,
    } as unknown as RequestContext;
  });
  registerShoppingRoutes(app, service, {
    sessions: { onRevoked: () => () => {}, isLive: async () => true },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  o: { who?: 'a' | 'b'; body?: unknown; ifMatch?: number | string; idem?: string } = {},
) {
  const headers: Record<string, string> = {
    'x-test-actor': o.who ?? 'a',
    origin: testConfig.publicOrigin,
    [CSRF_HEADER]: issueCsrfToken(testConfig.csrfSecret, deviceSessionId),
  };
  if (o.ifMatch !== undefined) {
    headers['if-match'] = typeof o.ifMatch === 'number' ? `"${o.ifMatch}"` : o.ifMatch;
  }
  if (o.idem !== undefined) headers['idempotency-key'] = o.idem;
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers,
    ...(o.body === undefined ? {} : { payload: o.body as object }),
  });
}

const errorCode = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;

const newList = async (who: ShoppingActor = A(), name = 'Viikko') =>
  (await service.createList(who, key(), { name })).value;

const addItem = async (
  listId: string,
  name: string,
  extra: { quantityText?: string; note?: string; categoryId?: string } = {},
  who: ShoppingActor = A(),
) =>
  (
    await service.addItem(who, listId, key(), { name, ...extra } as Parameters<
      typeof service.addItem
    >[3])
  ).value;

const seqOf = async (listId: string) =>
  Number(
    (
      await pool.query<{ s: string }>('SELECT change_seq AS s FROM shopping_lists WHERE id = $1', [
        listId,
      ])
    ).rows[0]!.s,
  );

async function systemCategory(code: string): Promise<ShoppingCategory> {
  const { items } = await service.listCategories(A());
  const c = items.find((i) => i.systemCode === code);
  if (!c) throw new Error(`missing system category ${code}`);
  return c;
}

// ---------------------------------------------------------------------------------------------

describe('FR-34: standalone lists (create, rename, archive)', () => {
  it('creates via API with 201 + ETag; replays the same key; 422 on reuse; 400 without key', async () => {
    const idem = key();
    const first = await api('POST', '/shopping-lists', { body: { name: 'Lidl' }, idem });
    expect(first.statusCode).toBe(201);
    const list = ShoppingList.parse(first.json());
    expect(first.headers['etag']).toBe('"1"');
    expect(list).toMatchObject({ name: 'Lidl', status: 'active', changeSeq: 0, revision: 1 });

    const replay = await api('POST', '/shopping-lists', { body: { name: 'Lidl' }, idem });
    expect(replay.statusCode).toBe(201);
    expect(ShoppingList.parse(replay.json()).id).toBe(list.id);

    const reused = await api('POST', '/shopping-lists', { body: { name: 'Muu' }, idem });
    expect(reused.statusCode).toBe(422);
    expect(errorCode(reused)).toBe('idempotency_key_reused');

    const noKey = await api('POST', '/shopping-lists', { body: { name: 'x' } });
    expect(noKey.statusCode).toBe(400);
    expect(errorCode(noKey)).toBe('idempotency_key_required');
  });

  it('renames with If-Match; stale -> 409 with currentRevision; missing -> 428', async () => {
    const list = await newList();
    const ok = await api('PATCH', `/shopping-lists/${list.id}`, {
      body: { name: 'Prisma' },
      ifMatch: 1,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['etag']).toBe('"2"');
    expect(ShoppingList.parse(ok.json())).toMatchObject({ name: 'Prisma', revision: 2 });

    const stale = await api('PATCH', `/shopping-lists/${list.id}`, {
      body: { name: 'K-Market' },
      ifMatch: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(ErrorBody.parse(stale.json())).toMatchObject({
      code: 'stale_revision',
      details: { currentRevision: 2 },
    });

    const missing = await api('PATCH', `/shopping-lists/${list.id}`, { body: { name: 'x' } });
    expect(missing.statusCode).toBe(428);
  });

  it('archives and unarchives; archived lists are filtered and reject item writes with 409', async () => {
    const list = await newList(A(), 'Arkistoon');
    const item = await addItem(list.id, 'Maito');
    const archived = await service.patchList(A(), list.id, 1, { status: 'archived' });
    expect(archived.status).toBe('archived');

    expect((await service.listLists(A())).items.map((l) => l.id)).not.toContain(list.id);
    expect((await service.listLists(A(), 'archived')).items.map((l) => l.id)).toContain(list.id);

    const add = await api('POST', `/shopping-lists/${list.id}/items`, {
      body: { name: 'Leipä' },
      idem: key(),
    });
    expect(add.statusCode).toBe(409);
    expect(errorCode(add)).toBe('conflict');
    const pick = await api('PATCH', `/shopping-items/${item.id}`, { body: { picked: true } });
    expect(pick.statusCode).toBe(409);
    const del = await api('DELETE', `/shopping-items/${item.id}`, { ifMatch: item.revision });
    expect(del.statusCode).toBe(409);

    const back = await service.patchList(A(), list.id, archived.revision, { status: 'active' });
    expect(back.status).toBe('active');
    await expect(service.setPicked(A(), item.id, true)).resolves.toMatchObject({ picked: true });
  });

  it('a no-op patch changes neither revision nor change_seq', async () => {
    const list = await newList(A(), 'Sama');
    const same = await service.patchList(A(), list.id, 1, { name: 'Sama' });
    expect(same.revision).toBe(1);
    expect(same.changeSeq).toBe(0);
  });

  it('FR-34: itemCount/pickedCount update after add, checkoff and delete, never move revision, and are household-scoped', async () => {
    const list = await newList(A(), 'Laskuri');
    expect(list).toMatchObject({ itemCount: 0, pickedCount: 0 });
    const counts = async () => {
      const { list: l } = await service.getSnapshot(A(), list.id);
      const idx = (await service.listLists(A(), 'active')).items.find((i) => i.id === list.id)!;
      expect(idx).toMatchObject({ itemCount: l.itemCount, pickedCount: l.pickedCount });
      return { n: l.itemCount, p: l.pickedCount, revision: l.revision };
    };
    const maito = await addItem(list.id, 'Maito');
    const leipa = await addItem(list.id, 'Leipä');
    expect(await counts()).toEqual({ n: 2, p: 0, revision: 1 });
    await api('PATCH', `/shopping-items/${maito.id}`, { body: { picked: true } });
    expect(await counts()).toEqual({ n: 2, p: 1, revision: 1 });
    const seq = await seqOf(list.id);
    await api('DELETE', `/shopping-items/${maito.id}`, { ifMatch: 1 });
    expect(await counts()).toEqual({ n: 1, p: 0, revision: 1 });
    expect(await seqOf(list.id)).toBe(seq + 1); // the delete bumped it, counts themselves do not
    await api('DELETE', `/shopping-items/${leipa.id}`, { ifMatch: 1 });
    const patched = await service.patchList(A(), list.id, 1, { name: 'Laskuri 2' });
    expect(patched).toMatchObject({ itemCount: 0, pickedCount: 0 });
    // Household B sees only its own lists and counts.
    const other = await newList(B(), 'B-lista');
    await addItem(other.id, 'Kahvi', {}, B());
    expect((await service.getSnapshot(B(), other.id)).list.itemCount).toBe(1);
    const bIdx = (await service.listLists(B(), 'active')).items;
    expect(bIdx.find((i) => i.id === list.id)).toBeUndefined();
    expect(
      (await service.listLists(A(), 'active')).items.find((i) => i.id === other.id),
    ).toBeUndefined();
  });

  it('snapshot: no ETag, Cache-Control no-store, list + items + changeSeq', async () => {
    const list = await newList();
    await addItem(list.id, 'Maito');
    const res = await api('GET', `/shopping-lists/${list.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    const snap = ShoppingListSnapshot.parse(res.json());
    expect(snap.list.changeSeq).toBe(1);
    expect(snap.items.map((i) => i.name)).toEqual(['Maito']);
  });
});

describe('FR-35/FR-39: user items including non-food, quantity text kept verbatim', () => {
  it('adds a non-food item without quantity (origin user, Other category)', async () => {
    const list = await newList();
    const res = await api('POST', `/shopping-lists/${list.id}/items`, {
      body: { name: 'Talouspaperi' },
      idem: key(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['etag']).toBe('"1"');
    const item = ShoppingItem.parse(res.json());
    expect(item).toMatchObject({
      origin: 'user',
      normalizedKey: 'talouspaperi',
      amountMin: null,
      originalQuantityText: null,
      picked: false,
      revision: 1,
      categoryId: (await systemCategory('other')).id,
    });
  });

  it('parses quantity text exactly and keeps the original; unknown units stay text only', async () => {
    const list = await newList();
    const range = await addItem(list.id, 'Tomaattimurska', { quantityText: '1-2 prk' });
    expect(range).toMatchObject({
      amountMin: '1',
      amountMax: '2',
      unitCode: 'prk',
      originalQuantityText: '1-2 prk',
    });
    const decimal = await addItem(list.id, 'Kerma', {
      quantityText: '1,5 dl',
      note: 'laktoositon',
    });
    expect(decimal).toMatchObject({ amountMin: '1.5', unitCode: 'dl', note: 'laktoositon' });
    const unknown = await addItem(list.id, 'Kahvi', { quantityText: '2 pakettia' });
    expect(unknown).toMatchObject({
      amountMin: null,
      amountMax: null,
      unitCode: null,
      originalQuantityText: '2 pakettia',
    });
  });

  it('is idempotent: a retried add creates one row and bumps change_seq once', async () => {
    const list = await newList();
    const idem = key();
    const body = { name: 'Banaani', quantityText: '6 kpl' };
    const r1 = await api('POST', `/shopping-lists/${list.id}/items`, { body, idem });
    const r2 = await api('POST', `/shopping-lists/${list.id}/items`, { body, idem });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(ShoppingItem.parse(r2.json()).id).toBe(ShoppingItem.parse(r1.json()).id);
    expect((await service.getSnapshot(A(), list.id)).items).toHaveLength(1);
    expect(await seqOf(list.id)).toBe(1);
  });

  it('edits details with If-Match: bumps revision, re-parses quantity, sets user_modified', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Maito', { quantityText: '1 l' });
    const res = await api('PATCH', `/shopping-items/${item.id}`, {
      body: { name: 'Kaurajuoma', quantityText: '2 l', note: null },
      ifMatch: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBe('"2"');
    expect(ShoppingItem.parse(res.json())).toMatchObject({
      name: 'Kaurajuoma',
      normalizedKey: 'kaurajuoma',
      amountMin: '2',
      unitCode: 'l',
      originalQuantityText: '2 l',
      userModified: true,
      revision: 2,
    });
    const cleared = await service.editItem(A(), item.id, 2, { quantityText: null });
    expect(cleared).toMatchObject({ amountMin: null, unitCode: null, originalQuantityText: null });
  });

  it('deletes with If-Match (missing -> 428, stale -> 409, ok -> 204)', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Leipä');
    expect((await api('DELETE', `/shopping-items/${item.id}`)).statusCode).toBe(428);
    const stale = await api('DELETE', `/shopping-items/${item.id}`, { ifMatch: 7 });
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale)).toBe('stale_revision');
    const ok = await api('DELETE', `/shopping-items/${item.id}`, { ifMatch: 1 });
    expect(ok.statusCode).toBe(204);
    expect((await service.getSnapshot(A(), list.id)).items).toHaveLength(0);
    expect(await seqOf(list.id)).toBe(2); // add + delete
  });

  it('rejects a body that mixes checkoff and edit (contract), and a detail edit without If-Match', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Juusto');
    const mixed = await api('PATCH', `/shopping-items/${item.id}`, {
      body: { picked: true, name: 'x' },
      ifMatch: 1,
    });
    expect(mixed.statusCode).toBe(400);
    const noIfMatch = await api('PATCH', `/shopping-items/${item.id}`, { body: { name: 'x' } });
    expect(noIfMatch.statusCode).toBe(428);
  });
});

describe('ADR-013: per-item revision, desired-state checkoff, change_seq', () => {
  it('checkoff needs no If-Match, attributes to the member, keeps the revision', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Maito');
    const res = await api('PATCH', `/shopping-items/${item.id}`, { body: { picked: true } });
    expect(res.statusCode).toBe(200);
    const picked = ShoppingItem.parse(res.json());
    expect(picked).toMatchObject({ picked: true, pickedByMemberId: h.a.memberId, revision: 1 });
    expect(picked.pickedAt).not.toBeNull();
  });

  it('setPicked is idempotent: repeating the desired state changes nothing', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Maito');
    const first = await service.setPicked(A(), item.id, true);
    const seq = await seqOf(list.id);
    const again = await service.setPicked(A2(), item.id, true);
    expect(again.pickedAt).toBe(first.pickedAt);
    expect(again.pickedByMemberId).toBe(h.a.memberId); // not re-attributed to the second member
    expect(await seqOf(list.id)).toBe(seq);
    const un = await service.setPicked(A2(), item.id, false);
    expect(un).toMatchObject({ picked: false, pickedAt: null, pickedByMemberId: null });
    expect(await seqOf(list.id)).toBe(seq + 1);
  });

  it('last committed write wins across members', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Kananmunat');
    await service.setPicked(A(), item.id, true);
    await service.setPicked(A2(), item.id, false);
    const last = await service.setPicked(A2(), item.id, true);
    expect(last).toMatchObject({ picked: true, pickedByMemberId: a2.memberId });
    for (const who of [A(), A2()]) {
      const snap = await service.getSnapshot(who, list.id);
      expect(snap.items[0]).toMatchObject({ picked: true, pickedByMemberId: a2.memberId });
    }
  });

  it('AC-08: concurrent setPicked from two members converges; change_seq counts real changes', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Maito');
    for (let round = 0; round < 15; round++) {
      const before = await service.getSnapshot(A(), list.id);
      const startPicked = before.items[0]!.picked;
      // Both members race opposite desired states.
      await Promise.all([
        service.setPicked(A(), item.id, true),
        service.setPicked(A2(), item.id, false),
      ]);
      const viewA = await service.getSnapshot(A(), list.id);
      const viewA2 = await service.getSnapshot(A2(), list.id);
      expect(viewA).toEqual(viewA2); // both members see one authoritative state
      const it0 = viewA.items[0]!;
      expect(it0.picked ? it0.pickedByMemberId : null).toBe(it0.picked ? h.a.memberId : null);
      // Serialized writes: the first one is a change iff it differs from the start; the second
      // always differs from the first. So the cursor moves by 1 or 2, never 0 and never more.
      const delta = viewA.list.changeSeq - before.list.changeSeq;
      expect(delta).toBeGreaterThanOrEqual(1);
      expect(delta).toBeLessThanOrEqual(2);
      if (delta === 1) expect(it0.picked).not.toBe(startPicked);
      expect(it0.revision).toBe(1); // checkoffs never move the edit revision
    }
  });

  it('AC-08: many concurrent identical checkoffs make exactly one change', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Leipä');
    const seq = await seqOf(list.id);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => service.setPicked(i % 2 ? A() : A2(), item.id, true)),
    );
    expect(await seqOf(list.id)).toBe(seq + 1);
  });

  it('an unrelated edit does not conflict: checkoff then edit with the pre-checkoff revision', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Maito');
    await service.setPicked(A2(), item.id, true);
    const edited = await service.editItem(A(), item.id, item.revision, { note: 'rasvaton' });
    expect(edited).toMatchObject({ note: 'rasvaton', picked: true, revision: 2 });
  });

  it('an unrelated edit does not conflict: editing one item never changes another item', async () => {
    const list = await newList();
    const milk = await addItem(list.id, 'Maito');
    const bread = await addItem(list.id, 'Leipä');
    await service.editItem(A2(), bread.id, bread.revision, { name: 'Ruisleipä' });
    const edited = await service.editItem(A(), milk.id, milk.revision, { quantityText: '2 l' });
    expect(edited.revision).toBe(2);
    // ... and concurrently, on the same list:
    const [x, y] = await Promise.all([
      service.editItem(A(), milk.id, 2, { note: 'a' }),
      service.editItem(A2(), bread.id, 2, { note: 'b' }),
    ]);
    expect([x.revision, y.revision]).toEqual([3, 3]);
  });

  it('a concurrent checkoff and a detail edit of the same item both succeed', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Voi');
    const [picked, edited] = await Promise.all([
      service.setPicked(A2(), item.id, true),
      service.editItem(A(), item.id, 1, { quantityText: '500 g' }),
    ]);
    expect(picked.picked).toBe(true);
    expect(edited.originalQuantityText).toBe('500 g');
    const final = (await service.getSnapshot(A(), list.id)).items[0]!;
    expect(final).toMatchObject({ picked: true, originalQuantityText: '500 g', revision: 2 });
  });

  it('stale edit -> 409: two edits from the same revision, exactly one wins', async () => {
    const list = await newList();
    const item = await addItem(list.id, 'Juusto');
    const results = await Promise.all([
      api('PATCH', `/shopping-items/${item.id}`, { body: { name: 'Edam' }, ifMatch: 1 }),
      api('PATCH', `/shopping-items/${item.id}`, { body: { name: 'Gouda' }, ifMatch: 1 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(ErrorBody.parse(loser.json())).toMatchObject({
      code: 'stale_revision',
      details: { currentRevision: 2 },
    });
  });

  it('change_seq moves by exactly one per item change, in the same transaction; not on failure', async () => {
    const list = await newList();
    expect(await seqOf(list.id)).toBe(0);
    const item = await addItem(list.id, 'Omena');
    expect(await seqOf(list.id)).toBe(1);
    await service.editItem(A(), item.id, 1, { name: 'Omenat' });
    expect(await seqOf(list.id)).toBe(2);
    await service.setPicked(A(), item.id, true);
    expect(await seqOf(list.id)).toBe(3);

    // Failed writes roll back without moving the cursor.
    await expect(service.editItem(A(), item.id, 1, { name: 'x' })).rejects.toMatchObject({
      code: 'stale_revision',
    });
    await expect(
      service.editItem(A(), item.id, 2, { categoryId: ShoppingCategoryId.parse(randomUUID()) }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await seqOf(list.id)).toBe(3);

    // No-op edit: nothing changes.
    const same = await service.editItem(A(), item.id, 2, { name: 'Omenat' });
    expect(same.revision).toBe(2);
    expect(await seqOf(list.id)).toBe(3);

    await service.deleteItem(A(), item.id, 2);
    expect(await seqOf(list.id)).toBe(4);
    // List rename moves the cursor too, so open views refetch.
    await service.patchList(A(), list.id, 1, { name: 'Uusi' });
    expect(await seqOf(list.id)).toBe(5);
  });

  it('a snapshot is consistent: items reflect exactly the returned changeSeq', async () => {
    const list = await newList();
    const writes = Array.from({ length: 10 }, (_, i) => addItem(list.id, `Tuote ${i}`));
    const snaps = await Promise.all(
      Array.from({ length: 10 }, () => service.getSnapshot(A(), list.id)),
    );
    await Promise.all(writes);
    for (const s of snaps) expect(s.items).toHaveLength(s.list.changeSeq); // one seq per add
  });
});

describe('FR-37: last updater of an item comes from the session actor', () => {
  const updaterOf = async (id: string) =>
    (
      await pool.query<{ u: string | null; r: number }>(
        'SELECT updated_by_member_id AS u, revision AS r FROM shopping_items WHERE id = $1',
        [id],
      )
    ).rows[0]!;

  it('FR-37: add, edit and checkoff each record the acting member; no-ops change nothing', async () => {
    const list = await newList();
    const res = await api('POST', `/shopping-lists/${list.id}/items`, {
      body: { name: 'Maito' },
      idem: key(),
    });
    const added = ShoppingItem.parse(res.json());
    expect(added.updatedByMemberId).toBe(h.a.memberId);

    const edited = await service.editItem(A2(), added.id, added.revision, { note: 'laktoositon' });
    expect(edited).toMatchObject({ updatedByMemberId: a2.memberId, revision: added.revision + 1 });

    const back = await service.editItem(A(), added.id, edited.revision, { note: 'luomu' });
    expect(back.updatedByMemberId).toBe(h.a.memberId);

    const seq = await seqOf(list.id);
    const picked = await service.setPicked(A2(), added.id, true);
    // Same revision/cursor semantics as before: checkoff keeps the revision, moves the cursor once.
    expect(picked).toMatchObject({ updatedByMemberId: a2.memberId, revision: back.revision });
    expect(await seqOf(list.id)).toBe(seq + 1);

    // An already-satisfied checkoff and an unchanged edit by A are no-ops: still A2.
    expect((await service.setPicked(A(), added.id, true)).updatedByMemberId).toBe(a2.memberId);
    const noop = await service.editItem(A(), added.id, picked.revision, { note: 'luomu' });
    expect(noop).toMatchObject({ updatedByMemberId: a2.memberId, revision: picked.revision });
    expect(await seqOf(list.id)).toBe(seq + 1);

    const snap = ShoppingListSnapshot.parse(
      (await api('GET', `/shopping-lists/${list.id}`)).json(),
    );
    expect(snap.items.find((i) => i.id === added.id)?.updatedByMemberId).toBe(a2.memberId);
  });

  it('FR-37: a replayed add does not change the last updater', async () => {
    const list = await newList();
    const k = key();
    const first = await service.addItem(A(), list.id, k, { name: 'Leipä' });
    await service.editItem(A2(), first.value.id, first.value.revision, { note: 'ruis' });
    const before = await updaterOf(first.value.id);

    const replay = await api('POST', `/shopping-lists/${list.id}/items`, {
      body: { name: 'Leipä' },
      idem: k,
    });
    expect(replay.statusCode).toBe(201);
    expect(ShoppingItem.parse(replay.json()).updatedByMemberId).toBe(a2.memberId);
    expect(await updaterOf(first.value.id)).toEqual(before);
    expect(before.u).toBe(a2.memberId);
  });

  it('FR-37: household B never sees members of A and cannot be attributed to A rows', async () => {
    const listB = await newList(B(), 'B:n lista');
    const itemB = await addItem(listB.id, 'Kahvi', {}, B());
    expect(itemB.updatedByMemberId).toBe(h.b.memberId);
    const snapB = ShoppingListSnapshot.parse(
      (await api('GET', `/shopping-lists/${listB.id}`, { who: 'b' })).json(),
    );
    const updaters = snapB.items.map((i) => i.updatedByMemberId);
    expect(updaters).not.toContain(h.a.memberId);
    expect(updaters).not.toContain(a2.memberId);

    // The composite FK rejects an updater from another household even if code passed one.
    await expect(
      pool.query(
        `UPDATE shopping_items SET updated_by_member_id = $3 WHERE household_id = $1 AND id = $2`,
        [h.b.householdId, itemB.id, h.a.memberId],
      ),
    ).rejects.toMatchObject({ constraint: 'shopping_items_updater_same_household_fk' });
  });
});

describe('FR-36: categories, Other fallback, household corrections by normalized key', () => {
  it('lists system defaults with Other last', async () => {
    const res = await api('GET', '/shopping-categories');
    expect(res.statusCode).toBe(200);
    const { items } = ShoppingCategoryList.parse(res.json());
    const codes = items.map((c) => c.systemCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        'vegetables',
        'fruit',
        'dairy',
        'meat',
        'dry_goods',
        'household_supplies',
      ]),
    );
    expect(codes.at(-1)).toBe('other');
  });

  const overrideOf = async (normalizedKey: string) =>
    (
      await pool.query<{ c: string | null; r: number }>(
        `SELECT shopping_category_id AS c, revision AS r FROM household_ingredient_settings
          WHERE household_id = $1 AND normalized_key = $2`,
        [h.a.householdId, normalizedKey],
      )
    ).rows[0];

  it('FR-36: an explicit category on add that differs from the default becomes the correction', async () => {
    const list = await newList();
    const dairy = await systemCategory('dairy');
    await addItem(list.id, 'Kauramaito', { categoryId: dairy.id });
    expect(await overrideOf('kauramaito')).toMatchObject({ c: dairy.id, r: 1 });
    const next = await addItem(list.id, '  KAURAMAITO ');
    expect(next.categoryId).toBe(dairy.id);
  });

  it('FR-36: choosing the default category writes nothing (on add and on edit)', async () => {
    const list = await newList();
    const other = await systemCategory('other');
    const item = await addItem(list.id, 'Pyykkietikka', { categoryId: other.id });
    expect(item.categoryId).toBe(other.id);
    // A client that re-sends the current category with every edit never creates an override.
    const edited = await service.editItem(A(), item.id, 1, {
      quantityText: '1 l',
      categoryId: other.id,
    });
    expect(edited.originalQuantityText).toBe('1 l');
    expect(await overrideOf('pyykkietikka')).toBeUndefined();
  });

  it('FR-36: recategorizing to a different category replaces the correction; re-sending it writes nothing', async () => {
    const list = await newList();
    const other = await systemCategory('other');
    const veg = await systemCategory('vegetables');
    const fruit = await systemCategory('fruit');
    const item = await addItem(list.id, 'Kesäkurpitsa');
    expect(item.categoryId).toBe(other.id);

    const moved = await service.editItem(A(), item.id, 1, { categoryId: veg.id });
    expect(moved.categoryId).toBe(veg.id);
    expect(await overrideOf('kesäkurpitsa')).toMatchObject({ c: veg.id, r: 1 });
    expect((await addItem(list.id, 'kesäkurpitsa')).categoryId).toBe(veg.id);

    // Same category again (now the default, via the override): no write, revision unchanged.
    await service.editItem(A(), item.id, 2, { note: 'iso', categoryId: veg.id });
    expect(await overrideOf('kesäkurpitsa')).toMatchObject({ c: veg.id, r: 1 });

    // A different one replaces it.
    await service.editItem(A(), item.id, 3, { categoryId: fruit.id });
    expect(await overrideOf('kesäkurpitsa')).toMatchObject({ c: fruit.id, r: 2 });
  });

  it('FR-36: categoryId null puts the item in its default category and never changes the correction', async () => {
    const list = await newList();
    const veg = await systemCategory('vegetables');
    const dairy = await systemCategory('dairy');
    const first = await addItem(list.id, 'Parsa', { categoryId: veg.id });
    const second = await addItem(list.id, 'Parsa');
    const moved = await service.editItem(A(), second.id, 1, { categoryId: dairy.id });
    expect(moved.categoryId).toBe(dairy.id);
    expect(await overrideOf('parsa')).toMatchObject({ c: dairy.id, r: 2 });
    const reset = await service.editItem(A(), first.id, 1, { categoryId: null });
    expect(reset.categoryId).toBe(dairy.id); // the current default for "parsa"
    expect(await overrideOf('parsa')).toMatchObject({ c: dairy.id, r: 2 });
  });

  it('FR-36: renaming an item keeps its category', async () => {
    const list = await newList();
    const veg = await systemCategory('vegetables');
    const fruit = await systemCategory('fruit');
    await addItem(list.id, 'Omena', { categoryId: fruit.id }); // correction: omena -> fruit
    const item = await addItem(list.id, 'Porkkana', { categoryId: veg.id });
    const renamed = await service.editItem(A(), item.id, 1, { name: 'Omena' });
    expect(renamed).toMatchObject({ normalizedKey: 'omena', categoryId: veg.id });
  });

  it('household corrections do not leak to another household', async () => {
    const listA = await newList();
    const fruit = await systemCategory('fruit');
    await addItem(listA.id, 'Mango', { categoryId: fruit.id });
    const listB = await newList(B());
    const inB = await addItem(listB.id, 'Mango', {}, B());
    expect(inB.categoryId).toBe((await systemCategory('other')).id);
  });

  it('creates household categories: trimmed, unique ignoring case (409), gapped default order', async () => {
    const idem = key();
    const res = await api('POST', '/shopping-categories', { body: { name: '  Leivät ' }, idem });
    expect(res.statusCode).toBe(201);
    const cat = ShoppingCategory.parse(res.json());
    expect(cat).toMatchObject({ name: 'Leivät', systemCode: null });
    expect(cat.sortOrder).toBe(70); // 10 after household supplies (60), before Other (1000)

    const replay = await api('POST', '/shopping-categories', { body: { name: '  Leivät ' }, idem });
    expect(ShoppingCategory.parse(replay.json()).id).toBe(cat.id);

    const dup = await api('POST', '/shopping-categories', {
      body: { name: 'LEIVÄT' },
      idem: key(),
    });
    expect(dup.statusCode).toBe(409);
    expect(errorCode(dup)).toBe('category_name_taken');

    // System default names are taken too, ignoring case and spaces.
    for (const name of ['other', ' OTHER ', 'Dairy']) {
      const sys = await api('POST', '/shopping-categories', { body: { name }, idem: key() });
      expect(sys.statusCode).toBe(409);
      expect(errorCode(sys)).toBe('category_name_taken');
    }

    // Another household may use the same name.
    const inB = await api('POST', '/shopping-categories', {
      who: 'b',
      body: { name: 'Leivät' },
      idem: key(),
    });
    expect(inB.statusCode).toBe(201);
  });

  it('concurrent creates differing only by case: one 201, one 409', async () => {
    const results = await Promise.all([
      api('POST', '/shopping-categories', { body: { name: 'Pakasteet' }, idem: key() }),
      api('POST', '/shopping-categories', { body: { name: 'pakasteet' }, idem: key() }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('patches rename/reorder (one row, last write wins); system rows are read-only', async () => {
    const { value: cat } = await service.createCategory(A(), key(), { name: 'Juomat' });
    const { value: other } = await service.createCategory(A(), key(), { name: 'Herkut' });
    const moved = await api('PATCH', `/shopping-categories/${cat.id}`, {
      body: { sortOrder: 15, name: 'Juomat ja mehut' },
    });
    expect(moved.statusCode).toBe(200);
    expect(ShoppingCategory.parse(moved.json())).toMatchObject({
      name: 'Juomat ja mehut',
      sortOrder: 15,
    });
    // Only that row moved.
    const { items } = await service.listCategories(A());
    expect(items.find((c) => c.id === other.id)!.sortOrder).toBe(other.sortOrder);
    expect(items.findIndex((c) => c.id === cat.id)).toBe(
      items.findIndex((c) => c.systemCode === 'vegetables') + 1,
    );

    const clash = await api('PATCH', `/shopping-categories/${cat.id}`, {
      body: { name: 'herkut' },
    });
    expect(clash.statusCode).toBe(409);
    expect(errorCode(clash)).toBe('category_name_taken');
    const sysClash = await api('PATCH', `/shopping-categories/${cat.id}`, {
      body: { name: 'household supplies' },
    });
    expect(errorCode(sysClash)).toBe('category_name_taken');
    const ownName = await api('PATCH', `/shopping-categories/${cat.id}`, {
      body: { name: 'JUOMAT JA MEHUT' },
    });
    expect(ownName.statusCode).toBe(200); // renaming to itself in another case is fine

    const dairy = await systemCategory('dairy');
    const sys = await api('PATCH', `/shopping-categories/${dairy.id}`, { body: { name: 'x' } });
    expect(sys.statusCode).toBe(403);
  });

  it('items can use a household category', async () => {
    const { value: cat } = await service.createCategory(A(), key(), { name: 'Lemmikit' });
    const list = await newList();
    expect((await addItem(list.id, 'Kissanruoka', { categoryId: cat.id })).categoryId).toBe(cat.id);
  });
});

describe('Staple flag (ADR-015; stored only, UI and generation come later)', () => {
  it('stores and clears the flag per household and key without touching the category override', async () => {
    const list = await newList();
    const dairy = await systemCategory('dairy');
    await addItem(list.id, 'Voi', { categoryId: dairy.id });
    await service.setStaple(A(), 'voi', true);
    await service.setStaple(A(), 'voi', true); // idempotent
    const read = async (hh: string) =>
      (
        await pool.query<{ s: boolean; c: string | null; r: number }>(
          `SELECT is_staple AS s, shopping_category_id AS c, revision AS r
             FROM household_ingredient_settings WHERE household_id = $1 AND normalized_key = 'voi'`,
          [hh],
        )
      ).rows[0];
    expect(await read(h.a.householdId)).toMatchObject({ s: true, c: dairy.id, r: 2 });
    expect(await read(h.b.householdId)).toBeUndefined();
    await service.setStaple(A(), 'voi', false);
    expect(await read(h.a.householdId)).toMatchObject({ s: false, r: 3 });
  });

  it('rejects a key that is not normalized', async () => {
    await expect(service.setStaple(A(), ' Voi', true)).rejects.toThrow();
  });
});

describe('Household isolation (hard rule 2)', () => {
  it('household B cannot see or change anything of household A', async () => {
    const list = await newList(A(), 'Salainen');
    const item = await addItem(list.id, 'Maito');
    const { value: cat } = await service.createCategory(A(), key(), { name: 'Vain A' });

    const listsB = ShoppingListSummaryList.parse(
      (await api('GET', '/shopping-lists', { who: 'b' })).json(),
    );
    expect(listsB.items.map((l) => l.id)).not.toContain(list.id);
    const catsB = ShoppingCategoryList.parse(
      (await api('GET', '/shopping-categories', { who: 'b' })).json(),
    );
    expect(catsB.items.map((c) => c.id)).not.toContain(cat.id);

    const denied = await Promise.all([
      api('GET', `/shopping-lists/${list.id}`, { who: 'b' }),
      api('PATCH', `/shopping-lists/${list.id}`, { who: 'b', body: { name: 'x' }, ifMatch: 1 }),
      api('POST', `/shopping-lists/${list.id}/items`, {
        who: 'b',
        body: { name: 'x' },
        idem: key(),
      }),
      api('PATCH', `/shopping-items/${item.id}`, { who: 'b', body: { picked: true } }),
      api('PATCH', `/shopping-items/${item.id}`, { who: 'b', body: { name: 'x' }, ifMatch: 1 }),
      api('DELETE', `/shopping-items/${item.id}`, { who: 'b', ifMatch: 1 }),
      api('PATCH', `/shopping-categories/${cat.id}`, { who: 'b', body: { name: 'x' } }),
    ]);
    for (const res of denied) {
      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('not_found');
    }

    // B cannot attach A's category to its own items.
    const listB = await newList(B());
    const useCat = await api('POST', `/shopping-lists/${listB.id}/items`, {
      who: 'b',
      body: { name: 'x', categoryId: cat.id },
      idem: key(),
    });
    expect(useCat.statusCode).toBe(404);
    // ... nor through a detail edit; B's override for the key stays untouched.
    const itemB = await addItem(listB.id, 'Kahvi', {}, B());
    const editCat = await api('PATCH', `/shopping-items/${itemB.id}`, {
      who: 'b',
      body: { categoryId: cat.id },
      ifMatch: itemB.revision,
    });
    expect(editCat.statusCode).toBe(404);
    const settingsB = await pool.query(
      `SELECT 1 FROM household_ingredient_settings
        WHERE household_id = $1 AND shopping_category_id = $2`,
      [h.b.householdId, cat.id],
    );
    expect(settingsB.rowCount).toBe(0);
    expect((await service.getSnapshot(B(), listB.id)).items[0]!.categoryId).toBe(itemB.categoryId);

    // Nothing of A changed.
    const snap = await service.getSnapshot(A(), list.id);
    expect(snap.list).toMatchObject({ name: 'Salainen', revision: 1, changeSeq: 1 });
    expect(snap.items).toEqual([item]);
  });
});

describe('AC-10: shopping works without any AI provider', () => {
  it('the shopping module imports no AI code', () => {
    const dir = new URL('./', import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    for (const f of sources) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const spec of imports) expect(spec).not.toMatch(/(^|\/)(ai|openai)(\/|$)|openai/i);
    }
  });

  it('a full list workflow runs with no AI configuration present', async () => {
    // The service is built from a database pool only; there is no AI provider to pass in.
    const list = await newList(A(), 'AC-10');
    const item = await addItem(list.id, 'Maito');
    await service.setPicked(A(), item.id, true);
    expect((await service.getSnapshot(A2(), list.id)).items[0]!.picked).toBe(true);
  });
});
