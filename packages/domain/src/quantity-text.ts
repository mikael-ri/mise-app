import { type Rational, compare, toDecimalString } from './rational.js';
import { parseRational } from './rational.js';
import { lookupUnit } from './units.js';

/** Shopping quantity parsed from free text such as "2 kg" or "1-2 prk" (FR-35). */
export interface ParsedQuantityText {
  /** Exact decimal strings, ready for a `numeric` column. */
  readonly amountMin: string;
  readonly amountMax: string | null;
  /** Unit code from the unit table, or null for a bare number. */
  readonly unitCode: string | null;
}

// Mixed and plain fractions first: the regex does not backtrack into another alternative once the
// whole pattern has matched, so "1/2 l" would otherwise read as 1 with the unit "/2 l".
const NUMBER = String.raw`\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?`;
/** Matches the `DecimalString` contract limit. */
const MAX_DECIMAL_LENGTH = 40;
const PATTERN = new RegExp(String.raw`^(${NUMBER})(?:\s*[-–]\s*(${NUMBER}))?\s*(\S.*)?$`, 'u');

/** Exact decimal string, or null when the value has no finite decimal form (e.g. 1/3). */
function exactDecimal(r: Rational): string | null {
  let d = r.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  if (d !== 1n) return null;
  // Denominator 2^a * 5^b: digits needed are at most max(a, b), which the bit length bounds.
  return toDecimalString(r, r.d.toString(2).length);
}

/**
 * Parses shopping quantity text into amounts and a known unit. Returns null for anything it cannot
 * read exactly (vague amounts, unknown units, non-terminating fractions, reversed ranges); callers
 * then keep only the original text. Never guesses a unit and never converts between units.
 */
export function parseQuantityText(text: string): ParsedQuantityText | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  const [, minText = '', maxText, unitText] = match;

  const min = parseRational(minText);
  const max = maxText === undefined ? null : parseRational(maxText);
  if (min === null || (maxText !== undefined && max === null)) return null;
  if (max !== null && compare(max, min) < 0) return null;

  let unitCode: string | null = null;
  if (unitText !== undefined) {
    const unit = lookupUnit(unitText);
    if (!unit) return null;
    unitCode = unit.code;
  }

  const amountMin = exactDecimal(min);
  const amountMax = max === null ? null : exactDecimal(max);
  if (amountMin === null || (max !== null && amountMax === null)) return null;
  if (amountMin.length > MAX_DECIMAL_LENGTH || (amountMax?.length ?? 0) > MAX_DECIMAL_LENGTH) {
    return null;
  }
  return { amountMin, amountMax, unitCode };
}
