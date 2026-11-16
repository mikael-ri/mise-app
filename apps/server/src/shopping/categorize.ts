import type { Queryable } from '../platform/index.js';
import * as repo from './repository.js';

/** What a categorizer step sees. The household always comes from the session. */
export interface CategorizeInput {
  householdId: string;
  normalizedKey: string | null;
}

/** Returns a category ID, or null to let the next step decide. */
export type CategorizeStep = (q: Queryable, input: CategorizeInput) => Promise<string | null>;

/** Household correction persisted per normalized key (FR-36, ADR-015). */
export const householdOverride: CategorizeStep = async (q, { householdId, normalizedKey }) =>
  normalizedKey === null ? null : repo.getCategoryOverride(q, householdId, normalizedKey);

/** The `Other` fallback; always answers, so it must stay last. */
export const otherFallback: CategorizeStep = async (q, { householdId }) =>
  repo.getOtherCategoryId(q, householdId);

/**
 * Category resolution for items without an explicit choice, in order (ADR-015 addendum, A13):
 * household override -> keyword dictionary (not yet built; it goes here) -> `Other`.
 * An explicit category from the member is applied by the caller before these steps run.
 */
export const CATEGORIZE_STEPS: readonly CategorizeStep[] = [householdOverride, otherFallback];

export async function categorize(
  q: Queryable,
  input: CategorizeInput,
  steps: readonly CategorizeStep[] = CATEGORIZE_STEPS,
): Promise<string> {
  for (const step of steps) {
    const id = await step(q, input);
    if (id !== null) return id;
  }
  throw new Error('categorizer steps must end with a fallback');
}
