// FR-02, FR-07, AC-02, AC-18 against real PostgreSQL: the A02 golden set through GET /recipes, plus filters.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HouseholdId, MemberId, RecipeList } from '@mise/contracts';
import type { RecipeContentV1 } from '@mise/contracts';
import { buildApp } from '../app.js';
import { CSRF_HEADER, createPool, issueCsrfToken } from '../platform/index.js';
import type { RequestContext } from '../platform/index.js';
import { createTwoHouseholds } from '../platform/isolation-harness.js';
import type { TwoHouseholds } from '../platform/isolation-harness.js';
import { loadTestDatabaseConfig, testConfig } from '../platform/test-support.js';
import { createRecipesService, registerRecipeRoutes } from './index.js';
import type { RecipeActor } from './index.js';
import { soupContent } from './test-fixtures.js';

const fixtures = join(import.meta.dirname, '../../../../tests/fixtures');
const pool = createPool(loadTestDatabaseConfig().appUrl, 6);
const service = createRecipesService(pool);
const deviceSessionId = randomUUID();

let h: TwoHouseholds;
let app: FastifyInstance;

const actor = (f: { householdId: string; memberId: string }): RecipeActor => ({
  householdId: HouseholdId.parse(f.householdId),
  memberId: MemberId.parse(f.memberId),
});

