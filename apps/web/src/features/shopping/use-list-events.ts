import { ShoppingListEvent } from '@mise/contracts';
import { useEffect, useRef, useState } from 'react';
import { eventsPath } from './shopping-api.js';

/** `connecting` is the neutral first state: no warning is shown until a stream has failed. */
export type SyncStatus = 'connecting' | 'connected' | 'reconnecting';

/** The subset of EventSource this hook uses; tests inject a fake. */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState?: number;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

const CLOSED = 2;
const REOPEN_DELAY_MS = 3000;

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

/**
 * Live sync for one list (FR-34, AC-08, ADR-004). The stream carries only `{listId, seq}`; every
 * event, every (re)open and every return to the tab refetches the snapshot over REST. A seq that
 * was already seen (duplicate or out of order) is ignored. EventSource retries by itself after an
 * error; the stream cannot expose a 401, so each error also triggers a snapshot refetch, whose
 * 401 ends the session through the API client. The stream closes on unmount.
 */
export function useListEvents(
  listId: string,
  refetch: () => unknown,
  factory: EventSourceFactory = defaultFactory,
): { status: SyncStatus } {
  const [status, setStatus] = useState<SyncStatus>('connecting');
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    let source: EventSourceLike | null = null;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let lastSeq = -1;
    let disposed = false;

    const connect = () => {
      const current = factory(eventsPath(listId));
      source = current;
      current.onopen = () => {
        setStatus('connected');
        void refetchRef.current();
      };
      current.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = ShoppingListEvent.safeParse(payload);
        if (!parsed.success || parsed.data.listId !== listId) return;
        if (parsed.data.seq <= lastSeq) return;
        lastSeq = parsed.data.seq;
        void refetchRef.current();
      };
      current.onerror = () => {
        setStatus('reconnecting');
        void refetchRef.current();
        // Some browsers give up after an error instead of retrying: open a fresh stream.
        if (current.readyState === CLOSED && !disposed) {
          current.close();
          reopen = setTimeout(connect, REOPEN_DELAY_MS);
        }
      };
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetchRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    connect();

    return () => {
      disposed = true;
      clearTimeout(reopen);
      document.removeEventListener('visibilitychange', onVisible);
      if (source !== null) {
        source.onopen = null;
        source.onmessage = null;
        source.onerror = null;
        source.close();
      }
    };
  }, [listId, factory]);

  return { status };
}
