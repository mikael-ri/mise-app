import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RecipeSummary } from '@mise/contracts';
import { useEffect, useMemo, useState } from 'react';
import { Link, ScrollRestoration, useSearchParams } from 'react-router';
import { Button, buttonClass } from '../../components/button.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import {
  SEARCH_DEBOUNCE_MS,
  TIME_FILTERS,
  filtersFromParams,
  filtersToParams,
  hasActiveFilters,
  toQuery,
  toggleTag,
} from './list-filters.js';
import { cacheWrittenRecipe, recipeKeys } from './queries.js';
import { summaryLine, tagOptions } from './recipe-view.js';
import { useDebouncedValue } from './use-debounced-value.js';
import { useRecipesApi } from './use-recipes-api.js';

const CHIP =
  'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-base aria-pressed:border-primary aria-pressed:bg-surface-muted aria-pressed:font-semibold border-border bg-surface text-text';

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" className={CHIP} aria-pressed={pressed} onClick={onClick}>
      {pressed && <span aria-hidden="true">&#10003; </span>}
      {children}
    </button>
  );
}

function RecipeCard({
  recipe,
  onRestore,
  restoring,
}: {
  recipe: RecipeSummary;
  onRestore: (recipe: RecipeSummary) => void;
  restoring: boolean;
}) {
  const archived = recipe.archivedAt !== null;
  const summary = summaryLine(recipe);
  return (
    <li
      data-testid="recipe-card"
      data-recipe-id={recipe.id}
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <Link to={`/recipes/${recipe.id}`} className="flex min-h-11 flex-1 flex-col gap-1">
        <span className="text-lg font-medium">{recipe.title}</span>
        {recipe.tags.length > 0 && (
          <span className="text-sm text-text-muted">{recipe.tags.join(', ')}</span>
        )}
        {summary !== null && <span className="text-sm text-text-muted">{summary}</span>}
        {archived && (
          <span
            data-testid="archived-badge"
            className="inline-flex w-fit items-center rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs font-semibold uppercase"
          >
            {t('recipes.list.archivedLabel')}
          </span>
        )}
      </Link>
      {archived && (
        <Button
          variant="secondary"
          disabled={restoring}
          aria-label={t('recipes.list.restoreLabel', { title: recipe.title })}
          onClick={() => onRestore(recipe)}
        >
          {t('recipes.restore.action')}
        </Button>
      )}
    </li>
  );
}

export function RecipeListPage() {
  const api = useRecipesApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const [searchText, setSearchText] = useState(filters.q);
  const debounced = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const update = (next: Partial<typeof filters>) =>
    setParams(filtersToParams({ ...filters, ...next }), { replace: true });

  // Debounced text -> URL. The URL stays the single source of the active filters.
  useEffect(() => {
    if (debounced !== filters.q) update({ q: debounced });
  }, [debounced]);
  // External change of q (Clear search, back button) -> input.
  useEffect(() => setSearchText(filters.q), [filters.q]);

  const list = useInfiniteQuery({
    queryKey: [
      ...recipeKeys.list,
      filters.q.trim(),
      filters.tags,
      filters.maxTime,
      filters.archived,
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.search(toQuery(filters, pageParam)),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });

  const restore = useMutation({
    mutationFn: (recipe: RecipeSummary) =>
      api.patch(recipe.id, recipe.revision, { archived: false }),
    onSuccess: (updated) => {
      cacheWrittenRecipe(queryClient, updated);
      toast.show(t('recipes.restore.toast', { title: updated.title }));
    },
    onError: () => void list.refetch(),
  });

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const chips = tagOptions(
    filters.tags,
    items.map((r) => r.tags),
  );
  const active = hasActiveFilters(filters);

  const clearAll = () => {
    setSearchText('');
    setParams(filtersToParams({ q: '', tags: [], maxTime: null, archived: filters.archived }), {
      replace: true,
    });
  };

  return (
    <>
      <ScrollRestoration />
      <PageHeader title={t('nav.recipes')} />
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-col gap-2 bg-bg px-4 py-2">
        <label htmlFor="recipe-search" className="sr-only">
          {t('recipes.list.searchLabel')}
        </label>
        <input
          id="recipe-search"
          data-testid="recipe-search-input"
          type="search"
          autoComplete="off"
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base"
          placeholder={t('recipes.list.searchPlaceholder')}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        {chips.length > 0 && (
          <div
            role="group"
            aria-label={t('recipes.list.tagsLabel')}
            className="flex gap-2 overflow-x-auto"
          >
            {chips.map((tag) => (
              <Chip
                key={tag}
                pressed={filters.tags.includes(tag)}
                onClick={() => update({ tags: toggleTag(filters.tags, tag) })}
              >
                {tag}
              </Chip>
            ))}
          </div>
        )}
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            data-testid="show-archived"
            className="size-5"
            checked={filters.archived}
            onChange={(event) => update({ archived: event.target.checked })}
          />
          {t('recipes.list.showArchived')}
        </label>
        <div
          role="group"
          aria-label={t('recipes.list.timeLabel')}
          className="flex gap-2 overflow-x-auto"
        >
          {TIME_FILTERS.map((minutes) => (
            <Chip
              key={minutes}
              pressed={filters.maxTime === minutes}
              onClick={() => update({ maxTime: filters.maxTime === minutes ? null : minutes })}
            >
              {t('recipes.list.underMinutes', { count: minutes })}
            </Chip>
          ))}
        </div>
      </div>

      {list.isPending && <SkeletonRows testId="recipes-loading" />}
      {list.isError && (
        <ErrorState
          correlationId={isApiError(list.error) ? list.error.correlationId : undefined}
          onRetry={() => void list.refetch()}
        />
      )}
      {restore.isError && (
        <div className="mb-3">
          <ErrorState message={t('recipes.restore.error')} />
        </div>
      )}
      {list.isSuccess && items.length === 0 && (
        <EmptyState
          title={
            active
              ? filters.q.trim() !== ''
                ? t('recipes.list.noResults.query', { query: filters.q.trim() })
                : t('recipes.list.noResults.filters')
              : filters.archived
                ? t('recipes.list.emptyArchived')
                : t('recipes.list.empty.title')
          }
          action={
            active ? (
              <Button onClick={clearAll}>{t('recipes.list.clearSearch')}</Button>
            ) : (
              !filters.archived && (
                <Link to="/recipes/new" className={buttonClass()}>
                  {t('recipes.list.new')}
                </Link>
              )
            )
          }
        />
      )}
      {items.length > 0 && (
        <ul aria-label={t('recipes.list.label')} className="grid gap-3 lg:grid-cols-2">
          {items.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              restoring={restore.isPending}
              onRestore={(r) => restore.mutate(r)}
            />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('recipes.list.loadMore')}
          </Button>
        </div>
      )}
      {list.isFetchNextPageError && (
        <div className="mt-3">
          <ErrorState onRetry={() => void list.fetchNextPage()} />
        </div>
      )}
      <Link
        to="/recipes/new"
        aria-label={t('recipes.list.new')}
        className="fixed bottom-20 right-4 z-20 inline-flex size-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-text shadow-lg lg:bottom-6 lg:right-6"
      >
        <span aria-hidden="true">+</span>
      </Link>
    </>
  );
}
