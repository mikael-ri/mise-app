import type { RecipeSearchQuery } from '@mise/contracts';

/** Filters as kept in the URL (so back-navigation from a recipe restores the list). */
export interface ListFilters {
  q: string;
  tags: string[];
  /** Total-time ceiling in minutes; one of TIME_FILTERS or null. */
  maxTime: number | null;
  archived: boolean;
}

export const TIME_FILTERS = [30, 60] as const;
export const PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 250;

export function filtersFromParams(params: URLSearchParams): ListFilters {
  const timeParam = params.get('time');
  const time = timeParam === null ? null : Number(timeParam);
  return {
    q: params.get('q') ?? '',
    tags: params.getAll('tag'),
    maxTime: time !== null && (TIME_FILTERS as readonly number[]).includes(time) ? time : null,
    archived: params.get('archived') === '1',
  };
}

export function filtersToParams(filters: ListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim() !== '') params.set('q', filters.q);
  for (const tag of filters.tags) params.append('tag', tag);
  if (filters.maxTime !== null) params.set('time', String(filters.maxTime));
  if (filters.archived) params.set('archived', '1');
  return params;
}

export const hasActiveFilters = (f: ListFilters): boolean =>
  f.q.trim() !== '' || f.tags.length > 0 || f.maxTime !== null;

export function toggleTag(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/** API query for one page. The search text is trimmed and capped at the contract's 8 words. */
export function toQuery(filters: ListFilters, offset: number): RecipeSearchQuery {
  const q = filters.q.trim().split(/\s+/).slice(0, 8).join(' ');
  return {
    ...(q === '' ? {} : { q }),
    ...(filters.tags.length > 0 ? { tags: filters.tags } : {}),
    ...(filters.maxTime === null ? {} : { maxTime: filters.maxTime }),
    ...(filters.archived ? { includeArchived: true } : {}),
    limit: PAGE_SIZE,
    offset,
  };
}
