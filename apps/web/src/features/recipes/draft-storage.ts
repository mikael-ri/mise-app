import { IngredientLineV1, SCALE_POLICIES } from '@mise/contracts';
import { z } from 'zod';
import type { RecipeDraft } from './form-model.js';

/**
 * Unsaved recipe drafts in localStorage (recipe text only: no tokens, no session data, never logged).
 * Every access is wrapped: private mode, quota errors and corrupt values all degrade to "no draft".
 */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredDraft {
  draft: RecipeDraft;
  /** Recipe revision the draft started from; null for a new recipe. */
  baseRevision: number | null;
  savedAt: string;
}

const PREFIX = 'mise.recipe-draft.v1.';
export const NEW_RECIPE_KEY = 'new';

const keyOf = (recipeId: string | null): string => `${PREFIX}${recipeId ?? NEW_RECIPE_KEY}`;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Bump when the stored shape changes; older payloads are then dropped, never migrated. */
export const DRAFT_FORMAT_VERSION = 1;

const text = z.string();
const DraftSchema = z.object({
  title: text,
  sourceUrl: text,
  tags: z.array(text),
  generalNotes: text,
  yieldQuantity: text,
  yieldSource: text.nullable(),
  yieldUnit: text,
  prepMinutes: text,
  cookMinutes: text,
  groups: z.array(z.object({ id: text, name: text })),
  lines: z.array(
    z.object({
      id: text,
      groupId: text.nullable(),
      name: text,
      amountMin: text,
      amountMax: text,
      isRange: z.boolean(),
      unit: text,
      note: text,
      scalePolicy: z.enum(SCALE_POLICIES),
      source: IngredientLineV1.nullable(),
    }),
  ),
  steps: z.array(z.object({ id: text, text })),
  changeReason: text,
});

const StoredDraftSchema = z.object({
  version: z.literal(DRAFT_FORMAT_VERSION),
  draft: DraftSchema,
  baseRevision: z.number().int().nullable(),
  savedAt: text,
});

/** All `mise.recipe-draft.v1.*` keys, e.g. to wipe drafts when the session ends. */
export function clearAllDrafts(
  store: (Store & Pick<Storage, 'key' | 'length'>) | null = defaultAllStore(),
): void {
  try {
    if (store === null) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // storage unavailable: nothing was stored either
  }
}

function defaultAllStore(): (Store & Pick<Storage, 'key' | 'length'>) | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(
  recipeId: string | null,
  store: Store | null = defaultStore(),
): StoredDraft | null {
  try {
    const raw = store?.getItem(keyOf(recipeId));
    if (raw === null || raw === undefined) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = StoredDraftSchema.safeParse(parsed);
    return result.success
      ? {
          draft: result.data.draft as RecipeDraft,
          baseRevision: result.data.baseRevision,
          savedAt: result.data.savedAt,
        }
      : null;
  } catch {
    return null;
  }
}

export function saveDraft(
  recipeId: string | null,
  draft: RecipeDraft,
  baseRevision: number | null,
  store: Store | null = defaultStore(),
): boolean {
  try {
    if (store === null) return false;
    const value = {
      version: DRAFT_FORMAT_VERSION,
      draft,
      baseRevision,
      savedAt: new Date().toISOString(),
    };
    store.setItem(keyOf(recipeId), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(recipeId: string | null, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(keyOf(recipeId));
  } catch {
    // nothing to do: a draft we cannot remove is only restored (with a Discard option) next time
  }
}
