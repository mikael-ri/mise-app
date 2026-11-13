import { describe, expect, it } from 'vitest';
import {
  CreateRecipeRequest,
  PatchRecipeRequest,
  RecipeContentV1,
  RecipeSearchQuery,
} from './recipes.js';

const G1 = '00000000-0000-4000-8000-000000000001';
const L1 = '00000000-0000-4000-8000-000000000011';
const L2 = '00000000-0000-4000-8000-000000000012';
const S1 = '00000000-0000-4000-8000-000000000021';
const S2 = '00000000-0000-4000-8000-000000000022';

const line = (over: Record<string, unknown> = {}) => ({
  id: L1,
  group_id: G1,
  display_name: 'tomaattimurska',
  normalized_key: 'tomaattimurska',
  original_quantity_text: '1 prk',
  amount_min: '1',
  amount_max: '1',
  original_unit: 'prk',
  canonical_unit_code: 'package',
  preparation_note: null,
  scale_policy: 'linear',
  alternatives: [],
  uncertainties: ['Package mass not specified'],
  ...over,
});

const content = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  yield: { quantity: '4', unit: 'annosta' },
  prep_minutes: 10,
  cook_minutes: null,
  ingredient_groups: [{ id: G1, name: 'Kastike', order: 1 }],
  ingredients: [line()],
  instructions: [{ id: S1, order: 1, text: 'Kuumenna.' }],
  ...over,
});

describe('RecipeContentV1 (FR-01, FR-05)', () => {
  it('accepts the DB §5.2 shape and preserves original text and units verbatim', () => {
    const parsed = RecipeContentV1.parse(content());
    expect(parsed.ingredients[0]).toMatchObject({
      original_quantity_text: '1 prk',
      original_unit: 'prk',
    });
  });

  it.each([
    [
      'vague amount without numbers (maun mukaan)',
      content({
        ingredients: [
          line({
            original_quantity_text: 'maun mukaan',
            amount_min: null,
            amount_max: null,
            original_unit: null,
            canonical_unit_code: null,
            scale_policy: 'to_taste',
          }),
        ],
      }),
    ],
    [
      'range',
      content({
        ingredients: [
          line({ original_quantity_text: '1-2 prk', amount_min: '1', amount_max: '2' }),
        ],
      }),
    ],
    [
      'exact fraction',
      content({
        ingredients: [
          line({ original_quantity_text: '1/3 dl', amount_min: '1/3', amount_max: null }),
        ],
      }),
    ],
    ['decimal yield', content({ yield: { quantity: '2.5', unit: 'dl' } })],
    ['ungrouped line', content({ ingredients: [line({ group_id: null })] })],
    ['empty recipe body', content({ ingredient_groups: [], ingredients: [], instructions: [] })],
  ])('accepts %s', (_name, value) => {
    expect(RecipeContentV1.safeParse(value).success).toBe(true);
  });

  it.each([
    ['schema_version 2', content({ schema_version: 2 })],
    [
      'missing schema_version',
      (() => {
        const value: Record<string, unknown> = content();
        delete value['schema_version'];
        return value;
      })(),
    ],
    [
      'amount as a JS number (no floats, hard rule 3)',
      content({ ingredients: [line({ amount_min: 0.5 })] }),
    ],
    ['negative amount', content({ ingredients: [line({ amount_min: '-1' })] })],
    ['amount with comma decimal', content({ ingredients: [line({ amount_min: '1,5' })] })],
    ['division by zero fraction', content({ ingredients: [line({ amount_min: '1/0' })] })],
    [
      'amount_max without amount_min',
      content({ ingredients: [line({ amount_min: null, amount_max: '2' })] }),
    ],
    ['duplicate line ids', content({ ingredients: [line(), line()] })],
    ['unknown group_id', content({ ingredients: [line({ group_id: L2 })] })],
    [
      'duplicate instruction order',
      content({
        instructions: [
          { id: S1, order: 1, text: 'a' },
          { id: S2, order: 1, text: 'b' },
        ],
      }),
    ],
    ['zero yield', content({ yield: { quantity: '0', unit: 'annosta' } })],
    ['unknown scale policy', content({ ingredients: [line({ scale_policy: 'double' })] })],
    [
      'normalized key not lowercased',
      content({ ingredients: [line({ normalized_key: 'Tomaatti' })] }),
    ],
    ['unknown top-level key', content({ servings: 4 })],
    ['non-uuid line id', content({ ingredients: [line({ id: 'line-1' })] })],
  ])('rejects %s', (_name, value) => {
    expect(RecipeContentV1.safeParse(value).success).toBe(false);
  });
});

describe('CreateRecipeRequest / PatchRecipeRequest (FR-01, FR-03)', () => {
  it('accepts a minimal create', () => {
    expect(
      CreateRecipeRequest.safeParse({ title: 'Makaronilaatikko', content: content() }).success,
    ).toBe(true);
  });

  it.each([
    [
      'client-supplied householdId (hard rule 2)',
      { title: 'x', content: content(), householdId: G1 },
    ],
    ['non-http source URL', { title: 'x', content: content(), sourceUrl: 'file:///etc/passwd' }],
    ['blank title', { title: '   ', content: content() }],
    ['duplicate tags', { title: 'x', content: content(), tags: ['a', 'a'] }],
  ])('create rejects %s', (_name, value) => {
    expect(CreateRecipeRequest.safeParse(value).success).toBe(false);
  });

  it.each([
    ['metadata only (no version)', { tags: ['arki'] }, true],
    ['archive', { archived: true }, true],
    ['content with reason', { content: content(), changeReason: 'Less salt' }, true],
    ['empty patch', {}, false],
    ['changeReason alone', { changeReason: 'x' }, false],
    ['changeReason without content', { title: 'x', changeReason: 'x' }, false],
  ])('patch: %s', (_name, value, ok) => {
    expect(PatchRecipeRequest.safeParse(value).success).toBe(ok);
  });
});

describe('RecipeSearchQuery (FR-02, FR-07)', () => {
  it('coerces query-string values', () => {
    expect(
      RecipeSearchQuery.parse({
        q: 'porkkana',
        includeArchived: 'true',
        limit: '5',
        tag: ['a', 'b'],
      }),
    ).toEqual({
      q: 'porkkana',
      includeArchived: true,
      limit: 5,
      tag: ['a', 'b'],
    });
  });

  it.each([
    { limit: '0' },
    { limit: '51' },
    { includeArchived: 'yes' },
    { q: '' },
    { householdId: G1 },
  ])('rejects %o', (value) => {
    expect(RecipeSearchQuery.safeParse(value).success).toBe(false);
  });
});
