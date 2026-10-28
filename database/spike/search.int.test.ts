import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fuzzySearchSql, SCHEMA, setupSql, strictSearchSql } from './search.sql';

const fixtures = join(import.meta.dirname, '../../tests/fixtures');
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the test drops and recreates schema spike_a02)');
const pool = new pg.Pool({ connectionString: databaseUrl });
afterAll(() => pool.end());

interface Ingredient {
  display_name: string;
  preparation_note: string | null;
}
interface RecipeFixture {
  title: string;
  tags: string[];
  general_notes: string | null;
  content: { ingredients: Ingredient[]; instructions: { text: string }[] };
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
interface Golden {
  corpus: Record<string, string>;
  cases: GoldenCase[];
}

const golden = JSON.parse(readFileSync(join(fixtures, 'search-golden.json'), 'utf8')) as Golden;

// Strict matches first, then fuzzy (typo) matches that the strict query did not return.
async function search(query: string): Promise<string[]> {
  const words = query.split(/\s+/).filter(Boolean);
  const strict = await pool.query<{ id: string }>(strictSearchSql, [words]);
  const fuzzy = await pool.query<{ id: string }>(fuzzySearchSql, [words]);
  const ids = strict.rows.map((r) => r.id);
  return ids.concat(fuzzy.rows.map((r) => r.id).filter((id) => !ids.includes(id)));
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

beforeAll(async () => {
  await pool.query(setupSql);
  for (const id of Object.keys(golden.corpus)) {
    const r = JSON.parse(
      readFileSync(join(fixtures, 'recipes', `${id}.json`), 'utf8'),
    ) as RecipeFixture;
    const ingredients = r.content.ingredients
      .map((i) => [i.display_name, i.preparation_note].filter(Boolean).join(' '))
      .concat(r.tags)
      .join('\n');
    const body = r.content.instructions
      .map((s) => s.text)
      .concat(r.general_notes ?? '')
      .join('\n');
    await pool.query(
      `INSERT INTO ${SCHEMA}.recipes (id, search_title, search_ingredients, search_body) VALUES ($1,$2,$3,$4)`,
      [id, r.title, ingredients, body],
    );
  }
});

describe('A02 search golden set (ADR-010; FR-02, FR-07, AC-02, AC-18)', () => {
  const results = new Map<string, string | null>();

  beforeAll(async () => {
    for (const c of golden.cases) results.set(c.id, judge(c, await search(c.query)));
  });

  it('reports pass rates and misses', () => {
    const lines: string[] = [];
    for (const strength of ['must', 'should', 'stretch'] as const) {
      const cs = golden.cases.filter((c) => c.strength === strength);
      const passed = cs.filter((c) => results.get(c.id) === null);
      lines.push(`${strength}: ${passed.length}/${cs.length}`);
      for (const c of cs) {
        const miss = results.get(c.id);
        if (miss) lines.push(`  MISS ${c.id} ("${c.query}"): ${miss}`);
      }
    }
    console.log(`A02 golden results\n${lines.join('\n')}`);
    expect(golden.cases.length).toBeGreaterThanOrEqual(30);
  });

  // Pins the known misses recorded in docs/adr/0010-addendum-search-spike.md; update both together.
  it('known non-must misses are exactly those in the addendum', () => {
    const misses = golden.cases
      .filter((c) => c.strength !== 'must' && results.get(c.id) !== null)
      .map((c) => c.id);
    expect(misses).toEqual(['notfound-pitsa']);
  });

  for (const c of golden.cases.filter((x) => x.strength === 'must')) {
    it(`${c.id}: "${c.query}" [${c.kind}]`, () => {
      expect(results.get(c.id)).toBeNull();
    });
  }
});
