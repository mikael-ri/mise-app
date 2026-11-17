import { describe, expect, it } from 'vitest';
import { rational } from '@mise/domain';
import { lineView, parseTarget, parseYield, stepTarget } from './scaling-view.js';
import { SALMON_LINES, salmonRecipe, uuid } from './recipe-fixtures.js';

const base = rational(4n);
const view = (id: number, target: bigint | ReturnType<typeof rational>) => {
  const line = SALMON_LINES.find((l) => l.id === uuid(id));
  if (line === undefined) throw new Error('fixture');
  return lineView(line, base, typeof target === 'bigint' ? rational(target) : target);
};

describe('servings converter view (FR-06, AC-14)', () => {
  it('AC-14: scales yield 4 to 3 servings, keeping the original unit', () => {
    expect(view(11, 3n)).toMatchObject({ quantityText: '450 g', rounded: false });
    expect(view(12, 3n).quantityText).toBe('600 g');
    expect(view(13, 3n).quantityText).toBe('1 ⅛ dl');
  });

  it('shows the original text verbatim at the saved yield', () => {
    expect(view(13, 4n).quantityText).toBe('1,5 dl');
    expect(view(14, 4n).quantityText).toBe('1-2 kpl');
  });

  it('keeps vague amounts and to-taste lines unchanged with their text', () => {
    expect(view(15, 8n).quantityText).toBe('maun mukaan');
    expect(view(15, 1n).quantityText).toBe('maun mukaan');
  });

  it('a range stays a range and is marked ~ when rounding changes it noticeably', () => {
    const v = view(14, 3n); // 1-2 kpl * 3/4 = 0.75-1.5, round to whole -> 1-2
    expect(v.quantityText).toBe('~1–2 kpl');
    expect(v.rounded).toBe(true);
  });

  it('parses targets (comma decimals, fractions) and steps in whole servings, min 1', () => {
    expect(parseTarget('2,5')).toEqual(rational(5n, 2n));
    expect(parseTarget('0')).toBeNull();
    expect(parseTarget('abc')).toBeNull();
    expect(stepTarget(rational(1n), -1)).toEqual(rational(1n));
    expect(stepTarget(rational(4n), 1)).toEqual(rational(5n));
    expect(parseYield(salmonRecipe().content.yield?.quantity ?? '')).toEqual(rational(4n));
  });
});
