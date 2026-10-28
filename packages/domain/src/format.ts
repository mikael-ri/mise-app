import type { LineQuantity } from './quantity.js';
import {
  type Rational,
  floor,
  isZero,
  rational,
  sub,
  toDecimalString,
  isPositive,
} from './rational.js';

const FRACTIONS: ReadonlyMap<string, string> = new Map([
  ['1/2', '½'],
  ['1/3', '⅓'],
  ['2/3', '⅔'],
  ['1/4', '¼'],
  ['3/4', '¾'],
  ['1/6', '⅙'],
  ['5/6', '⅚'],
  ['1/8', '⅛'],
  ['3/8', '⅜'],
  ['5/8', '⅝'],
  ['7/8', '⅞'],
]);

export interface FormatOptions {
  /** Decimal separator for the fallback; Finnish default is a comma. */
  readonly decimalSeparator?: ',' | '.';
}

/**
 * "1 ½", "¾", "2", or a decimal (max 2 places) when no friendly fraction fits. Non-negative values.
 * Display-only and lossy: the decimal fallback rounds; never feed the output back into arithmetic.
 */
export const formatRational = (value: Rational, options: FormatOptions = {}): string => {
  const sep = options.decimalSeparator ?? ',';
  const whole = floor(value);
  const frac = sub(value, rational(whole));
  if (isZero(frac)) return `${whole}`;
  const glyph = FRACTIONS.get(`${frac.n}/${frac.d}`);
  if (glyph) return whole === 0n ? glyph : `${whole} ${glyph}`;
  let dec = toDecimalString(value, 2);
  if (dec === '0' && isPositive(value)) dec = toDecimalString(value, 3);
  return dec.replace('.', sep);
};

/** Human display of a line quantity: "600 g", "1–2 kpl", "1 ½ dl", "maun mukaan". */
export const formatQuantity = (q: LineQuantity, options: FormatOptions = {}): string => {
  if (q.kind === 'vague') return q.text;
  const unit = q.unit ? ` ${q.unit}` : '';
  if (q.kind === 'exact') return `${formatRational(q.amount, options)}${unit}`;
  const lo = formatRational(q.min, options);
  const hi = formatRational(q.max, options);
  return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
};
