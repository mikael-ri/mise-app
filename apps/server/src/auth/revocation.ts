// In-process revocation signal. A14 subscribes each SSE stream to its device session and closes the
// stream when the session is revoked here (AC-11). Requests are protected independently: the session
// hook re-reads `device_sessions` on every request. Single instance in MVP, so no broker.
export type RevocationListener = () => void;

export interface RevocationHub {
  /** Calls `listener` once when `sessionId` is revoked. Returns an unsubscribe function. */
  subscribe(sessionId: string, listener: RevocationListener): () => void;
  /** Notifies and drops every listener of `sessionId`. */
  publish(sessionId: string): void;
}

export function createRevocationHub(): RevocationHub {
  const listeners = new Map<string, Set<RevocationListener>>();
  return {
    subscribe(sessionId, listener) {
      let set = listeners.get(sessionId);
      if (set === undefined) {
        set = new Set();
        listeners.set(sessionId, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(sessionId);
        current?.delete(listener);
        if (current?.size === 0) listeners.delete(sessionId);
      };
    },
    publish(sessionId) {
      const set = listeners.get(sessionId);
      if (set === undefined) return;
      listeners.delete(sessionId);
      for (const listener of set) {
        try {
          listener();
        } catch {
          // one failing stream must not keep the others open
        }
      }
    },
  };
}
