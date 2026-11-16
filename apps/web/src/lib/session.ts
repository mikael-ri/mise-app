import type { MeResponse } from '@mise/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { clearAllDrafts } from '../features/recipes/draft-storage.js';

export const ME_KEY = ['auth', 'me'] as const;
export const SESSION_END_KEY = ['auth', 'session-end'] as const;

export type SessionEndReason = 'session_ended' | 'signed_out';

/** `null` after the session ended; `undefined` while not yet loaded. */
export type MeState = MeResponse | null | undefined;

/**
 * Marks the session as over. The route guard then redirects to /signin with the matching message.
 * A 401 before any session was known (first visit) is not a "session ended" event.
 */
export function endSession(client: QueryClient, reason: SessionEndReason): void {
  // Unsaved recipe drafts must not outlive the session on a shared device.
  clearAllDrafts();
  const hadSession = client.getQueryData<MeState>(ME_KEY) != null;
  // Keep the observed `me` query; drop everything else (devices, later recipes and lists).
  client.removeQueries({ predicate: (query) => query.queryKey.join('/') !== ME_KEY.join('/') });
  if (hadSession) client.setQueryData(SESSION_END_KEY, reason);
  client.setQueryData<MeState>(ME_KEY, null);
}

export function readSessionEnd(client: QueryClient): SessionEndReason | undefined {
  return client.getQueryData<SessionEndReason>(SESSION_END_KEY);
}
