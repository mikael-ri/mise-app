import type { RecipeExport, RecipeExportRecipe, RecipeContentV1 } from '@mise/contracts';

// Pure Markdown rendering of an export (FR-32). Text is passed through verbatim: original quantity
// text and units are never reformatted or converted. Headings are deliberately English: this is an export file format, not UI text.

type Line = RecipeContentV1['ingredients'][number];

/** Original text wins; only when it is missing do the parsed amount and unit stand in for it. */
function quantity(l: Line): string {
  if (l.original_quantity_text !== null && l.original_quantity_text !== '') {
    return l.original_quantity_text;
  }
  const amount =
    l.amount_min === null
      ? ''
      : l.amount_max === null || l.amount_max === l.amount_min
        ? l.amount_min
        : `${l.amount_min}-${l.amount_max}`;
  return [amount, l.original_unit ?? ''].filter(Boolean).join(' ');
}

export function renderIngredient(l: Line): string {
  let text = [quantity(l), l.display_name].filter(Boolean).join(' ');
  if (l.preparation_note) text += `, ${l.preparation_note}`;
  for (const alt of l.alternatives) {
    text += ` (or ${[alt.original_quantity_text, alt.display_name].filter(Boolean).join(' ')})`;
  }
  return `- ${text}`;
}

const indentContinuation = (text: string): string => text.replace(/\r?\n/g, '\n   ');

function timeLine(c: RecipeContentV1): string | null {
  const parts: string[] = [];
  if (c.prep_minutes !== null) parts.push(`prep ${c.prep_minutes} min`);
  if (c.cook_minutes !== null) parts.push(`cook ${c.cook_minutes} min`);
  return parts.length === 0 ? null : `**Time:** ${parts.join(', ')}`;
}

export function renderRecipeMarkdown(recipe: RecipeExportRecipe): string {
  const current = recipe.versions.find((v) => v.id === recipe.current_version_id);
  if (!current) throw new Error('current version missing from export');
  const c = current.content;
  const out: string[] = [`# ${recipe.title}`];

  const meta: string[] = [];
  if (recipe.archived) meta.push('**Archived**');
  if (recipe.tags.length > 0) meta.push(`**Tags:** ${recipe.tags.join(', ')}`);
  if (c.yield !== null) meta.push(`**Yield:** ${c.yield.quantity} ${c.yield.unit}`);
  const time = timeLine(c);
  if (time) meta.push(time);
  if (recipe.source_url) meta.push(`**Source:** ${recipe.source_url}`);
  out.push(meta.join('  \n'));
  if (recipe.description) out.push(recipe.description);

  const groups = [...c.ingredient_groups].sort((a, b) => a.order - b.order);
  const sections: { name: string | null; lines: Line[] }[] = [
    { name: null, lines: c.ingredients.filter((l) => l.group_id === null) },
    ...groups.map((g) => ({
      name: g.name,
      lines: c.ingredients.filter((l) => l.group_id === g.id),
    })),
  ].filter((s) => s.lines.length > 0);
  if (sections.length > 0) {
    out.push('## Ingredients');
    for (const s of sections) {
      if (s.name !== null) out.push(`### ${s.name}`);
      out.push(s.lines.map(renderIngredient).join('\n'));
    }
  }

  const steps = [...c.instructions].sort((a, b) => a.order - b.order);
  if (steps.length > 0) {
    out.push('## Instructions');
    out.push(steps.map((s, i) => `${i + 1}. ${indentContinuation(s.text)}`).join('\n'));
  }

  if (recipe.general_notes) out.push('## Notes', recipe.general_notes);
  return out.join('\n\n');
}

export function renderRecipesMarkdown(exported: RecipeExport): string {
  if (exported.recipes.length === 0) return '';
  return `${exported.recipes.map(renderRecipeMarkdown).join('\n\n---\n\n')}\n`;
}
