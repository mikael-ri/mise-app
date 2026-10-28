import { describe, expect, it } from 'vitest';
import { formatQuantity, formatRational } from './format.js';
import { parseRational, type Rational } from './rational.js';

const p = (s: string): Rational => {
  const r = parseRational(s);
  if (!r) throw new Error(`bad ${s}`);
  return r;
};

describe('formatRational (FR-06)', () => {
  it.each([
    ['0', '0'],
    ['2', '2'],
    ['1/2', '½'],
    ['1/3', '⅓'],
    ['2/3', '⅔'],
    ['3/4', '¾'],
    ['1 1/2', '1 ½'],
    ['2 1/4', '2 ¼'],
    ['1 1/8', '1 ⅛'],
    ['0.25', '¼'],
    ['1/5', '0,2'],
    ['2 1/7', '2,14'],
    ['1/1000', '0,001'],
  ])('%s -> %s', (input, want) => {
    expect(formatRational(p(input))).toBe(want);
  });
  it('supports dot decimals', () => {
    expect(formatRational(p('1/5'), { decimalSeparator: '.' })).toBe('0.2');
  });
});

describe('formatQuantity (FR-05, FR-06)', () => {
  it('formats exact, range and vague amounts', () => {
    expect(formatQuantity({ kind: 'exact', amount: p('600'), unit: 'g' })).toBe('600 g');
    expect(formatQuantity({ kind: 'range', min: p('1'), max: p('2'), unit: 'kpl' })).toBe(
      '1–2 kpl',
    );
    expect(formatQuantity({ kind: 'range', min: p('1/2'), max: p('1 1/2'), unit: 'rkl' })).toBe(
      '½–1 ½ rkl',
    );
    expect(formatQuantity({ kind: 'range', min: p('2'), max: p('2'), unit: 'kpl' })).toBe('2 kpl');
    expect(formatQuantity({ kind: 'exact', amount: p('3'), unit: null })).toBe('3');
    expect(formatQuantity({ kind: 'vague', text: 'maun mukaan' })).toBe('maun mukaan');
  });
});
