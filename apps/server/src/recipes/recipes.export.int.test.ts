// FR-32 (recipes part) against real PostgreSQL as the app role (shared test config, freshly migrated).
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HouseholdId, MemberId, RecipeExport } from '@mise/contracts';
import { buildApp } from '../app.js';
import { runExportRecipes, runLoadRecipes } from '../cli/recipe-tools-run.js';
import { createPool } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import { createRecipesService, parseLoadDocument, registerRecipeRoutes } from './index.js';
import type { RecipeActor } from './index.js';
import { soupContent } from './test-fixtures.js';

const dbUrl = loadTestDatabaseConfig().appUrl;
const pool = createPool(dbUrl, 6);
const service = createRecipesService(pool);
const fixtureDir = new URL('../../../../tests/fixtures/recipes/', import.meta.url);
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
const loadable = fixtureFiles; // every fixture loads, including those without a yield

let h: TwoHouseholds;
let app: FastifyInstance;
const actor = (f: { householdId: string; memberId: string }): RecipeActor => ({
  householdId: HouseholdId.parse(f.householdId),
  memberId: MemberId.parse(f.memberId),
});

async function loadFixtures(a: RecipeActor) {
  const result: string[] = [];
  for (const f of loadable) {
    const doc = JSON.parse(readFileSync(new URL(f, fixtureDir), 'utf8')) as unknown;
    for (const entry of parseLoadDocument(doc)) result.push(await service.loadRecipe(a, entry));
  }
  return result;
}

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null });
  app.addHook('onRequest', async (request) => {
    const who = request.headers['x-test-actor'] === 'b' ? h.b : h.a;
    request.actor = {
      userId: who.userId,
      householdId: who.householdId,
      memberId: who.memberId,
      deviceSessionId: randomUUID(),
    } as unknown as RequestContext;
  });
  registerRecipeRoutes(app, service);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('recipe export and load (FR-32)', () => {
  it('FR-32: loads fixtures idempotently, exports JSON, reloads into a fresh household with equal content', async () => {
    const a = actor(h.a);
    const first = await loadFixtures(a);
    expect(first.every((r) => r === 'created')).toBe(true);
    expect((await loadFixtures(a)).every((r) => r === 'skipped')).toBe(true);

    // One recipe gets a second version, a changed tag list and gets archived.
    const list = await service.searchRecipes(a, { q: undefined, limit: 50 });
    expect(list.items).toHaveLength(loadable.length);
    const target = await service.getRecipe(a, list.items[0]!.id);
    const edited = { ...target.content, cook_minutes: 99 };
    const v2 = await service.patchRecipe(a, target.id, target.revision, {
      content: edited,
      changeReason: 'longer cook',
    });
    await service.patchRecipe(a, target.id, v2.revision, { archived: true, tags: ['vanha'] });

    const exported = await service.exportRecipes(a);
    expect(RecipeExport.safeParse(exported).success).toBe(true);
    expect(exported.recipes).toHaveLength(loadable.length);
    const ex = exported.recipes.find((r) => r.id === target.id)!;
    expect(ex.archived).toBe(true);
    expect(ex.versions.map((v) => v.version_no)).toEqual([1, 2]);
    expect(ex.current_version_id).toBe(ex.versions[1]!.id);

    // Round trip through a file and the CLI loader into the other household.
    const dir = await mkdtemp(join(tmpdir(), 'mise-export-'));
    const file = join(dir, 'export.json');
    await writeFile(file, JSON.stringify(exported));
    const out: string[] = [];
    const err: string[] = [];
    const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
    const b = actor(h.b);
    const args = ['--household', b.householdId, '--member', b.memberId, file];
    expect(await runLoadRecipes(args, { DATABASE_URL: dbUrl }, io)).toBe(0);
    expect(out.at(-1)).toBe(`loaded ${loadable.length} recipe(s), skipped 0 existing`);
    expect(await runLoadRecipes(args, { DATABASE_URL: dbUrl }, io)).toBe(0);
    expect(out.at(-1)).toBe(`loaded 0 recipe(s), skipped ${loadable.length} existing`);

    const again = await service.exportRecipes(b);
    const strip = (e: RecipeExport) =>
      e.recipes
        .map((r) => ({
          title: r.title,
          tags: r.tags,
          notes: r.general_notes,
          url: r.source_url,
          archived: r.archived,
          versions: r.versions.map((v) => ({
            no: v.version_no,
            reason: v.change_reason,
            content: v.content,
          })),
        }))
        .sort((x, y) => x.title.localeCompare(y.title));
    expect(strip(again)).toEqual(strip(exported));
    expect(err).toEqual([]);
  });

  it('FR-32: export only contains the actor household (isolation)', async () => {
    const other = await createTwoHouseholds(pool);
    const o = actor(other.a);
    await service.createRecipe(o, randomUUID(), {
      title: 'Salainen keitto',
      content: soupContent(),
    });
    const mine = await service.exportRecipes(actor(h.a));
    const md = await service.exportRecipesMarkdown(actor(h.a));
    expect(mine.recipes.some((r) => r.title === 'Salainen keitto')).toBe(false);
    expect(md).not.toContain('Salainen keitto');
    expect((await service.exportRecipes(o)).recipes.map((r) => r.title)).toEqual([
      'Salainen keitto',
    ]);
  });

  it('FR-32: loader refuses a member of another household', async () => {
    const err: string[] = [];
    const io = { log: () => {}, error: (l: string) => err.push(l) };
    const code = await runLoadRecipes(
      [
        '--household',
        h.a.householdId,
        '--member',
        h.b.memberId,
        new URL('nopea-kanawokki.json', fixtureDir).pathname,
      ],
      { DATABASE_URL: dbUrl },
      io,
    );
    expect(code).toBe(1);
    expect(err).toEqual(['member not found']);
  });

  it('FR-32: seeding a directory loads every fixture and exits 0; owner is looked up within --household', async () => {
    const other = await createTwoHouseholds(pool);
    const err: string[] = [];
    const out: string[] = [];
    const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
    const code = await runLoadRecipes(
      ['--household', other.b.householdId, fixtureDir.pathname],
      { DATABASE_URL: dbUrl },
      io,
    );
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out).toContain(`loaded ${fixtureFiles.length} recipe(s), skipped 0 existing`);
    const owner = await pool.query<{ created_by_member_id: string }>(
      'SELECT DISTINCT created_by_member_id FROM recipes WHERE household_id = $1',
      [other.b.householdId],
    );
    expect(owner.rows.map((r) => r.created_by_member_id)).toEqual([other.b.memberId]);
  });

  it('FR-32: without --household or --member several households are ambiguous and listed', async () => {
    const err: string[] = [];
    const io = { log: () => {}, error: (l: string) => err.push(l) };
    const code = await runLoadRecipes([fixtureDir.pathname], { DATABASE_URL: dbUrl }, io);
    expect(code).toBe(1);
    expect(err[0]).toContain('pass --member');
    expect(err[0]).toContain(h.a.memberId);
  });

  it('FR-32: export CLI writes JSON and Markdown files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mise-cli-'));
    const io = { log: () => {}, error: () => {} };
    const env = { DATABASE_URL: dbUrl };
    const base = ['--household', h.a.householdId];
    expect(await runExportRecipes([...base, '--out', join(dir, 'e.json')], env, io)).toBe(0);
    expect(
      await runExportRecipes([...base, '--format', 'md', '--out', join(dir, 'e.md')], env, io),
    ).toBe(0);
    expect(
      RecipeExport.parse(JSON.parse(await readFile(join(dir, 'e.json'), 'utf8'))).recipes.length,
    ).toBeGreaterThan(0);
    expect(await readFile(join(dir, 'e.md'), 'utf8')).toContain('## Ingredients');
    expect(await runExportRecipes(['--household', 'nope'], env, io)).toBe(1);
  });

  it('FR-32: GET /recipes/export serves json and md and is not shadowed by /:id', async () => {
    const headers = { 'x-test-actor': 'a', origin: testConfig.publicOrigin };
    const json = await app.inject({ method: 'GET', url: '/api/v1/recipes/export', headers });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toContain('application/json');
    expect(RecipeExport.parse(json.json()).recipes.length).toBeGreaterThan(0);

    const md = await app.inject({
      method: 'GET',
      url: '/api/v1/recipes/export?format=md',
      headers,
    });
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.headers['content-disposition']).toBe('attachment; filename="recipes.md"');
    expect(json.headers['content-disposition']).toBe('attachment; filename="recipes.json"');
    expect(md.body).toMatch(/^# .+/);
    expect(md.body).toContain('## Instructions');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/recipes/export?format=xml',
      headers,
    });
    expect(bad.statusCode).toBe(400);
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/recipes/export',
      headers: { ...headers, 'x-test-actor': 'b' },
    });
    expect(other.statusCode).toBe(200);
  });
});
