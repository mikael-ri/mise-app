import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recipe, RecipeVersionMeta } from '@mise/contracts';
import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { useToast } from '../../components/toast.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { cacheWrittenRecipe, recipeKeys } from './queries.js';
import { isStaleRevision } from './save-flow.js';
import { useRecipesApi } from './use-recipes-api.js';

/** Restore confirm (AC-03): creates a new version with the old content; nothing is deleted. */
export function RestoreVersionDialog({
  recipe,
  version,
  onClose,
}: {
  recipe: Recipe;
  /** The version to restore; null keeps the dialog closed. */
  version: RecipeVersionMeta | null;
  onClose: () => void;
}) {
  const api = useRecipesApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  // One idempotency key per opened dialog, so a retry after a network failure replays, not duplicates.
  const keyRef = useRef<{ versionId: string; key: string } | null>(null);
  const shown = useRef<RecipeVersionMeta | null>(null);
  if (version !== null) shown.current = version;

  const restore = useMutation({
    mutationFn: (target: RecipeVersionMeta) => {
      if (keyRef.current?.versionId !== target.id) {
        keyRef.current = { versionId: target.id, key: crypto.randomUUID() };
      }
      return api.restore(recipe.id, recipe.revision, target.id, keyRef.current.key);
    },
    onSuccess: (updated) => {
      cacheWrittenRecipe(queryClient, updated);
      keyRef.current = null;
      onClose();
      toast.show(t('recipes.restoreVersion.toast', { version: updated.currentVersion.versionNo }));
      void navigate(`/recipes/${recipe.id}`);
    },
    onError: (error) => {
      // A stale revision means the recipe moved on: refetch so the next attempt uses the latest.
      if (isStaleRevision(error))
        void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
      keyRef.current = null;
    },
  });

  const target = shown.current;
  const errorText = !restore.isError
    ? undefined
    : isStaleRevision(restore.error)
      ? t('recipes.restoreVersion.stale')
      : isApiError(restore.error) && restore.error.status === 409
        ? t('recipes.restoreVersion.archived')
        : t('recipes.restoreVersion.error');

  return (
    <ConfirmDialog
      open={version !== null}
      onOpenChange={(open) => {
        if (open) return;
        restore.reset();
        onClose();
      }}
      title={t('recipes.restoreVersion.title', { version: target?.versionNo ?? 0 })}
      description={t('recipes.restoreVersion.description', {
        version: target?.versionNo ?? 0,
        next: recipe.currentVersion.versionNo + 1,
      })}
      confirmLabel={t('recipes.restoreVersion.confirm')}
      destructive={false}
      pending={restore.isPending}
      error={errorText}
      onConfirm={() => target !== null && restore.mutate(target)}
    />
  );
}
