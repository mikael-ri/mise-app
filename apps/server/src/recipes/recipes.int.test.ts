// FR-01, FR-03, FR-05, AC-02, AC-03 against real PostgreSQL as the app role (shared test config, freshly migrated).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ErrorBody,
  HouseholdId,
  MemberId,
  Recipe,
  RecipeVersion,
  RecipeVersionList,
} from '@mise/contracts';
import { buildApp } from '../app.js';
import { CSRF_HEADER, createPool, issueCsrfToken } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import { createRecipesService, registerRecipeRoutes } from './index.js';
import type { RecipeActor } from './index.js';
import { soupContent } from './test-fixtures.js';

const pool = createPool(loadTestDatabaseConfig().appUrl, 6);
const service = createRecipesService(pool);

let h: TwoHouseholds;
let app: FastifyInstance;
const key = () => randomUUID();
const deviceSessionId = randomUUID();

const actor = (f: { householdId: string; memberId: string }): RecipeActor => ({
  householdId: HouseholdId.parse(f.householdId),
  memberId: MemberId.parse(f.memberId),
});
const actorA = (): RecipeActor => actor(h.a);
const actorB = (): RecipeActor => actor(h.b);

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null });
  // Test-only stand-in for the session hook (the real one is covered in auth/*.int.test.ts):
  // the actor is chosen by a header.
  app.addHook('onRequest', async (request) => {
    const who = request.headers['x-test-actor'] === 'b' ? h.b : h.a;
    request.actor = {
      userId: who.userId,
      householdId: who.householdId,
      memberId: who.memberId,
      deviceSessionId,
    } as unknown as RequestContext;
  });
  registerRecipeRoutes(app, service);
});

// No row cleanup: every test file starts from a freshly migrated database (setup-reset.ts), and
// recipe_versions is immutable, so tests never try to delete from it.
afterAll(async () => {
  await app.close();
  await pool.end();
});

function api(
  method: 'GET' | 'POST' | 'PATCH',
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
    url: `/api/v1/recipes${path}`,
    headers,
    ...(o.body === undefined ? {} : { payload: o.body as object }),
  });
}

async function createViaService(title = 'Porkkanakeitto', carrot = '400') {
  const { recipe } = await service.createRecipe(actorA(), key(), {
    title,
    content: soupContent(carrot),
  });
  return recipe;
}

const count = async (sql: string, params: unknown[]) =>
  Number((await pool.query<{ n: string }>(sql, params)).rows[0]!.n);

describe('FR-01: create and read', () => {
  it('creates recipe + version 1 with the pointer, search projection and audit event', async () => {
    const r = await createViaService();
    expect(r.revision).toBe(1);
    expect(r.currentVersion.versionNo).toBe(1);
    expect(r.content.ingredients[0]?.original_quantity_text).toBe('400 g');
    const row = (
      await pool.query<{ search_title: string; search_ingredients: string; has_doc: boolean }>(
        `SELECT search_title, search_ingredients, search_document <> ''::tsvector AS has_doc
           FROM recipes WHERE id = $1`,
        [r.id],
      )
    ).rows[0]!;
    expect(row.search_title).toBe('Porkkanakeitto');
    expect(row.search_ingredients).toContain('porkkana');
    expect(row.has_doc).toBe(true);
    expect(
      await count(
        `SELECT count(*) AS n FROM audit_events WHERE entity_id = $1 AND action = 'recipe.created'`,
        [r.id],
      ),
    ).toBe(1);
  });

  it('API: POST returns 201 with ETag; GET returns the same recipe', async () => {
    const res = await api('POST', '', {
      body: { title: 'API-keitto', content: soupContent() },
      idem: key(),
    });
    expect(res.statusCode).toBe(201);
    const recipe = Recipe.parse(res.json());
    expect(res.headers['etag']).toBe(`"${recipe.revision}"`);
    const got = await api('GET', `/${recipe.id}`);
    expect(got.statusCode).toBe(200);
    expect(Recipe.parse(got.json()).id).toBe(recipe.id);
  });

  it('is idempotent: same key + body replays; same key + other body is 422; no key is 400', async () => {
    const body = { title: 'Kerran', content: soupContent() };
    const idem = key();
    const first = await api('POST', '', { body, idem });
    const second = await api('POST', '', { body, idem });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(Recipe.parse(second.json()).id).toBe(Recipe.parse(first.json()).id);
    expect(
      await count('SELECT count(*) AS n FROM recipes WHERE title = $1 AND household_id = $2', [
        'Kerran',
        h.a.householdId,
      ]),
    ).toBe(1);

    const other = await api('POST', '', { body: { ...body, title: 'Toinen' }, idem });
    expect(other.statusCode).toBe(422);
    expect(ErrorBody.parse(other.json()).code).toBe('idempotency_key_reused');

    const missing = await api('POST', '', { body });
    expect(missing.statusCode).toBe(400);
    expect(ErrorBody.parse(missing.json()).code).toBe('idempotency_key_required');
  });

  it('FR-05: rejects an inverted range and keeps original text verbatim otherwise', async () => {
    const bad = soupContent();
    bad.ingredients[0] = { ...bad.ingredients[0]!, amount_min: '3', amount_max: '2' };
    const res = await api('POST', '', { body: { title: 'Rikki', content: bad }, idem: key() });
    expect(res.statusCode).toBe(400);

    const vague = soupContent();
    vague.ingredients[0] = {
      ...vague.ingredients[0]!,
      original_quantity_text: 'maun mukaan',
      amount_min: null,
      amount_max: null,
      original_unit: null,
      canonical_unit_code: null,
      scale_policy: 'to_taste',
    };
    const ok = await service.createRecipe(actorA(), key(), { title: 'Mauste', content: vague });
    expect(ok.recipe.content.ingredients[0]).toMatchObject({
      original_quantity_text: 'maun mukaan',
      amount_min: null,
    });
  });
});

