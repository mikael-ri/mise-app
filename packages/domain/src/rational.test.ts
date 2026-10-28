import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  div,
  equals,
  mul,
  parseRational,
  rational,
  roundHalfUp,
  sub,
  toDecimalString,
} from './rational.js';

const p = (s: string) => {
  const r = parseRational(s);
  if (!r) throw new Error(`unparseable ${s}`);
  return r;
};

describe('parseRational (FR-05)', () => {
  it.each([
    ['3', '3'],
    ['1.5', '1.5'],
    ['1,5', '1.5'],
    ['0,25', '0.25'],
    ['1/2', '0.5'],
    ['1 1/2', '1.5'],
    ['2 3/4', '2.75'],
    [' 1 / 3 ', '0.333333'],
  ])('parses %s', (input, dec) => {
    expect(toDecimalString(p(input))).toBe(dec);
  });

  it.each(['', 'abc', '1/0', '1 1/0', 'maun mukaan', '1-2', '-1', '1.2.3'])(
    'rejects %j',
    (input) => {
      expect(parseRational(input)).toBeNull();
    },
  );

  it('is exact where floats are not (0.1 + 0.2 = 0.3)', () => {
    expect(equals(add(p('0.1'), p('0.2')), p('0.3'))).toBe(true);
  });
});

describe('arithmetic', () => {
  it('reduces and normalises sign', () => {
    expect(rational(2n, -4n)).toEqual({ n: -1n, d: 2n });
  });
  it.each([
    ['add', add(p('1/3'), p('1/6')), '1/2'],
    ['sub', sub(p('1'), p('1/4')), '3/4'],
    ['mul', mul(p('2/3'), p('3/4')), '1/2'],
    ['div', div(p('1'), p('3')), '1/3'],
  ])('%s', (_n, got, want) => {
    expect(equals(got, p(want))).toBe(true);
  });
  it('compares', () => {
    expect(compare(p('1/3'), p('1/2'))).toBe(-1);
    expect(compare(p('2/4'), p('1/2'))).toBe(0);
    expect(compare(p('3'), p('2.5'))).toBe(1);
  });
  it('divides by zero -> RangeError', () => {
    expect(() => div(p('1'), p('0'))).toThrow(RangeError);
  });
  it.each([
    ['1.5', 2n],
    ['2.5', 3n],
    ['2.49', 2n],
    ['0.4', 0n],
  ])('roundHalfUp %s', (s, want) => {
    expect(roundHalfUp(p(s))).toBe(want);
  });
  it('toDecimalString rounds and trims', () => {
    expect(toDecimalString(p('2/3'), 2)).toBe('0.67');
    expect(toDecimalString(p('5'), 2)).toBe('5');
    expect(toDecimalString(rational(-1n, 2n), 2)).toBe('-0.5');
  });
});
