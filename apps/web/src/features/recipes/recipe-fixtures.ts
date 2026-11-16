import { Recipe, RecipeList, RecipeVersion, RecipeVersionMeta } from '@mise/contracts';
import { ME } from '../../test/fixtures.js';

/** Valid v4 UUID from a small number. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const RECIPE_ID = uuid(100);
export const OTHER_MEMBER_ID = uuid(900);

type Line = Recipe['content']['ingredients'][number];

const line = (n: number, over: Partial<Line>): Line => ({
  id: uuid(n),
  group_id: null,
  display_name: 'x',
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

/** Uunilohi ja perunat: groups, a range, a vague amount, Finnish characters (AC-18). */
export const SALMON_LINES: Line[] = [
  line(11, {
    group_id: uuid(1),
    display_name: 'lohifilettä',
    original_quantity_text: '600 g',
    amount_min: '600',
    amount_max: '600',
    original_unit: 'g',
  }),
  line(12, {
    group_id: uuid(1),
    display_name: 'perunaa',
    preparation_note: 'kuorittuna',
    original_quantity_text: '800 g',
    amount_min: '800',
    amount_max: '800',
    original_unit: 'g',
  }),
  line(13, {
    group_id: uuid(2),
    display_name: 'ruokakermaa',
    original_quantity_text: '1,5 dl',
    amount_min: '1.5',
    amount_max: '1.5',
    original_unit: 'dl',
  }),
  line(14, {
    group_id: uuid(2),
    display_name: 'sitruunaa',
    original_quantity_text: '1-2 kpl',
    amount_min: '1',
    amount_max: '2',
    original_unit: 'kpl',
    scale_policy: 'round_to_whole',
  }),
  line(15, {
    group_id: uuid(2),
    display_name: 'suolaa',
    original_quantity_text: 'maun mukaan',
    scale_policy: 'to_taste',
  }),
];

export function salmonRecipe(over: Partial<Recipe> = {}): Recipe {
  return Recipe.parse({
    id: RECIPE_ID,
    title: 'Uunilohi ja perunat',
    description: null,
    tags: ['kala', 'arki'],
    generalNotes: 'Sopii myös taimenelle.',
    sourceType: 'manual',
    sourceUrl: 'https://example.fi/uunilohi',
    archivedAt: null,
    revision: 3,
    createdAt: '2026-10-20T16:40:00Z',
    updatedAt: '2026-10-27T16:12:00Z',
    currentVersion: versionMeta(3, ME.member.id, 'Vähensin kalaa'),
    content: {
      schema_version: 1,
      yield: { quantity: '4', unit: 'servings' },
      prep_minutes: 15,
      cook_minutes: 35,
      ingredient_groups: [
        { id: uuid(1), name: 'Kala', order: 1 },
        { id: uuid(2), name: 'Kastike', order: 2 },
      ],
      ingredients: SALMON_LINES,
      instructions: [
        { id: uuid(21), order: 1, text: 'Lämmitä uuni 200 asteeseen.' },
        { id: uuid(22), order: 2, text: 'Kuori ja viipaloi perunat.' },
      ],
    },
    ...over,
  });
}

export function versionMeta(versionNo: number, memberId: string, reason: string | null) {
  return RecipeVersionMeta.parse({
    id: uuid(300 + versionNo),
    versionNo,
    schemaVersion: 1,
    createdByMemberId: memberId,
    changeReason: reason,
    createdAt: `2026-10-${20 + versionNo}T16:12:00Z`,
  });
}

export function recipeVersion(versionNo: number, content: Recipe['content']) {
  return RecipeVersion.parse({ version: versionMeta(versionNo, OTHER_MEMBER_ID, null), content });
}

export function recipeList(
  items: Array<{ id: string; title: string; tags?: string[]; archived?: boolean }>,
  nextOffset: number | null = null,
) {
  return RecipeList.parse({
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      tags: i.tags ?? [],
      archivedAt: i.archived === true ? '2026-10-28T10:00:00Z' : null,
      revision: 1,
      updatedAt: '2026-10-27T16:12:00Z',
      totalMinutes: null,
      yield: null,
    })),
    nextOffset,
  });
}