describe('AC-03 / FR-03: edits create immutable versions', () => {
  it('AC-03: 400 g -> 200 g shows 200 g now and keeps the 400 g version accessible', async () => {
    const r = await createViaService('AC03', '400');
    const v1 = r.currentVersion.id;
    const res = await api('PATCH', `/${r.id}`, {
      ifMatch: r.revision,
      body: { content: soupContent('200'), changeReason: 'Vähemmän porkkanaa' },
    });
    expect(res.statusCode).toBe(200);
    const updated = Recipe.parse(res.json());
    expect(updated.revision).toBe(2);
    expect(updated.currentVersion.versionNo).toBe(2);
    expect(updated.currentVersion.changeReason).toBe('Vähemmän porkkanaa');
    expect(updated.content.ingredients[0]?.original_quantity_text).toBe('200 g');

    const list = RecipeVersionList.parse((await api('GET', `/${r.id}/versions`)).json());
    expect(list.items.map((v) => v.versionNo)).toEqual([2, 1]);
    const old = RecipeVersion.parse((await api('GET', `/${r.id}/versions/${v1}`)).json());
    expect(old.content.ingredients[0]?.original_quantity_text).toBe('400 g');
    expect(old.version.createdByMemberId).toBe(h.a.memberId);
  });

  it('AC-03: the second member sees the same shared recipe and versions', async () => {
    // Same household, different member: authorization is household-wide.
    const r = await createViaService('Shared');
    const other = await pool.query<{ id: string }>(
      `INSERT INTO users (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://auth.test', $1, 'Second') RETURNING id`,
      [randomUUID()],
    );
    const member = await pool.query<{ id: string }>(
      `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member') RETURNING id`,
      [h.a.householdId, other.rows[0]!.id],
    );
    const second: RecipeActor = actor({
      householdId: h.a.householdId,
      memberId: member.rows[0]!.id,
    });
    const edited = await service.patchRecipe(second, r.id, r.revision, {
      content: soupContent('250'),
    });
    expect(edited.currentVersion.createdByMemberId).toBe(second.memberId);
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(2);
  });

  it('metadata edits (tags, notes, title) and archive create no version', async () => {
    const r = await createViaService('Meta');
    const res = await api('PATCH', `/${r.id}`, {
      ifMatch: r.revision,
      body: { tags: ['arki', 'keitto'], generalNotes: 'Hyvä', title: 'Meta 2', archived: true },
    });
    expect(res.statusCode).toBe(200);
    const m = Recipe.parse(res.json());
    expect(m.revision).toBe(2);
    expect(m.currentVersion.id).toBe(r.currentVersion.id);
    expect(m.archivedAt).not.toBeNull();
    expect(m.tags).toEqual(['arki', 'keitto']);
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(1);
    const search = (
      await pool.query<{ search_title: string; search_ingredients: string }>(
        'SELECT search_title, search_ingredients FROM recipes WHERE id = $1',
        [r.id],
      )
    ).rows[0]!;
    expect(search.search_title).toBe('Meta 2');
    expect(search.search_ingredients).toContain('keitto');
  });

  it('identical content creates no new version and no revision bump', async () => {
    const r = await createViaService('Same');
    const same = await service.patchRecipe(actorA(), r.id, r.revision, { content: r.content });
    expect(same.revision).toBe(1);
    expect(same.currentVersion.versionNo).toBe(1);
  });

  it('archived recipe rejects new content (409) until it is unarchived', async () => {
    const r = await createViaService('Arch');
    const a = await service.patchRecipe(actorA(), r.id, r.revision, { archived: true });
    await expect(
      service.patchRecipe(actorA(), r.id, a.revision, { content: soupContent('1') }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const u = await service.patchRecipe(actorA(), r.id, a.revision, { archived: false });
    expect(u.archivedAt).toBeNull();
    const e = await service.patchRecipe(actorA(), r.id, u.revision, { content: soupContent('1') });
    expect(e.currentVersion.versionNo).toBe(2);
  });

  it('audit events record version creation, metadata edits and archiving without content', async () => {
    const r = await createViaService('Audit');
    const e = await service.patchRecipe(actorA(), r.id, r.revision, {
      content: soupContent('300'),
      tags: ['x'],
    });
    await service.patchRecipe(actorA(), r.id, e.revision, { archived: true });
    const { rows } = await pool.query<{ action: string; summary: unknown }>(
      'SELECT action, summary FROM audit_events WHERE entity_id = $1 ORDER BY created_at, action',
      [r.id],
    );
    expect(rows.map((x) => x.action).sort()).toEqual([
      'recipe.archived',
      'recipe.created',
      'recipe.updated',
      'recipe.version_created',
    ]);
    expect(JSON.stringify(rows)).not.toContain('porkkana');
  });
});

describe('stale edits (tech §5.2, DB §12)', () => {
  it('stale If-Match returns 409 stale_revision with currentRevision and changes nothing', async () => {
    const r = await createViaService('Stale');
    await service.patchRecipe(actorA(), r.id, r.revision, { tags: ['eka'] });
    const res = await api('PATCH', `/${r.id}`, {
      ifMatch: r.revision,
      body: { content: soupContent('100') },
    });
    expect(res.statusCode).toBe(409);
    const body = ErrorBody.parse(res.json());
    expect(body.code).toBe('stale_revision');
    expect(body.details).toEqual({ currentRevision: 2 });
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(1);
  });

  it('two concurrent edits with the same revision: exactly one wins', async () => {
    const r = await createViaService('Race');
    const results = await Promise.allSettled([
      service.patchRecipe(actorA(), r.id, r.revision, { content: soupContent('11') }),
      service.patchRecipe(actorA(), r.id, r.revision, { content: soupContent('22') }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'stale_revision' });
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(2);
  });

  it('missing If-Match is 428; malformed is 400', async () => {
    const r = await createViaService('NoMatch');
    const missing = await api('PATCH', `/${r.id}`, { body: { tags: ['a'] } });
    expect(missing.statusCode).toBe(428);
    const bad = await api('PATCH', `/${r.id}`, { body: { tags: ['a'] }, ifMatch: 'W/"1"' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('FR-03: restore', () => {
  it('creates a NEW version copied from the old one; history is untouched', async () => {
    const r = await createViaService('Restore', '400');
    const v1 = r.currentVersion.id;
    const edited = await service.patchRecipe(actorA(), r.id, r.revision, {
      content: soupContent('200'),
    });
    const res = await api('POST', `/${r.id}/restore`, {
      ifMatch: edited.revision,
      idem: key(),
      body: { versionId: v1, changeReason: 'Takaisin' },
    });
    expect(res.statusCode).toBe(200);
    const restored = Recipe.parse(res.json());
    expect(restored.currentVersion.versionNo).toBe(3);
    expect(restored.currentVersion.id).not.toBe(v1);
    expect(restored.content.ingredients[0]?.original_quantity_text).toBe('400 g');
    const versions = (await service.listVersions(actorA(), r.id)).items;
    expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    const v2 = await service.getVersion(actorA(), r.id, edited.currentVersion.id);
    expect(v2.content.ingredients[0]?.original_quantity_text).toBe('200 g');
  });

  it('is idempotent, rejects stale revisions, and 404s on a foreign version', async () => {
    const r = await createViaService('RestoreRules');
    const edited = await service.patchRecipe(actorA(), r.id, r.revision, {
      content: soupContent('5'),
    });
    const idem = key();
    const body = { versionId: r.currentVersion.id };
    const a = await api('POST', `/${r.id}/restore`, { ifMatch: edited.revision, idem, body });
    const b = await api('POST', `/${r.id}/restore`, { ifMatch: edited.revision, idem, body });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(3);

    const stale = await api('POST', `/${r.id}/restore`, {
      ifMatch: edited.revision,
      idem: key(),
      body,
    });
    expect(stale.statusCode).toBe(409);

    const other = await createViaService('Other');
    const foreign = await api('POST', `/${r.id}/restore`, {
      ifMatch: Recipe.parse(a.json()).revision,
      idem: key(),
      body: { versionId: other.currentVersion.id },
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('FR-30/31: household isolation', () => {
  it('household B cannot read, list versions, fetch a version, edit or restore household A recipes', async () => {
    const r = await createViaService('Salainen');
    const v1 = r.currentVersion.id;
    expect((await api('GET', `/${r.id}`, { who: 'b' })).statusCode).toBe(404);
    expect((await api('GET', `/${r.id}/versions`, { who: 'b' })).statusCode).toBe(404);
    expect((await api('GET', `/${r.id}/versions/${v1}`, { who: 'b' })).statusCode).toBe(404);
    const patch = await api('PATCH', `/${r.id}`, {
      who: 'b',
      ifMatch: r.revision,
      body: { title: 'Varastettu', archived: true },
    });
    expect(patch.statusCode).toBe(404);
    const restore = await api('POST', `/${r.id}/restore`, {
      who: 'b',
      ifMatch: r.revision,
      idem: key(),
      body: { versionId: v1 },
    });
    expect(restore.statusCode).toBe(404);
    await expect(service.getRecipe(actorB(), r.id)).rejects.toMatchObject({ code: 'not_found' });
    const untouched = await service.getRecipe(actorA(), r.id);
    expect(untouched.title).toBe('Salainen');
    expect(untouched.archivedAt).toBeNull();
  });

  it('the same idempotency key in two households creates two recipes', async () => {
    const idem = key();
    const body = { title: 'Jaettu avain', content: soupContent() };
    const a = await api('POST', '', { who: 'a', body, idem });
    const b = await api('POST', '', { who: 'b', body, idem });
    expect(Recipe.parse(a.json()).id).not.toBe(Recipe.parse(b.json()).id);
  });
});

describe('archived recipes (FR-01; tech §5.2: archived recipes stay referenced by history)', () => {
  it('stays fully readable: recipe, version list and old versions', async () => {
    const r = await createViaService('Arkistoitu');
    await service.patchRecipe(actorA(), r.id, r.revision, { archived: true });
    expect((await api('GET', `/${r.id}`)).statusCode).toBe(200);
    expect(Recipe.parse((await api('GET', `/${r.id}`)).json()).archivedAt).not.toBeNull();
    expect((await api('GET', `/${r.id}/versions`)).statusCode).toBe(200);
    expect((await api('GET', `/${r.id}/versions/${r.currentVersion.id}`)).statusCode).toBe(200);
  });

  it('409 conflict (not stale_revision) for new content, also when sent together with archived=false', async () => {
    const r = await createViaService('Arkisto 409');
    const a = await service.patchRecipe(actorA(), r.id, r.revision, { archived: true });
    for (const body of [
      { content: soupContent('9') },
      { archived: false, content: soupContent('9') },
    ]) {
      const res = await api('PATCH', `/${r.id}`, { ifMatch: a.revision, body });
      expect(res.statusCode).toBe(409);
      expect(ErrorBody.parse(res.json()).code).toBe('conflict');
    }
    const after = await service.getRecipe(actorA(), r.id);
    expect(after.revision).toBe(a.revision);
    expect(after.archivedAt).not.toBeNull();
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(1);
  });

  it('409 conflict for restore; metadata edits stay allowed', async () => {
    const r = await createViaService('Arkisto restore');
    const e = await service.patchRecipe(actorA(), r.id, r.revision, { content: soupContent('7') });
    const a = await service.patchRecipe(actorA(), r.id, e.revision, { archived: true });
    const res = await api('POST', `/${r.id}/restore`, {
      ifMatch: a.revision,
      idem: key(),
      body: { versionId: r.currentVersion.id },
    });
    expect(res.statusCode).toBe(409);
    expect(ErrorBody.parse(res.json()).code).toBe('conflict');
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(2);
    const tagged = await api('PATCH', `/${r.id}`, { ifMatch: a.revision, body: { tags: ['x'] } });
    expect(tagged.statusCode).toBe(200);
  });
});

describe('restore request contract', () => {
  it('missing If-Match is 428, malformed If-Match is 400, missing Idempotency-Key is 400', async () => {
    const r = await createViaService('Restore headers');
    const body = { versionId: r.currentVersion.id };
    const missing = await api('POST', `/${r.id}/restore`, { idem: key(), body });
    expect(missing.statusCode).toBe(428);
    expect(ErrorBody.parse(missing.json()).code).toBe('precondition_required');
    for (const bad of ['W/"1"', '*', '1', '"1", "2"']) {
      const res = await api('POST', `/${r.id}/restore`, { ifMatch: bad, idem: key(), body });
      expect(res.statusCode).toBe(400);
    }
    const noKey = await api('POST', `/${r.id}/restore`, { ifMatch: r.revision, body });
    expect(noKey.statusCode).toBe(400);
    expect(ErrorBody.parse(noKey.json()).code).toBe('idempotency_key_required');
    expect((await service.listVersions(actorA(), r.id)).items).toHaveLength(1);
  });

  it('FR-30/31: another household’s version id cannot be restored into my recipe (404)', async () => {
    const mine = await createViaService('Oma');
    const { recipe: theirs } = await service.createRecipe(actorB(), key(), {
      title: 'Heidän',
      content: soupContent('1'),
    });
    const res = await api('POST', `/${mine.id}/restore`, {
      ifMatch: mine.revision,
      idem: key(),
      body: { versionId: theirs.currentVersion.id },
    });
    expect(res.statusCode).toBe(404);
    expect((await service.listVersions(actorA(), mine.id)).items).toHaveLength(1);
  });
});

describe('DB §5.1 + ADR-018: recipe_versions immutability, as the app role', () => {
  // Two layers: a row trigger stops UPDATE (SQLSTATE 23000, the app role does hold UPDATE on the table),
  // and the app role lacks DELETE, TRUNCATE and ownership, so it can neither delete nor switch the
  // trigger off (42501). Only the owner/migrator role could, and the server never connects as it.
  const INTEGRITY = '23000';
  const INSUFFICIENT_PRIVILEGE = '42501';
  it.each([
    ['UPDATE', `UPDATE recipe_versions SET change_reason = 'x' WHERE id = $1`, true, INTEGRITY],
    ['DELETE', 'DELETE FROM recipe_versions WHERE id = $1', true, INSUFFICIENT_PRIVILEGE],
    ['TRUNCATE', 'TRUNCATE recipe_versions CASCADE', false, INSUFFICIENT_PRIVILEGE],
    [
      'DISABLE TRIGGER',
      'ALTER TABLE recipe_versions DISABLE TRIGGER recipe_versions_no_update_delete',
      false,
      INSUFFICIENT_PRIVILEGE,
    ],
    [
      'DROP TRIGGER',
      'DROP TRIGGER recipe_versions_no_update_delete ON recipe_versions',
      false,
      INSUFFICIENT_PRIVILEGE,
    ],
  ])('%s fails and the version is unchanged', async (_op, sql, takesId, code) => {
    const r = await createViaService('Muuttumaton');
    await expect(pool.query(sql, takesId ? [r.currentVersion.id] : [])).rejects.toMatchObject({
      code,
    });
    const v = await service.getVersion(actorA(), r.id, r.currentVersion.id);
    expect(v.version.changeReason).toBeNull();
    expect(v.content.ingredients[0]?.original_quantity_text).toBe('400 g');
    // ...and the protection is still in place afterwards.
    await expect(
      pool.query(`UPDATE recipe_versions SET change_reason = 'y' WHERE id = $1`, [
        r.currentVersion.id,
      ]),
    ).rejects.toMatchObject({ code: INTEGRITY });
  });
});
