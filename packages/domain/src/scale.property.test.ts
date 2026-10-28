import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LineQuantity } from './quantity.js';
import { compare, equals, rational } from './rational.js';
import { scale } from './scale.js';

const positive = fc.bigInt({ min: 1n, max: 10_000n });
const ratio = fc.tuple(positive, positive).map(([n, d]) => rational(n, d));

const roundTrip = (
  quantity: LineQuantity,
  base: ReturnType<typeof rational>,
  target: ReturnType<typeof rational>,
) => {
  const there = scale({ quantity, scalePolicy: 'linear' }, base, target).quantity;
  return scale({ quantity: there, scalePolicy: 'linear' }, target, base).quantity;
};

describe('scale property (FR-06)', () => {
  it('linear: scaling by f then 1/f returns the original', () => {
    fc.assert(
      fc.property(ratio, ratio, ratio, ratio, (base, target, a, b) => {
        const exact: LineQuantity = { kind: 'exact', amount: a, unit: 'dl' };
        const [min, max] = compare(a, b) <= 0 ? [a, b] : [b, a];
        const range: LineQuantity = { kind: 'range', min, max, unit: 'kpl' };

        const e = roundTrip(exact, base, target);
        const r = roundTrip(range, base, target);
        expect(e.kind === 'exact' && equals(e.amount, a) && e.unit === 'dl').toBe(true);
        expect(
          r.kind === 'range' && equals(r.min, min) && equals(r.max, max) && r.unit === 'kpl',
        ).toBe(true);
      }),
    );
  });
});
