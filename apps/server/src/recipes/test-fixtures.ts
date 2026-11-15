import { randomUUID } from 'node:crypto';
import type { RecipeContentV1 } from '@mise/contracts';

/** Valid schema-v1 content: a carrot soup with `carrotGrams` of carrot (original text kept verbatim). */
export function soupContent(carrotGrams = '400'): RecipeContentV1 {
  return {
    schema_version: 1,
    yield: { quantity: '4', unit: 'servings' },
    prep_minutes: 10,
    cook_minutes: 30,
    ingredient_groups: [],
    ingredients: [
      {
        id: randomUUID(),
        group_id: null,
        display_name: 'porkkana',
        normalized_key: 'porkkana',
        original_quantity_text: `${carrotGrams} g`,
        amount_min: carrotGrams,
        amount_max: carrotGrams,
        original_unit: 'g',
        canonical_unit_code: 'g',
        preparation_note: 'kuutioituna',
        scale_policy: 'linear',
        alternatives: [],
        uncertainties: [],
      },
    ],
    instructions: [{ id: randomUUID(), order: 1, text: 'Keitä porkkanat pehmeiksi.' }],
  };
}
