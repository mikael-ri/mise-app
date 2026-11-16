// In-process fan-out of list change cursors to open SSE streams (tech §11, ADR-004). Single instance
// in MVP: no outbox, no LISTEN/NOTIFY. The database stays the truth; a missed signal is recovered by
// the client refetching the REST snapshot, so delivery here is best effort and never durable.
import type { ShoppingListEvent } from '@mise/contracts';

export type ListEventListener = (event: ShoppingListEvent) => void;

export interface ListEventHub {
  /** Listens to one list of one household. Returns an unsubscribe function. */
  subscribe(householdId: string, listId: string, listener: ListEventListener): () => void;
  /** Call only after the transaction that produced `seq` has committed (DB §8.2). */
  publish(householdId: string, event: ShoppingListEvent): void;
}

// Keyed by household as well as list, so a signal can only ever reach the household that wrote it.
const keyOf = (householdId: string, listId: string) => `${householdId}:${listId}`;

export function createListEventHub(): ListEventHub {
  const listeners = new Map<string, Set<ListEventListener>>();
  return {
    subscribe(householdId, listId, listener) {
      const key = keyOf(householdId, listId);
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(key);
        current?.delete(listener);
        if (current?.size === 0) listeners.delete(key);
      };
    },
    publish(householdId, event) {
      const set = listeners.get(keyOf(householdId, event.listId));
      if (set === undefined) return;
      for (const listener of [...set]) {
        try {
          listener(event);
        } catch {
          // one broken stream must not stop the others
        }
      }
    },
  };
}
