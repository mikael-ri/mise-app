import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Recipe } from '@mise/contracts';
import { useRecipesApi } from './use-recipes-api.js';

export const recipeKeys = {
  all: ['recipes'] as const,
  list: ['recipes', 'list'] as const,
  detail: (id: string) => ['recipes', 'detail', id] as const,
  versions: (id: string) => ['recipes', 'versions', id] as const,
  version: (id: string, versionId: string) => ['recipes', 'version', id, versionId] as const,
};

export function useRecipe(id: string) {
  const api = useRecipesApi();
  return useQuery({ queryKey: recipeKeys.detail(id), queryFn: () => api.get(id) });
}

/** After any write: show the returned recipe at once, and refetch lists and history. */
export function cacheWrittenRecipe(queryClient: QueryClient, recipe: Recipe): void {
  queryClient.setQueryData(recipeKeys.detail(recipe.id), recipe);
  void queryClient.invalidateQueries({ queryKey: recipeKeys.list });
  void queryClient.invalidateQueries({ queryKey: recipeKeys.versions(recipe.id) });
}
