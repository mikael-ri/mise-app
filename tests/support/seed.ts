// Test data for the recipe specs, created through the real API as a member.
import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateRecipeRequest, Recipe } from '../../packages/contracts/src/index.js';
import type { MemberApi } from './api.js';

/** Short unique token so specs sharing one database can find their own data by title. */
export const runToken = (): string =>
  Array.from(randomBytes(10), (b) => String.fromCharCode(97 + (b % 26))).join('');

type Content = CreateRecipeRequest['content'];

/** Uunilohi: groups, a range, a vague amount, Finnish characters (AC-18). Fresh ids on every call. */
export function salmonContent(grams = '600'): Content {
  const g1 = randomUUID();
  const g2 = randomUUID();
  const base = {
    group_id: null,
    normalized_key: null,
    original_quantity_text: null,
    amount_min: null,
    amount_max: null,
    original_unit: null,
    canonical_unit_code: null,
    preparation_note: null,
    scale_policy: 'linear' as const,
    alternatives: [],
    uncertainties: [],
  };
  return {
    schema_version: 1,
    yield: { quantity: '4', unit: 'servings' },
    prep_minutes: 15,
    cook_minutes: 35,
    ingredient_groups: [
      { id: g1, name: 'Kala', order: 1 },
      { id: g2, name: 'Kastike', order: 2 },
    ],
    ingredients: [
      {
        ...base,
        id: randomUUID(),
        group_id: g1,
        display_name: 'lohifilettä',
        original_quantity_text: `${grams} g`,
        amount_min: grams,
        amount_max: grams,
        original_unit: 'g',
      },
      {
        ...base,
        id: randomUUID(),
        group_id: g1,
        display_name: 'perunaa',
        preparation_note: 'kuorittuna',
        original_quantity_text: '800 g',
        amount_min: '800',
        amount_max: '800',
        original_unit: 'g',
      },
      {
        ...base,
        id: randomUUID(),
        group_id: g2,
        display_name: 'ruokakermaa',
        original_quantity_text: '1,5 dl',
        amount_min: '1.5',
        amount_max: '1.5',
        original_unit: 'dl',
      },
      {
        ...base,
        id: randomUUID(),
        group_id: g2,
        display_name: 'sitruunaa',
        original_quantity_text: '1-2 kpl',
        amount_min: '1',
        amount_max: '2',
        original_unit: 'kpl',
        scale_policy: 'round_to_whole' as const,
      },
      {
        ...base,
        id: randomUUID(),
        group_id: g2,
        display_name: 'suolaa',
        original_quantity_text: 'maun mukaan',
        scale_policy: 'to_taste' as const,
      },
    ],
    instructions: [
      { id: randomUUID(), order: 1, text: 'Lämmitä uuni 200 asteeseen.' },
      { id: randomUUID(), order: 2, text: 'Kuori ja viipaloi perunat.' },
    ],
  };
}

export function simpleContent(ingredient: string): Content {
  const [line] = salmonContent().ingredients;
  return {
    ...salmonContent(),
    ingredient_groups: [],
    ingredients: [
      {
        ...line!,
        group_id: null,
        display_name: ingredient,
        original_quantity_text: '2 dl',
        amount_min: '2',
        amount_max: '2',
        original_unit: 'dl',
      },
    ],
    instructions: [],
  };
}

export async function seedRecipe(
  api: MemberApi,
  title: string,
  over: Partial<CreateRecipeRequest> = {},
): Promise<Recipe> {
  return api.createRecipe({ title, tags: ['kala', 'arki'], content: salmonContent(), ...over });
}

/** A recipe with versions v1 (800 g), v2 (700 g) and v3 (600 g, current, "Vähensin kalaa"). */
export async function seedRecipeWithHistory(api: MemberApi, title: string): Promise<Recipe> {
  let recipe = await seedRecipe(api, title, { content: salmonContent('800') });
  recipe = await api.patchRecipe(recipe, {
    content: salmonContent('700'),
    changeReason: 'Vähemmän kalaa',
  });
  recipe = await api.patchRecipe(recipe, {
    content: salmonContent('600'),
    changeReason: 'Vähensin kalaa',
  });
  return recipe;
}