beforeAll(async () => {
  h = await createTwoHouseholds(pool);
  app = buildApp({ checkReady: async () => {}, config: testConfig, auth: null });
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

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function search(params: string, who: 'a' | 'b' = 'a'): Promise<RecipeList> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/recipes?${params}`,
    headers: {
      'x-test-actor': who,
      origin: testConfig.publicOrigin,
      [CSRF_HEADER]: issueCsrfToken(testConfig.csrfSecret, deviceSessionId),
    },
  });
  expect(res.statusCode).toBe(200);
  return RecipeList.parse(res.json());
}

const searchIds = async (params: string, who: 'a' | 'b' = 'a'): Promise<string[]> =>
  (await search(params, who)).items.map((i) => i.id);

// ---------------------------------------------------------------------------------------------
// Golden set (tests/fixtures/search-golden.json). Fixtures are A02 spike documents (loose ids), so
// they are adapted to valid schema-v1 content here.
// ---------------------------------------------------------------------------------------------
interface FixtureLine {
  id: string;
  group_id: string | null;
  display_name: string;
  original_quantity_text: string | null;
  amount_min: string | null;
  amount_max: string | null;
  original_unit: string | null;
  preparation_note: string | null;
  scale_policy: RecipeContentV1['ingredients'][number]['scale_policy'];
  alternatives: (string | RecipeContentV1['ingredients'][number]['alternatives'][number])[];
  uncertainties: string[];
}
interface Fixture {
  title: string;
  tags: string[];
  general_notes: string | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  content: {
    yield: RecipeContentV1['yield'] | null;
    ingredient_groups: { id: string; name: string; order: number }[];
    ingredients: FixtureLine[];
    instructions: { id: string; order: number; text: string }[];
  };
}
interface GoldenCase {
  id: string;
  query: string;
  kind: string;
  strength: 'must' | 'should' | 'stretch';
  expect?: string[];
  expectFirst?: string;
  expectFirstAny?: string[];
  expectEmpty?: boolean;
  mustNotMatch?: string[];
}
const golden = JSON.parse(readFileSync(join(fixtures, 'search-golden.json'), 'utf8')) as {
  corpus: Record<string, string>;
  cases: GoldenCase[];
};

function toContent(f: Fixture): RecipeContentV1 {
  const ids = new Map<string, string>();
  const uuid = (key: string): string => {
    const found = ids.get(key);
    if (found) return found;
    const id = randomUUID();
    ids.set(key, id);
    return id;
  };
  return {
    schema_version: 1,
    // Some spike fixtures have no yield; the contract requires one and search ignores it.
    yield: f.content.yield ?? { quantity: '1', unit: 'serving' },
    prep_minutes: f.prep_minutes ?? null,
    cook_minutes: f.cook_minutes ?? null,
    ingredient_groups: f.content.ingredient_groups.map((g) => ({ ...g, id: uuid(`g:${g.id}`) })),
    ingredients: f.content.ingredients.map((l) => ({
      ...l,
      id: uuid(`l:${l.id}`),
      group_id: l.group_id === null ? null : uuid(`g:${l.group_id}`),
      alternatives: l.alternatives.map((a) =>
        typeof a === 'string' ? { display_name: a, original_quantity_text: null } : a,
      ),
      normalized_key: null,
      canonical_unit_code: null,
    })),
    instructions: f.content.instructions.map((s) => ({ ...s, id: uuid(`s:${s.id}`) })),
  };
}

function judge(c: GoldenCase, ids: string[]): string | null {
  if (c.expectEmpty) return ids.length === 0 ? null : `expected empty, got ${ids.join(',')}`;
  const forbidden = (c.mustNotMatch ?? []).filter((e) => ids.includes(e));
  if (forbidden.length) return `must not match ${forbidden.join(',')}`;
  const missing = (c.expect ?? []).filter((e) => !ids.includes(e));
  if (missing.length) return `missing ${missing.join(',')}`;
  if (c.expectFirst && ids[0] !== c.expectFirst)
    return `first was ${ids[0]}, want ${c.expectFirst}`;
  if (c.expectFirstAny && !c.expectFirstAny.includes(ids[0] ?? ''))
    return `first was ${ids[0]}, want one of ${c.expectFirstAny.join(',')}`;
  return null;
}

describe('A10 golden set via GET /recipes (FR-02, FR-07, AC-02, AC-18)', () => {
  const idOfStem = new Map<string, string>();
  const stemOfId = new Map<string, string>();
  const verdicts = new Map<string, string | null>();

  beforeAll(async () => {
    for (const stem of Object.keys(golden.corpus)) {
      const f = JSON.parse(
        readFileSync(join(fixtures, 'recipes', `${stem}.json`), 'utf8'),
      ) as Fixture;
      const { recipe } = await service.createRecipe(actor(h.a), randomUUID(), {
        title: f.title,
        tags: f.tags,
        ...(f.general_notes ? { generalNotes: f.general_notes } : {}),
        content: toContent(f),
      });
      idOfStem.set(stem, recipe.id);
      stemOfId.set(recipe.id, stem);
    }
    for (const c of golden.cases) {
      const res = await search(`q=${encodeURIComponent(c.query)}&limit=50`);
      verdicts.set(
        c.id,
        judge(
          c,
          res.items.map((i) => stemOfId.get(i.id) ?? i.id),
        ),
      );
    }
  });

  it('AC-02: carrot finds the English recipes, not the Finnish porkkana ones', async () => {
    const ids = await searchIds('q=carrot&limit=50');
    const stems = ids.map((id) => stemOfId.get(id));
    expect(stems).toContain('en-carrot-ginger-soup');
    expect(stems.some((s) => s?.startsWith('en-'))).toBe(true);
    expect(stems).not.toContain('jauheliha-kaalipata');
  });

  it('AC-18: Finnish terms find Finnish recipes (inflected and compound)', async () => {
    for (const q of ['porkkanaa', 'jauheliha', 'sipuli']) {
      const stems = (await searchIds(`q=${q}&limit=50`)).map((id) => stemOfId.get(id));
      expect(stems.length, q).toBeGreaterThan(0);
      expect(
        stems.some((s) => s !== undefined && !s.startsWith('en-')),
        q,
      ).toBe(true);
    }
    // ä/ö stay distinct in primary search but ASCII typing still finds them via the fold tier.
    expect(await searchIds('q=kesakurpitsa')).toContain(idOfStem.get('ratatouille'));
  });

  // Pins the known misses recorded in docs/adr/0010-addendum-search-spike.md; update both together.
  it('known non-must misses are exactly those in the addendum', () => {
    const misses = golden.cases
      .filter((c) => c.strength !== 'must' && verdicts.get(c.id) !== null)
      .map((c) => c.id);
    expect(misses).toEqual(['notfound-pitsa']);
  });

  for (const c of golden.cases.filter((x) => x.strength === 'must')) {
    it(`${c.id}: "${c.query}" [${c.kind}]`, () => {
      expect(verdicts.get(c.id)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Filters, archive, pagination, isolation. Unique nonsense words keep these apart from the golden corpus.
// ---------------------------------------------------------------------------------------------
describe('A10 filters and scoping (FR-02, FR-07)', () => {
  const make = async (
    title: string,
    o: { tags?: string[]; prep?: number | null; cook?: number | null; who?: 'a' | 'b' } = {},
  ) => {
    const content: RecipeContentV1 = {
      ...soupContent(),
      prep_minutes: o.prep === undefined ? 10 : o.prep,
      cook_minutes: o.cook === undefined ? 20 : o.cook,
    };
    const { recipe } = await service.createRecipe(actor(o.who === 'b' ? h.b : h.a), randomUUID(), {
      title,
      tags: o.tags ?? [],
      content,
    });
    return recipe;
  };

  it('excludes archived recipes by default and includes them on request', async () => {
    const r = await make('Zorvakeitto arkisto');
    await service.patchRecipe(actor(h.a), r.id, r.revision, { archived: true });
    expect(await searchIds('q=zorvakeitto')).not.toContain(r.id);
    expect(await searchIds('q=zorvakeitto&includeArchived=true')).toContain(r.id);
    expect(await searchIds('')).not.toContain(r.id);
  });

  it('never returns another household’s recipes', async () => {
    const b = await make('Quuxpata talouskaksi', { who: 'b' });
    expect(await searchIds('q=quuxpata', 'a')).not.toContain(b.id);
    expect(await searchIds('q=quuxpata', 'b')).toContain(b.id);
    expect(await searchIds('', 'a')).not.toContain(b.id);
  });

  it('filters by tags (all must be present) and combines with q', async () => {
    const both = await make('Tagitesti molemmat', { tags: ['wibble', 'wobble'] });
    const one = await make('Tagitesti yksi', { tags: ['wibble'] });
    expect(await searchIds('tags=wibble')).toEqual(expect.arrayContaining([both.id, one.id]));
    expect(await searchIds('tags=wibble&tags=wobble')).toEqual([both.id]);
    expect(await searchIds('tags=wibble&q=tagitesti%20yksi')).toEqual([one.id]);
  });

  it('filters by maxTime on prep + cook of the current version', async () => {
    const quick = await make('Aikatesti nopea', { prep: 5, cook: 10 });
    const slow = await make('Aikatesti hidas', { prep: 30, cook: 60 });
    const unknown = await make('Aikatesti tuntematon', { prep: null, cook: null });
    const onlyPrep = await make('Aikatesti vainprep', { prep: 12, cook: null });
    expect(await searchIds('q=aikatesti&maxTime=15')).toEqual(
      expect.arrayContaining([quick.id, onlyPrep.id]),
    );
    const within15 = await searchIds('q=aikatesti&maxTime=15');
    expect(within15).not.toContain(slow.id);
    expect(within15).toContain(unknown.id); // no time data: included, not hidden
    expect(await searchIds('q=aikatesti&maxTime=90')).toContain(slow.id);
  });

  it('FR-02: summaries carry totalMinutes and yield of the current version', async () => {
    const find = async (q: string, id: string) =>
      (await search(`q=${encodeURIComponent(q)}&includeArchived=true`)).items.find(
        (i) => i.id === id,
      );
    const both = await make('Summatesti kumpikin', { prep: 10, cook: 25, tags: ['summatag'] });
    const prep = await make('Summatesti vainprep', { prep: 12, cook: null });
    const cook = await make('Summatesti vaincook', { prep: null, cook: 40 });
    const none = await make('Summatesti ei aikaa', { prep: null, cook: null });
    const fi = await make('Pähkinäpiirakka äänekäs', { prep: 0, cook: 0 });
    const arch = await make('Summatesti arkistoitu', { prep: 5, cook: 5 });
    await service.patchRecipe(actor(h.a), arch.id, arch.revision, { archived: true });
    expect((await find('summatesti', both.id))?.totalMinutes).toBe(35);
    expect((await find('summatesti', prep.id))?.totalMinutes).toBe(12);
    expect((await find('summatesti', cook.id))?.totalMinutes).toBe(40);
    expect((await find('summatesti', none.id))?.totalMinutes).toBeNull();
    expect((await find('summatesti', arch.id))?.totalMinutes).toBe(10);
    const fiHit = await find('pähkinäpiirakka', fi.id);
    expect(fiHit?.totalMinutes).toBe(0);
    expect(fiHit?.yield).toEqual({ quantity: '4', unit: 'servings' });
    // no-q (title listing) path returns the same fields
    const listed = (await search('tags=summatag')).items.find((i) => i.id === both.id);
    expect(listed?.totalMinutes).toBe(35);
    expect(listed?.yield).toEqual({ quantity: '4', unit: 'servings' });
  });

  it('FR-02: summary yield and time follow the new version after an edit', async () => {
    const r = await make('Summaversio', { prep: 90, cook: 90 });
    await service.patchRecipe(actor(h.a), r.id, r.revision, {
      content: {
        ...soupContent(),
        yield: { quantity: '3/2', unit: 'l' },
        prep_minutes: 5,
        cook_minutes: null,
      },
      changeReason: 'muutos',
    });
    const hit = (await search('q=summaversio')).items.find((i) => i.id === r.id);
    expect(hit?.totalMinutes).toBe(5);
    expect(hit?.yield).toEqual({ quantity: '3/2', unit: 'l' });
  });

  it('uses the new version’s time after an edit (current version only)', async () => {
    const r = await make('Versiotesti', { prep: 90, cook: 90 });
    expect(await searchIds('q=versiotesti&maxTime=20')).not.toContain(r.id);
    await service.patchRecipe(actor(h.a), r.id, r.revision, {
      content: { ...soupContent(), prep_minutes: 5, cook_minutes: 5 },
      changeReason: 'nopeampi',
    });
    expect(await searchIds('q=versiotesti&maxTime=20')).toContain(r.id);
  });

  it('paginates with limit/offset and nextOffset, ordered by title without q', async () => {
    for (const n of ['a', 'b', 'c', 'd', 'e']) await make(`Sivutus ${n}`, { tags: ['pagetag'] });
    const first = await search('tags=pagetag&limit=2');
    const second = await search('tags=pagetag&limit=2&offset=2');
    const third = await search('tags=pagetag&limit=2&offset=4');
    expect(first.items.map((i) => i.title)).toEqual(['Sivutus a', 'Sivutus b']);
    expect(first.nextOffset).toBe(2);
    expect(second.items.map((i) => i.title)).toEqual(['Sivutus c', 'Sivutus d']);
    expect(second.nextOffset).toBe(4);
    expect(third.items.map((i) => i.title)).toEqual(['Sivutus e']);
    expect(third.nextOffset).toBeNull();
  });

  it('title matches outrank ingredient matches (ranking)', async () => {
    const inTitle = await make('Kardemummapulla');
    const inIngredient = await make('Ihan eri nimi', { tags: ['kardemummapulla'] });
    const ids = await searchIds('q=kardemummapulla');
    expect(ids.indexOf(inTitle.id)).toBeLessThan(ids.indexOf(inIngredient.id));
  });

  it('treats % and _ in the query literally, not as LIKE wildcards', async () => {
    const all = (await search('limit=50')).items.length;
    expect(all).toBeGreaterThan(5);
    // As wildcards these would match every recipe; literally they match at most text containing them.
    for (const q of ['%25', '_']) {
      expect((await search(`q=${q}&limit=50`)).items.length, q).toBeLessThan(all);
    }
  });

  it('rejects queries with more than 8 words', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/recipes?q=${'a%20'.repeat(9)}a`,
      headers: { 'x-test-actor': 'a' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown parameters, including a client-supplied household id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/recipes?householdId=${h.b.householdId}`,
      headers: { 'x-test-actor': 'a' },
    });
    expect(res.statusCode).toBe(400);
  });
});
