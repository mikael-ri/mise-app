import { describe, expect, it } from 'vitest';
import { AppError } from '../platform/index.js';
import { assertContentValid, buildSearchProjection, contentIssues } from './content-rules.js';
import { soupContent } from './test-fixtures.js';

const withLine = (patch: Record<string, unknown>) => {
  const c = soupContent();
  return { ...c, ingredients: [{ ...c.ingredients[0]!, ...patch }] };
};

describe('FR-05: service enforces the contract schema refinements', () => {
  const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const soup = soupContent();
  const line = soup.ingredients[0]!;
  it.each([
    ['unknown group_id', { ...soup, ingredients: [{ ...line, group_id: u(9) }] }],
    ['duplicate ingredient ids', { ...soup, ingredients: [line, { ...line }] }],
    [
      'duplicate group ids',
      {
        ...soup,
        ingredient_groups: [
          { id: u(1), name: 'A', order: 1 },
          { id: u(1), name: 'B', order: 2 },
        ],
      },
    ],
    [
      'duplicate step order',
      {
        ...soup,
        instructions: [
          { id: u(2), order: 1, text: 'a' },
          { id: u(3), order: 1, text: 'b' },
        ],
      },
    ],
    ['zero yield', { ...soup, yield: { quantity: '0', unit: 'servings' } }],
  ])('rejects %s without echoing values', (_name, content) => {
    expect(contentIssues(content).length).toBeGreaterThan(0);
    expect(() => assertContentValid(content)).toThrow(AppError);
  });

  it('accepts valid content', () => {
    expect(contentIssues(soup)).toEqual([]);
  });
});

describe('FR-05: ingredient content rules (schema v1)', () => {
  it.each([
    ['equal bounds', { amount_min: '1', amount_max: '1' }, 0],
    ['range', { amount_min: '1', amount_max: '2' }, 0],
    ['fraction below decimal', { amount_min: '1/3', amount_max: '0.5' }, 0],
    ['min above max', { amount_min: '3', amount_max: '2' }, 1],
    ['fraction above decimal', { amount_min: '1/2', amount_max: '0.3' }, 1],
  ])('%s', (_name, patch, issues) => {
    expect(contentIssues(withLine(patch))).toHaveLength(issues);
  });

  it.each([
    ['known code', 'rkl', 0],
    ['unknown code', 'bushel', 1],
    ['absent code (e.g. maun mukaan)', null, 0],
  ])('canonical unit: %s', (_name, code, issues) => {
    expect(contentIssues(withLine({ canonical_unit_code: code }))).toHaveLength(issues);
  });

  it('keeps vague amounts without numbers valid', () => {
    const c = withLine({
      original_quantity_text: 'maun mukaan',
      amount_min: null,
      amount_max: null,
      original_unit: null,
      canonical_unit_code: null,
      scale_policy: 'to_taste',
    });
    expect(() => assertContentValid(c)).not.toThrow();
  });

  it('throws validation_failed with paths only, never values', () => {
    try {
      assertContentValid(withLine({ amount_min: '3', amount_max: '2' }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('validation_failed');
      expect(JSON.stringify((err as AppError).details)).not.toContain('"3"');
    }
  });
});

describe('FR-01: search projection', () => {
  it('flattens title, ingredients (+ tags) and directions (+ notes)', () => {
    const p = buildSearchProjection({
      title: 'Keitto',
      description: 'Kuvaus',
      tags: ['arki'],
      generalNotes: 'Muistiinpano',
      content: soupContent(),
    });
    expect(p.title).toBe('Keitto');
    expect(p.ingredients).toBe('porkkana kuutioituna arki');
    expect(p.body).toBe('Keitä porkkanat pehmeiksi. Kuvaus Muistiinpano');
  });
});
