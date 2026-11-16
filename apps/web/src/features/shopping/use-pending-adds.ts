import { useQueryClient } from '@tanstack/react-query';
import type { ShoppingItem } from '@mise/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cacheItem } from './queries.js';
import { useShoppingApi } from './use-shopping-api.js';

/** A typed-but-not-yet-confirmed item. Local UI state only: never sent anywhere but its own POST. */
export interface PendingAdd {
  id: string;
  name: string;
  /** One idempotency key per placeholder, reused by every retry (hard rule 8). */
  key: string;
  status: 'pending' | 'failed';
}

/**
 * Add-bar submissions show a placeholder at once. On success the real item goes into the snapshot
 * cache and the placeholder is dropped in the same tick (no flash, no duplicate). On failure the
 * placeholder stays with Retry (same key) and Remove. Several adds can be in flight. Offline writes
 * are not queued: placeholders are dropped on unmount.
 */
export function usePendingAdds(listId: string, onAdded: (item: ShoppingItem) => void) {
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<readonly PendingAdd[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;

  const mark = (id: string, status: PendingAdd['status']) =>
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));

  const send = useCallback(
    (p: PendingAdd) => {
      api.addItem(listId, { name: p.name }, p.key).then(
        (item) => {
          // The item may still be cached after unmount, but no UI state or toast is touched.
          cacheItem(queryClient, item);
          if (!mounted.current) return;
          setPending((prev) => prev.filter((x) => x.id !== p.id));
          onAddedRef.current(item);
        },
        () => {
          if (!mounted.current) return;
          setPending((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'failed' } : x)));
        },
      );
    },
    [api, queryClient, listId],
  );

  const add = useCallback(
    (name: string) => {
      const p: PendingAdd = {
        id: crypto.randomUUID(),
        name,
        key: crypto.randomUUID(),
        status: 'pending',
      };
      setPending((prev) => [...prev, p]);
      send(p);
    },
    [send],
  );

  const retry = (id: string) => {
    const p = pendingRef.current.find((x) => x.id === id);
    if (p === undefined) return;
    mark(id, 'pending');
    send(p);
  };
  // Remove discards the placeholder and its key. If the first POST had in fact committed (lost
  // response), that item simply shows up on the next snapshot refetch: no duplicate, since Remove
  // never re-sends.
  const dismiss = (id: string) => setPending((prev) => prev.filter((x) => x.id !== id));

  return { pending, add, retry, dismiss };
}
