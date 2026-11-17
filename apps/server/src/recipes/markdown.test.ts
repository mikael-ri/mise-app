import { describe, expect, it } from 'vitest';
import { RecipeId, RecipeVersionId } from '@mise/contracts';
import type { RecipeContentV1, RecipeExportRecipe } from '@mise/contracts';
import { renderIngredient, renderRecipeMarkdown, renderRecipesMarkdown } from './markdown.js';

const rid = (n: number) => RecipeId.parse(U(n));
const vid = (n: number) => RecipeVersionId.parse(U(n));
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Line = RecipeContentV1['ingredients'][number];
const line = (over: Partial<Line>): Line => ({
  id: U(1),
  group_id: null,
  display_name: 'porkkana',
  normalized_key: null,
  original_quantity_text: null,
  amount_min: null,
  amount_max: null,
  original_unit: null,
  canonical_unit_code: null,
  preparation_note: null,
  scale_policy: 'linear',
  alternatives: [],
  uncertainties: [],
  ...over,
});

function recipe(over: Partial<RecipeExportRecipe> = {}, content: Partial<RecipeContentV1> = {}) {
  const base: RecipeContentV1 = {
    schema_version: 1,
    yield: { quantity: '4', unit: 'servings' },
    prep_minutes: 10,
    cook_minutes: null,
    ingredient_groups: [],
    ingredients: [],
    instructions: [],
    ...content,
  };
  return {
    id: rid(100),
    title: 'Keitto',
    description: null,
    tags: [],
    general_notes: null,
    source_type: 'manual',
    source_url: null,
    archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    current_version_id: vid(200),
    versions: [
      {
        id: vid(200),
        version_no: 1,
        schema_version: 1,
        change_reason: null,
        created_at: '2026-01-01T00:00:00.000Z',
        content: base,
      },
    ],
    ...over,
  } satisfies RecipeExportRecipe;
}

describe('renderIngredient (FR-32)', () => {
  it.each([
    [
      'original text kept verbatim',
      line({ original_quantity_text: '2-3 kpl' }),
      '- 2-3 kpl porkkana',
    ],
    [
      'text without amount',
      line({ original_quantity_text: 'maun mukaan', display_name: 'suola' }),
      '- maun mukaan suola',
    ],
    [
      'fallback to parsed range and unit',
      line({ amount_min: '1/2', amount_max: '2', original_unit: 'dl' }),
      '- 1/2-2 dl porkkana',
    ],
    [
      'fallback single amount',
      line({ amount_min: '1', amount_max: '1', original_unit: 'prk' }),
      '- 1 prk porkkana',
    ],
    ['no quantity at all', line({}), '- porkkana'],
    [
      'preparation note',
      line({ original_quantity_text: '1 kpl', preparation_note: 'raastettuna' }),
      '- 1 kpl porkkana, raastettuna',
    ],
    [
      'alternative',
      line({
        original_quantity_text: '1 kpl',
        alternatives: [{ display_name: 'lanttu', original_quantity_text: '1 kpl' }],
      }),
      '- 1 kpl porkkana (or 1 kpl lanttu)',
    ],
  ])('%s', (_name, l, expected) => {
    expect(renderIngredient(l)).toBe(expected);
  });
});

describe('renderRecipeMarkdown (FR-32)', () => {
  it('renders a full recipe readably', () => {
    const md = renderRecipeMarkdown(
      recipe(
        {
          tags: ['keitto', 'arki'],
          source_url: 'https://example.com/r',
          general_notes: 'Maistuu seuraavana päivänä.',
        },
        {
          cook_minutes: 30,
          ingredient_groups: [
            { id: U(2), name: 'Kastike', order: 2 },
            { id: U(3), name: 'Pohja', order: 1 },
          ],
          ingredients: [
            line({ id: U(11), original_quantity_text: '400 g' }),
            line({
              id: U(12),
              group_id: U(2),
              display_name: 'kerma',
              original_quantity_text: '2 dl',
            }),
            line({
              id: U(13),
              group_id: U(3),
              display_name: 'voi',
              original_quantity_text: '1 rkl',
            }),
          ],
          instructions: [
            { id: U(21), order: 2, text: 'Tarjoile.' },
            { id: U(22), order: 1, text: 'Keitä.\nSekoita.' },
          ],
        },
      ),
    );
    expect(md).toBe(
      [
        '# Keitto',
        '**Tags:** keitto, arki  \n**Yield:** 4 servings  \n**Time:** prep 10 min, cook 30 min  \n**Source:** https://example.com/r',
        '## Ingredients',
        '- 400 g porkkana',
        '### Pohja',
        '- 1 rkl voi',
        '### Kastike',
        '- 2 dl kerma',
        '## Instructions',
        '1. Keitä.\n   Sekoita.\n2. Tarjoile.',
        '## Notes',
        'Maistuu seuraavana päivänä.',
      ].join('\n\n'),
    );
  });

  it('marks archived recipes and omits empty sections', () => {
    const md = renderRecipeMarkdown(recipe({ archived: true }, { prep_minutes: null }));
    expect(md).toBe('# Keitto\n\n**Archived**  \n**Yield:** 4 servings');
  });

  it('uses the current version, not the newest-listed one', () => {
    const r = recipe();
    const old = {
      ...r.versions[0]!,
      id: vid(300),
      version_no: 2,
      content: { ...r.versions[0]!.content, yield: { quantity: '9', unit: 'x' } },
    };
    expect(renderRecipeMarkdown({ ...r, versions: [r.versions[0]!, old] })).toContain('4 servings');
  });
});

describe('renderRecipesMarkdown (FR-32)', () => {
  const wrap = (recipes: RecipeExportRecipe[]) =>
    ({ format_version: 1, exported_at: '2026-01-01T00:00:00.000Z', recipes }) as const;
  it('is empty for no recipes and separates recipes with a rule', () => {
    expect(renderRecipesMarkdown(wrap([]))).toBe('');
    const md = renderRecipesMarkdown(wrap([recipe({ title: 'A' }), recipe({ title: 'B' })]));
    expect(md).toMatch(/^# A\n[\s\S]*\n\n---\n\n# B\n[\s\S]*\n$/);
  });
});
