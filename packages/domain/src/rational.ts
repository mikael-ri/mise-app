/** Exact rational number on BigInt. No floats anywhere. Denominator is always > 0 and the fraction is reduced. */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
};

export const rational = (n: bigint, d: bigint = 1n): Rational => {
  if (d === 0n) throw new RangeError('Rational denominator must not be zero');
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d) || 1n;
  return { n: (sign * n) / g, d: (sign * d) / g };
};

export const ZERO: Rational = rational(0n);
export const ONE: Rational = rational(1n);

export const add = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational): Rational => {
  if (b.n === 0n) throw new RangeError('Division by zero');
  return rational(a.n * b.d, a.d * b.n);
};

export const compare = (a: Rational, b: Rational): -1 | 0 | 1 => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
export const equals = (a: Rational, b: Rational): boolean => compare(a, b) === 0;
export const isZero = (a: Rational): boolean => a.n === 0n;
export const isNegative = (a: Rational): boolean => a.n < 0n;
export const isPositive = (a: Rational): boolean => a.n > 0n;
export const abs = (a: Rational): Rational => (a.n < 0n ? rational(-a.n, a.d) : a);

/** Floor division for rationals (toward negative infinity). */
export const floor = (a: Rational): bigint => {
  const q = a.n / a.d;
  return a.n % a.d !== 0n && a.n < 0n ? q - 1n : q;
};

/** Round half up (toward +infinity on ties) to the nearest integer. */
export const roundHalfUp = (a: Rational): bigint => floor(add(a, rational(1n, 2n)));

const INT = /^\d+$/;
const DECIMAL = /^(\d+)(?:[.,](\d+))?$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;
const MIXED = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/;

/**
 * Parses a non-negative quantity: "3", "1.5", "1,5", "1/2", "1 1/2".
 * Returns null when the text is not a plain number (callers keep the original text).
 */
export const parseRational = (input: string): Rational | null => {
  const s = input.trim();
  if (INT.test(s)) return rational(BigInt(s));
  const dec = DECIMAL.exec(s);
  if (dec) {
    const [, whole = '', frac = ''] = dec;
    return rational(BigInt(whole + frac), 10n ** BigInt(frac.length));
  }
  const mixed = MIXED.exec(s);
  if (mixed) {
    const [, w = '0', n = '0', d = '1'] = mixed;
    if (BigInt(d) === 0n) return null;
    return add(rational(BigInt(w)), rational(BigInt(n), BigInt(d)));
  }
  const fr = FRACTION.exec(s);
  if (fr) {
    const [, n = '0', d = '1'] = fr;
    if (BigInt(d) === 0n) return null;
    return rational(BigInt(n), BigInt(d));
  }
  return null;
};

/** Decimal string with at most `maxDecimals` places, rounded half away from zero, trailing zeros trimmed. Uses '.'. */
export const toDecimalString = (a: Rational, maxDecimals = 6): string => {
  const negative = a.n < 0n;
  const scale = 10n ** BigInt(maxDecimals);
  const num = (negative ? -a.n : a.n) * scale;
  const scaled = (2n * num + a.d) / (2n * a.d);
  const whole = scaled / scale;
  const fracDigits = (scaled % scale).toString().padStart(maxDecimals, '0').replace(/0+$/, '');
  const body = fracDigits.length > 0 ? `${whole}.${fracDigits}` : `${whole}`;
  return negative && scaled !== 0n ? `-${body}` : body;
};
