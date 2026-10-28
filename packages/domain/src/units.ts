import { type Rational, mul, div, parseRational } from './rational.js';

export type Dimension = 'volume' | 'mass' | 'count' | 'package' | 'length';

export interface UnitDef {
  readonly code: string;
  readonly dimension: Dimension;
  /** Factor to the dimension base unit (ml for volume, g for mass, cm for length); null when not convertible. */
  readonly toBase: string | null;
  readonly aliases: readonly string[];
}

/** Maintained Finnish unit table. Must match tests/fixtures/units.json (asserted in tests). */
export const UNIT_TABLE: readonly UnitDef[] = [
  { code: 'ml', dimension: 'volume', toBase: '1', aliases: ['millilitra'] },
  { code: 'dl', dimension: 'volume', toBase: '100', aliases: ['desilitra', 'desilitraa'] },
  { code: 'cl', dimension: 'volume', toBase: '10', aliases: ['senttilitra', 'senttilitraa'] },
  { code: 'l', dimension: 'volume', toBase: '1000', aliases: ['litra', 'litraa'] },
  {
    code: 'tl',
    dimension: 'volume',
    toBase: '5',
    aliases: ['teelusikka', 'teelusikallinen', 'tsp'],
  },
  {
    code: 'rkl',
    dimension: 'volume',
    toBase: '15',
    aliases: ['ruokalusikka', 'ruokalusikallinen', 'tbsp'],
  },
  { code: 'g', dimension: 'mass', toBase: '1', aliases: ['gramma', 'grammaa'] },
  { code: 'kg', dimension: 'mass', toBase: '1000', aliases: ['kilo', 'kiloa'] },
  { code: 'kpl', dimension: 'count', toBase: null, aliases: ['kappale', 'kappaletta', 'pcs'] },
  { code: 'kynsi', dimension: 'count', toBase: null, aliases: ['kynttä', 'kynsi', 'kynnet'] },
  { code: 'prk', dimension: 'package', toBase: null, aliases: ['purkki', 'purkkia'] },
  { code: 'ps', dimension: 'package', toBase: null, aliases: ['pussi', 'pussia', 'pkt'] },
  { code: 'tlk', dimension: 'package', toBase: null, aliases: ['tölkki', 'tölkkiä'] },
  { code: 'nippu', dimension: 'package', toBase: null, aliases: ['nippua'] },
  { code: 'cm', dimension: 'length', toBase: '1', aliases: ['senttimetri', 'senttiä'] },
  { code: 'rs', dimension: 'package', toBase: null, aliases: ['rasia', 'rasiaa'] },
];

/** Vague amounts that are never scaled numerically. */
export const VAGUE_AMOUNTS: readonly string[] = ['maun mukaan', 'ripaus', 'kourallinen'];

const normalizeUnitText = (text: string): string => text.trim().toLowerCase().replace(/\.$/, '');

const BY_TEXT: ReadonlyMap<string, UnitDef> = new Map(
  UNIT_TABLE.flatMap((u) => [u.code, ...u.aliases].map((t): [string, UnitDef] => [t, u])),
);

/** Looks a unit up by code or alias ("Desilitraa", "dl.", " rkl "). Returns undefined for unknown units. */
export const lookupUnit = (text: string): UnitDef | undefined =>
  BY_TEXT.get(normalizeUnitText(text));

export const isVagueAmount = (text: string): boolean =>
  VAGUE_AMOUNTS.includes(text.trim().toLowerCase());

export type ConvertError = 'unknown_unit' | 'incompatible_dimensions' | 'not_convertible';

export type ConvertResult =
  | { readonly ok: true; readonly value: Rational }
  | { readonly ok: false; readonly error: ConvertError };

const CONVERTIBLE: readonly Dimension[] = ['volume', 'mass'];

/**
 * Converts within one dimension (volume or mass) only. Count, package and length units are never
 * converted; different dimensions are never equated. The same unit returns the value unchanged.
 */
export const convert = (value: Rational, from: string, to: string): ConvertResult => {
  const f = lookupUnit(from);
  const t = lookupUnit(to);
  if (!f || !t) return { ok: false, error: 'unknown_unit' };
  if (f.dimension !== t.dimension) return { ok: false, error: 'incompatible_dimensions' };
  if (f.code === t.code) return { ok: true, value };
  if (!CONVERTIBLE.includes(f.dimension) || f.toBase === null || t.toBase === null) {
    return { ok: false, error: 'not_convertible' };
  }
  const fromBase = parseRational(f.toBase);
  const toBase = parseRational(t.toBase);
  if (!fromBase || !toBase)
    throw new Error(`Invalid toBase in unit table for ${f.code} or ${t.code}`);
  return { ok: true, value: div(mul(value, fromBase), toBase) };
};
