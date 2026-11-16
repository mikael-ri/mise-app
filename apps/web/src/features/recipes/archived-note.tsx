import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recipe } from '@mise/contracts';
import { Button } from '../../components/button.js';
import { ErrorState } from '../../components/error-state.js';
import { useToast } from '../../components/toast.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { cacheWrittenRecipe, recipeKeys } from './queries.js';
import { useRecipesApi } from './use-recipes-api.js';

/** Archived recipes are read-only: say so and offer Restore (unarchive; creates no version). */
export function ArchivedNote({ recipe }: { recipe: Recipe }) {
  const api = useRecipesApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const unarchive = useMutation({
    mutationFn: () => api.patch(recipe.id, recipe.revision, { archived: false }),
    onSuccess: (updated) => {
      cacheWrittenRecipe(queryClient, updated);
      toast.show(t('recipes.restore.toast', { title: updated.title }));
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) }),
  });
  return (
    <div
      role="status"
      data-testid="archived-note"
      className="mb-4 flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <p className="font-medium">{t('recipes.detail.archivedBanner')}</p>
      <p>{t('recipes.detail.archivedNote')}</p>
      <div>
        <Button
          variant="secondary"
          disabled={unarchive.isPending}
          onClick={() => unarchive.mutate()}
        >
          {t('recipes.restore.action')}
        </Button>
      </div>
      {unarchive.isError && (
        <ErrorState
          message={t('recipes.restore.error')}
          correlationId={isApiError(unarchive.error) ? unarchive.error.correlationId : undefined}
        />
      )}
    </div>
  );
}
