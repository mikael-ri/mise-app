import type { RecipeContentV1 } from '@mise/contracts';
import {
  ONE,
  add,
  compare,
  equals,
  formatQuantity,
  formatRational,
  isPositive,
  parseRational,
  rational,
  scale,
} from '@mise/domain';
import type { LineQuantity, Rational } from '@mise/domain';

/**
 * Ephemeral servings-converter view (FR-06, AC-14). Pure: scaling and formatting come from
 * `@mise/domain`; nothing here is saved or sent to the API.
 */

type Line = RecipeContentV1['ingredients'][number];

export interface LineView {
  id: string;
  groupId: string | null;
  /** Quantity text, e.g. "1,5 dl", "~2 kpl" or "maun mukaan"; empty when the line has no amount. */
  quantityText: string;
  /** True when rounding changed the amount noticeably ("Rounded for practicality"). */
  rounded: boolean;
  name: string;
  note: string | null;
}

const FORMAT = { decimalSeparator: ',' } as const;

/** The line's amounts as a domain quantity; vague (original text) when there is no numeric amount. */
export function toQuantity(line: Line): LineQuantity {
  const min = line.amount_min === null ? null : parseRational(line.amount_min);
  if (min === null) return { kind: 'vague', text: line.original_quantity_text ?? '' };
  const max = line.amount_max === null ? null : parseRational(line.amount_max);
  const unit = line.original_unit;
  if (max === null || equals(min, max)) return { kind: 'exact', amount: min, unit };
  return { kind: 'range', min, max, unit };
}

export type SavedYield = RecipeContentV1['yield'];

/**
 * The one place that reads a content yield. `kind: 'none'` means servings are not set (null yield);
 * `invalid` is a stored yield that is not a positive number (cannot be scaled by servings).
 */
export function readYield(
  y: SavedYield,
):
  | { kind: 'none' }
  | { kind: 'invalid'; unit: string }
  | { kind: 'set'; base: Rational; unit: string; quantity: string } {
  if (y === null) return { kind: 'none' };
  const base = parseYield(y.quantity);
  return base === null
    ? { kind: 'invalid', unit: y.unit }
    : { kind: 'set', base, unit: y.unit, quantity: y.quantity };
}

export function parseYield(quantity: string): Rational | null {
  const value = parseRational(quantity);
  return value !== null && isPositive(value) ? value : null;
}

/** Target servings typed by the user ("3", "2,5", "1/2"); null unless positive. */
export function parseTarget(text: string): Rational | null {
  return parseYield(text.trim());
}

/** Stepper: +/- one serving, never below one serving (a half-portion can be typed directly). */
export function stepTarget(current: Rational, delta: 1 | -1): Rational {
  const next = add(current, rational(BigInt(delta)));
  return compare(next, ONE) < 0 ? ONE : next;
}

export function formatServings(value: Rational): string {
  return formatRational(value, FORMAT);
}

/** Ingredient line for display at `target` servings. At the saved yield the original text is shown verbatim. */
export function lineView(line: Line, baseYield: Rational, target: Rational): LineView {
  const quantity = toQuantity(line);
  const original = line.original_quantity_text;
  const base = {
    id: line.id,
    groupId: line.group_id,
    name: line.display_name,
    note: line.preparation_note,
  };
  const scalable =
    quantity.kind !== 'vague' &&
    (line.scale_policy === 'linear' || line.scale_policy === 'round_to_whole');
  if (!scalable || equals(baseYield, target)) {
    const text = original ?? (quantity.kind === 'vague' ? '' : formatQuantity(quantity, FORMAT));
    return { ...base, quantityText: text, rounded: false };
  }
  const scaled = scale({ quantity, scalePolicy: line.scale_policy }, baseYield, target);
  const rounded = scaled.warnings.length > 0;
  const text = formatQuantity(scaled.quantity, FORMAT);
  return { ...base, quantityText: rounded ? `~${text}` : text, rounded };
}

/** True when the preview differs from the saved yield (drives "Preview only, not saved"). */
export function isPreview(baseYield: Rational, target: Rational): boolean {
  return !equals(baseYield, target);
}
