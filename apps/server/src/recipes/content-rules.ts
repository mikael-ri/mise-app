import { UNIT_TABLE, compare, parseRational } from '@mise/domain';
import type { RecipeContentV1 } from '@mise/contracts';
import { AppError } from '../platform/index.js';
import type { SearchProjection } from './repository.js';

// Rules the Zod schema cannot express (it has no rational maths and no unit table). Nothing here
// rewrites a quantity or unit: the content is stored exactly as given (FR-05, hard rule 3).

const UNIT_CODES: ReadonlySet<string> = new Set(UNIT_TABLE.map((u) => u.code));

interface Issue {
  path: string[];
  message: string;
}

export function contentIssues(content: RecipeContentV1): Issue[] {
  const issues: Issue[] = [];
  content.ingredients.forEach((line, i) => {
    const at = (field: string): string[] => ['content', 'ingredients', String(i), field];
    if (line.amount_min !== null && line.amount_max !== null) {
      const min = parseRational(line.amount_min);
      const max = parseRational(line.amount_max);
      if (min === null || max === null) {
        issues.push({ path: at('amount_min'), message: 'amount is not a number' });
      } else if (compare(min, max) > 0) {
        issues.push({ path: at('amount_max'), message: 'amount_max must not be below amount_min' });
      }
    }
    if (line.canonical_unit_code !== null && !UNIT_CODES.has(line.canonical_unit_code)) {
      issues.push({ path: at('canonical_unit_code'), message: 'unknown canonical unit code' });
    }
  });
  return issues;
}

/** Throws `validation_failed` (400) with path + message only, never the submitted values. */
export function assertContentValid(content: RecipeContentV1): void {
  const issues = contentIssues(content);
  if (issues.length > 0) {
    throw new AppError('validation_failed', 'recipe content is invalid', { issues });
  }
}

export interface SearchSource {
  title: string;
  description: string | null;
  tags: readonly string[];
  generalNotes: string | null;
  content: RecipeContentV1;
}

/** Flattened text for the `search_*` columns (ADR-010 addendum): title / ingredients / directions + notes. */
export function buildSearchProjection(s: SearchSource): SearchProjection {
  const ingredients = s.content.ingredients.flatMap((l) => [
    l.display_name,
    l.preparation_note,
    ...l.alternatives.map((a) => a.display_name),
  ]);
  const join = (parts: readonly (string | null)[]): string =>
    parts.filter((p): p is string => p !== null && p !== '').join(' ');
  return {
    title: s.title,
    ingredients: join([...ingredients, ...s.tags]),
    body: join([...s.content.instructions.map((i) => i.text), s.description, s.generalNotes]),
  };
}
