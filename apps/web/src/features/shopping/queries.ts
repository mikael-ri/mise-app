import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { ShoppingItem, ShoppingListSnapshot } from '@mise/contracts';
import { useCallback, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-client.js';
import type { CheckoffEntry } from './list-model.js';
import { useShoppingApi } from './use-shopping-api.js';

export const shoppingKeys = {
  all: ['shopping'] as const,
  lists: (status: 'active' | 'archived') => ['shopping', 'lists', status] as const,
  listsAll: ['shopping', 'lists'] as const,
  snapshot: (listId: string) => ['shopping', 'snapshot', listId] as const,
  categories: ['shopping', 'categories'] as const,
  members: ['shopping', 'members'] as const,
};

export function useLists(status: 'active' | 'archived') {
  const api = useShoppingApi();
  return useQuery({ queryKey: shoppingKeys.lists(status), queryFn: () => api.listLists(status) });
}

export function useSnapshot(listId: string) {
  const api = useShoppingApi();
  return useQuery({
    queryKey: shoppingKeys.snapshot(listId),
    queryFn: () => api.getSnapshot(listId),
  });
}

export function useCategories() {
  const api = useShoppingApi();
  return useQuery({
    queryKey: shoppingKeys.categories,
    queryFn: () => api.listCategories(),
    staleTime: 5 * 60_000,
  });
}

/** Read-only and rarely changing; never blocks rendering (names fall back to a generic label). */
export function useHouseholdMembers() {
  const api = useShoppingApi();
  return useQuery({
    queryKey: shoppingKeys.members,
    queryFn: () => api.listMembers(),
    staleTime: 5 * 60_000,
  });
}

/** Writes a server-returned item into the snapshot cache (replace by id, or add). */
export function cacheItem(queryClient: QueryClient, item: ShoppingItem): void {
  queryClient.setQueryData<ShoppingListSnapshot>(shoppingKeys.snapshot(item.listId), (old) => {
    if (old === undefined) return old;
    const exists = old.items.some((i) => i.id === item.id);
    return {
      ...old,
      items: exists ? old.items.map((i) => (i.id === item.id ? item : i)) : [...old.items, item],
    };
  });
  void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
}

export function uncacheItem(queryClient: QueryClient, listId: string, itemId: string): void {
  queryClient.setQueryData<ShoppingListSnapshot>(shoppingKeys.snapshot(listId), (old) =>
    old === undefined ? old : { ...old, items: old.items.filter((i) => i.id !== itemId) },
  );
  void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
}

/**
 * Optimistic checkoff (FR-37, AC-08). Each tap sends the desired state, never a toggle, so two
 * people ticking the same item converge without an error. A newer tap on the same item supersedes
 * an older request: only the latest request may update or reject the row.
 */
export function useCheckoff(listId: string) {
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<ReadonlyMap<string, CheckoffEntry>>(new Map());
  const latest = useRef(new Map<string, number>());
  const counter = useRef(0);

  const send = useCallback(
    (itemId: string, desired: boolean) => {
      counter.current += 1;
      const token = counter.current;
      latest.current.set(itemId, token);
      setEntries((prev) => new Map(prev).set(itemId, { desired, status: 'pending' }));
      api.setPicked(itemId, desired).then(
        (item) => {
          if (latest.current.get(itemId) !== token) return;
          latest.current.delete(itemId);
          // An older in-flight snapshot refetch must not land after this write and briefly revert
          // the row; cancel it, write, then refetch to pick up anything it would have brought.
          void queryClient.cancelQueries({ queryKey: shoppingKeys.snapshot(listId) }).then(() => {
            cacheItem(queryClient, item);
            void queryClient.invalidateQueries({ queryKey: shoppingKeys.snapshot(listId) });
            setEntries((prev) => {
              const next = new Map(prev);
              next.delete(itemId);
              return next;
            });
          });
        },
        (error: unknown) => {
          if (latest.current.get(itemId) !== token) return;
          latest.current.delete(itemId);
          // Reverted to the server state; the row offers Retry. A non-network error means the
          // item changed under us, so also refresh.
          setEntries((prev) => new Map(prev).set(itemId, { desired, status: 'rejected' }));
          if (isApiError(error) && error.code !== 'network_error') {
            void queryClient.invalidateQueries({ queryKey: shoppingKeys.snapshot(listId) });
          }
        },
      );
    },
    [api, queryClient, listId],
  );

  const retry = useCallback(
    (itemId: string) => {
      const entry = entries.get(itemId);
      if (entry !== undefined) send(itemId, entry.desired);
    },
    [entries, send],
  );

  return { entries, setPicked: send, retry };
}
