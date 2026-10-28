import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LineQuantity } from './quantity.js';
import { parseRational, rational, toDecimalString, type Rational } from './rational.js';
import { scale, type ScalePolicy } from './scale.js';
import { formatQuantity } from './format.js';

const p = (s: string): Rational => {
  const r = parseRational(s);
  if (!r) throw new Error(`bad ${s}`);
  return r;
};

interface QtyJson {
  qty?: string;
  min?: string;
  max?: string;
  unit?: string | undefined;
  text?: string;
}
interface Case {
  name: string;
  policy: ScalePolicy;
  in: QtyJson;
  baseYield: string;
  targetYield: string;
  out: QtyJson;
  warning?: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/units.json', import.meta.url), 'utf8'),
) as { scaleCases: Case[] };

const toQuantity = (j: QtyJson): LineQuantity => {
  if (j.text !== undefined) return { kind: 'vague', text: j.text };
  if (j.qty !== undefined) return { kind: 'exact', amount: p(j.qty), unit: j.unit ?? null };
  return { kind: 'range', min: p(j.min ?? '0'), max: p(j.max ?? '0'), unit: j.unit ?? null };
};
const toJson = (q: LineQuantity): QtyJson => {
  if (q.kind === 'vague') return { text: q.text };
  if (q.kind === 'exact') return { qty: toDecimalString(q.amount), unit: q.unit ?? undefined };
  return { min: toDecimalString(q.min), max: toDecimalString(q.max), unit: q.unit ?? undefined };
};

describe('scale (FR-06, AC-14)', () => {
  it.each(fixture.scaleCases)('$name', (c) => {
    const res = scale(
      { quantity: toQuantity(c.in), scalePolicy: c.policy },
      p(c.baseYield),
      p(c.targetYield),
    );
    expect(toJson(res.quantity)).toEqual(c.out);
    expect(res.warnings.map((w) => w.code)).toEqual(c.warning ? [c.warning] : []);
  });

  it('AC-14: yield 4 -> 3 scales without touching the input', () => {
    const input = {
      quantity: toQuantity({ qty: '600', unit: 'g' }),
      scalePolicy: 'linear',
    } as const;
    const res = scale(input, p('4'), p('3'));
    expect(formatQuantity(res.quantity)).toBe('450 g');
    expect(formatQuantity(input.quantity)).toBe('600 g');
  });

  it('uunilohi: 1,5 dl kermaa 4 -> 3 shows 1 ⅛ dl', () => {
    const res = scale(
      { quantity: toQuantity({ qty: '1,5', unit: 'dl' }), scalePolicy: 'linear' },
      p('4'),
      p('3'),
    );
    expect(formatQuantity(res.quantity)).toBe('1 ⅛ dl');
  });

  it('does not convert units while scaling (keeps rkl)', () => {
    const res = scale(
      { quantity: toQuantity({ qty: '4', unit: 'rkl' }), scalePolicy: 'linear' },
      p('4'),
      p('8'),
    );
    expect(res.quantity).toMatchObject({ unit: 'rkl' });
  });

  it.each([
    ['0', '4'],
    ['4', '0'],
    ['-1', '4'],
  ])('rejects non-positive yields base=%s target=%s', (b, t) => {
    const line = {
      quantity: toQuantity({ qty: '1', unit: 'kpl' }),
      scalePolicy: 'linear',
    } as const;
    expect(() => scale(line, rational(BigInt(b)), rational(BigInt(t)))).toThrow(RangeError);
  });
});

describe('scale round_to_whole ranges (FR-06)', () => {
  const lemon = (min: string, max: string) => ({
    quantity: toQuantity({ min, max, unit: 'kpl' }),
    scalePolicy: 'round_to_whole' as const,
  });

  it('range scaled down collapses to min == max, stays a range, one warning per endpoint', () => {
    const res = scale(lemon('1', '2'), p('4'), p('1'));
    expect(res.quantity).toMatchObject({ kind: 'range', unit: 'kpl' });
    expect(toJson(res.quantity)).toEqual({ min: '1', max: '1', unit: 'kpl' });
    expect(res.warnings).toHaveLength(2);
  });

  it('range that rounds without material change collapses silently', () => {
    const res = scale(lemon('10', '11'), p('4'), p('4'));
    expect(toJson(res.quantity)).toEqual({ min: '10', max: '11', unit: 'kpl' });
    expect(res.warnings).toHaveLength(0);
  });
});

interface RecipeLine {
  id: string;
  display_name: string;
  original_quantity_text: string;
  amount_min: string | null;
  amount_max: string | null;
  original_unit: string | null;
  scale_policy: ScalePolicy;
}
const recipe = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/recipes/uunilohi-ja-perunat.json', import.meta.url),
    'utf8',
  ),
) as { content: { yield: { quantity: string }; ingredients: RecipeLine[] } };

describe('AC-14: preview-scale a whole recipe without mutation', () => {
  const lineToInput = (l: RecipeLine) => ({
    scalePolicy: l.scale_policy,
    quantity:
      l.amount_min === null || l.amount_max === null
        ? ({ kind: 'vague', text: l.original_quantity_text } as const)
        : ({
            kind: 'range',
            min: p(l.amount_min),
            max: p(l.amount_max),
            unit: l.original_unit,
          } as const),
  });

  it('yield 4 -> 3 keeps units, original text, policy and vague lines; input untouched', () => {
    const before = JSON.stringify(recipe);
    const base = p(recipe.content.yield.quantity);
    const scaled = recipe.content.ingredients.map((l) => ({
      line: l,
      res: scale(lineToInput(l), base, p('3')),
    }));

    expect(JSON.stringify(recipe)).toBe(before);
    expect(
      scaled.map(({ line, res }) => [
        line.display_name,
        formatQuantity(res.quantity),
        line.scale_policy,
      ]),
    ).toEqual([
      ['lohifilettä', '450 g', 'linear'],
      ['ruokakermaa', '1 ⅛ dl', 'linear'],
      ['sitruunaa', '1–2 kpl', 'round_to_whole'],
      ['suolaa', 'maun mukaan', 'to_taste'],
    ]);
    const original = (JSON.parse(before) as typeof recipe).content.ingredients;
    scaled.forEach(({ line, res }, idx) => {
      expect(line.original_quantity_text).toBe(original[idx]?.original_quantity_text);
      if (res.quantity.kind !== 'vague') expect(res.quantity.unit).toBe(line.original_unit);
    });
  });
});
