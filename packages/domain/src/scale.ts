import type { LineQuantity } from './quantity.js';
import {
  type Rational,
  ONE,
  abs,
  compare,
  div,
  isPositive,
  isZero,
  mul,
  rational,
  roundHalfUp,
  sub,
} from './rational.js';

export type ScalePolicy = 'linear' | 'round_to_whole' | 'to_taste' | 'not_scalable';

/** Relative rounding change above which a warning is raised (ADR-015 addendum). */
export const ROUNDING_WARNING_THRESHOLD: Rational = rational(1n, 10n);

export interface ScaleWarning {
  readonly code: 'rounding_changes_amount';
  readonly exact: Rational;
  readonly rounded: Rational;
}

export interface ScaleInput {
  readonly quantity: LineQuantity;
  readonly scalePolicy: ScalePolicy;
}

export interface ScaleOutput {
  readonly quantity: LineQuantity;
  readonly warnings: readonly ScaleWarning[];
}

const roundWhole = (exact: Rational, warnings: ScaleWarning[]): Rational => {
  let rounded = rational(roundHalfUp(exact));
  // A positive amount never rounds down to nothing.
  if (isZero(rounded) && isPositive(exact)) rounded = ONE;
  if (!isZero(exact)) {
    const change = div(abs(sub(rounded, exact)), exact);
    if (compare(change, ROUNDING_WARNING_THRESHOLD) > 0) {
      warnings.push({ code: 'rounding_changes_amount', exact, rounded });
    }
  }
  return rounded;
};

/**
 * Scales one ingredient line from baseYield to targetYield. Original unit is kept, ranges stay ranges,
 * vague amounts and to_taste / not_scalable lines are returned unchanged.
 * Throws RangeError when a yield is not positive (callers validate yields at the boundary).
 * Callers must also validate min <= max of ranges at the boundary (Zod); scale() does not check it.
 * Under round_to_whole each range endpoint is rounded independently, so a range may collapse to
 * min == max (it stays kind 'range') and may emit one warning per endpoint.
 */
export const scale = (
  line: ScaleInput,
  baseYield: Rational,
  targetYield: Rational,
): ScaleOutput => {
  if (!isPositive(baseYield) || !isPositive(targetYield)) {
    throw new RangeError('Yields must be positive');
  }
  const { quantity, scalePolicy } = line;
  if (quantity.kind === 'vague' || scalePolicy === 'to_taste' || scalePolicy === 'not_scalable') {
    return { quantity, warnings: [] };
  }
  const factor = div(targetYield, baseYield);
  const warnings: ScaleWarning[] = [];
  const apply = (v: Rational): Rational => {
    const exact = mul(v, factor);
    return scalePolicy === 'round_to_whole' ? roundWhole(exact, warnings) : exact;
  };
  if (quantity.kind === 'exact') {
    return { quantity: { ...quantity, amount: apply(quantity.amount) }, warnings };
  }
  return {
    quantity: { ...quantity, min: apply(quantity.min), max: apply(quantity.max) },
    warnings,
  };
};
