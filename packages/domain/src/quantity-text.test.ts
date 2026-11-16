import { describe, expect, it } from 'vitest';
import { parseQuantityText } from './quantity-text.js';

describe('parseQuantityText (FR-35: optional quantity and unit, original text kept by caller)', () => {
  it.each([
    ['2 kg', { amountMin: '2', amountMax: null, unitCode: 'kg' }],
    ['2kg', { amountMin: '2', amountMax: null, unitCode: 'kg' }],
    ['1,5 dl', { amountMin: '1.5', amountMax: null, unitCode: 'dl' }],
    ['1.5 l', { amountMin: '1.5', amountMax: null, unitCode: 'l' }],
    ['1/2 l', { amountMin: '0.5', amountMax: null, unitCode: 'l' }],
    ['1 1/2 dl', { amountMin: '1.5', amountMax: null, unitCode: 'dl' }],
    ['1-2 prk', { amountMin: '1', amountMax: '2', unitCode: 'prk' }],
    ['1 – 2 purkkia', { amountMin: '1', amountMax: '2', unitCode: 'prk' }],
    ['3', { amountMin: '3', amountMax: null, unitCode: null }],
    ['  6 kpl  ', { amountMin: '6', amountMax: null, unitCode: 'kpl' }],
    ['0,125 kg', { amountMin: '0.125', amountMax: null, unitCode: 'kg' }],
    ['3 Litraa', { amountMin: '3', amountMax: null, unitCode: 'l' }],
  ])('parses %j', (text, expected) => {
    expect(parseQuantityText(text)).toEqual(expected);
  });

  it.each([
    ['vague amount', 'maun mukaan'],
    ['unknown unit is never guessed', '2 pakettia'],
    ['no number', 'kg'],
    ['non-terminating fraction stays text', '1/3 l'],
    ['reversed range', '3-2 kg'],
    ['zero denominator', '1/0 l'],
    ['empty', ''],
    ['negative', '-2 kg'],
    ['longer than a DecimalString', `${'9'.repeat(41)} g`],
  ])('returns null for %s', (_name, text) => {
    expect(parseQuantityText(text)).toBeNull();
  });
});
