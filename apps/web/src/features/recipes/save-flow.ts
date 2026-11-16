import type { Recipe } from '@mise/contracts';
import { isApiError } from '../../lib/api-client.js';
import { buildSubmission } from './form-model.js';
import type { RecipeDraft } from './form-model.js';
import type { RecipesApi } from './recipes-api.js';

export type SaveMineResult =
  | { kind: 'saved'; recipe: Recipe }
  | { kind: 'nothing_to_save' }
  /** Someone saved again between our refetch and our write. The draft is untouched. */
  | { kind: 'conflict' };

/** True for a stale-revision 409 (an archived-recipe 409 has code `conflict` and is not an edit race). */
export function isStaleRevision(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === 'stale_revision';
}

/**
 * R3a "Save mine as newest": refetch the latest recipe, then send the user's changes (computed against
 * the version they started from) on top of the latest revision. A second 409 returns `conflict`;
 * the draft is never modified here, so nothing is lost. Other errors propagate.
 */
export async function saveMineAsNewest(
  api: RecipesApi,
  recipeId: string,
  draft: RecipeDraft,
  baseline: Recipe,
): Promise<SaveMineResult> {
  const latest = await api.get(recipeId);
  const submission = buildSubmission(draft, baseline);
  if (submission.kind !== 'patch') return { kind: 'nothing_to_save' };
  try {
    return { kind: 'saved', recipe: await api.patch(recipeId, latest.revision, submission.body) };
  } catch (error) {
    if (isStaleRevision(error)) return { kind: 'conflict' };
    throw error;
  }
}
