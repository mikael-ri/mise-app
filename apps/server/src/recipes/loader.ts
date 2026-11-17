import { createHash } from 'node:crypto';
import {
  RECIPE_CONTENT_SCHEMA_VERSION,
  RecipeContent,
  RecipeExport,
  RecipeLoadFile,
} from '@mise/contracts';
import type { RecipeContentV1 } from '@mise/contracts';

// Pure conversion of loader input files into one neutral shape (an ops tool, not the importer).

export interface LoadEntry {
  title: string;
  description: string | null;
  tags: string[];
  generalNotes: string | null;
  sourceUrl: string | null;
  archived: boolean;
  /** Oldest first. A fixture file has one; an export file brings its whole history. */
  versions: { content: RecipeContentV1; changeReason: string | null }[];
}

/** Deterministic UUID (v5-shaped) so reloading the same file yields the same line ids. */
function stableUuid(...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function fixtureToEntry(file: RecipeLoadFile): LoadEntry {
  const id = (kind: string, label: string) => stableUuid(file.title, kind, label);
  const c = file.content;
  const content: RecipeContentV1 = RecipeContent.parse({
    schema_version: RECIPE_CONTENT_SCHEMA_VERSION,
    yield: c.yield,
    prep_minutes: file.prep_minutes,
    cook_minutes: file.cook_minutes,
    ingredient_groups: c.ingredient_groups.map((g) => ({ ...g, id: id('group', g.id) })),
    ingredients: c.ingredients.map((l) => ({
      id: id('line', l.id),
      group_id: l.group_id === null ? null : id('group', l.group_id),
      display_name: l.display_name,
      normalized_key: l.normalized_key ?? null,
      original_quantity_text: l.original_quantity_text,
      amount_min: l.amount_min,
      amount_max: l.amount_max,
      original_unit: l.original_unit,
      canonical_unit_code: l.canonical_unit_code ?? null,
      preparation_note: l.preparation_note ?? null,
      scale_policy: l.scale_policy,
      alternatives: (l.alternatives ?? []).map((display_name) => ({
        display_name,
        original_quantity_text: null,
      })),
      uncertainties: l.uncertainties ?? [],
    })),
    instructions: c.instructions.map((s) => ({ ...s, id: id('step', s.id) })),
  });
  return {
    title: file.title,
    description: null,
    tags: file.tags,
    generalNotes: file.general_notes,
    sourceUrl: file.source_url,
    archived: false,
    versions: [{ content, changeReason: null }],
  };
}

/** Accepts a fixture-format recipe file or a `RecipeExport` envelope (round trip). Throws ZodError. */
export function parseLoadDocument(json: unknown): LoadEntry[] {
  if (typeof json === 'object' && json !== null && 'format_version' in json) {
    return RecipeExport.parse(json).recipes.map((r) => ({
      title: r.title,
      description: r.description,
      tags: r.tags,
      generalNotes: r.general_notes,
      sourceUrl: r.source_url,
      archived: r.archived,
      versions: r.versions.map((v) => ({ content: v.content, changeReason: v.change_reason })),
    }));
  }
  return [fixtureToEntry(RecipeLoadFile.parse(json))];
}
