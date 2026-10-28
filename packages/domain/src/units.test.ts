import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNIT_TABLE, VAGUE_AMOUNTS, convert, isVagueAmount, lookupUnit } from './units.js';
import { normalizeKey } from './quantity.js';
import { parseRational, toDecimalString } from './rational.js';

interface Fixture {
  units: { code: string; dimension: string; toBase: number | null; aliases: string[] }[];
  vague: { text: string }[];
  conversionCases: { qty: string; from: string; to: string; out?: string; error?: string }[];
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/units.json', import.meta.url), 'utf8'),
) as Fixture;

describe('unit table matches tests/fixtures/units.json (FR-05)', () => {
  it('has the same units', () => {
    expect(
      UNIT_TABLE.map((u) => ({
        code: u.code,
        dimension: u.dimension,
        toBase: u.toBase,
        aliases: [...u.aliases],
      })).sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual(
      fixture.units
        .map((u) => ({ ...u, toBase: u.toBase === null ? null : String(u.toBase) }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  });
  it('has the same vague amounts', () => {
    expect([...VAGUE_AMOUNTS].sort()).toEqual(fixture.vague.map((v) => v.text).sort());
  });
});

describe('lookupUnit (FR-05)', () => {
  it.each([
    ['kpl', 'kpl'],
    ['rkl', 'rkl'],
    ['TL', 'tl'],
    ['dl.', 'dl'],
    [' Desilitraa ', 'dl'],
    ['ruokalusikallinen', 'rkl'],
    ['purkki', 'prk'],
    ['pussia', 'ps'],
    ['rasia', 'rs'],
    ['senttilitra', 'cl'],
    ['kappaletta', 'kpl'],
  ])('%s -> %s', (text, code) => {
    expect(lookupUnit(text)?.code).toBe(code);
  });
  it('returns undefined for unknown units', () => {
    expect(lookupUnit('nokare')).toBeUndefined();
  });
  it('detects vague amounts', () => {
    expect(isVagueAmount('Maun mukaan')).toBe(true);
    expect(isVagueAmount('2 dl')).toBe(false);
  });
});

describe('convert (FR-05, FR-06)', () => {
  it.each(fixture.conversionCases)('$qty $from -> $to', (c) => {
    const qty = parseRational(c.qty);
    if (!qty) throw new Error('bad fixture');
    const res = convert(qty, c.from, c.to);
    if (c.error) {
      expect(res).toEqual({ ok: false, error: c.error });
    } else {
      expect(res.ok).toBe(true);
      if (res.ok) expect(toDecimalString(res.value)).toBe(c.out);
    }
  });
});

describe('normalizeKey (ADR-015)', () => {
  it.each([
    ['  Lohifilettä ', 'lohifilettä'],
    ['RUOKAKERMA', 'ruokakerma'],
    ['Äyriäiset', 'äyriäiset'],
  ])('%j -> %j', (input, want) => {
    expect(normalizeKey(input)).toBe(want);
  });
});
