import type { Rational } from './rational.js';

/** Single amount with an optional (original) unit code, e.g. 600 g. */
export interface Quantity {
  readonly kind: 'exact';
  readonly amount: Rational;
  readonly unit: string | null;
}

/** Range, e.g. 1-2 kpl. Stays a range through scaling. */
export interface QuantityRange {
  readonly kind: 'range';
  readonly min: Rational;
  readonly max: Rational;
  readonly unit: string | null;
}

/** Non-numeric amount such as "maun mukaan"; original text is preserved. */
export interface VagueQuantity {
  readonly kind: 'vague';
  readonly text: string;
}

export type LineQuantity = Quantity | QuantityRange | VagueQuantity;

/** Placeholder normalized ingredient key for Milestone A: lowercase + trim (ADR-015). */
export const normalizeKey = (name: string): string => name.trim().toLowerCase();
