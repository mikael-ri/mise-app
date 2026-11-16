import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient } from '../../lib/api-client.js';
import { ME_KEY, endSession } from '../../lib/session.js';
import type { MeState } from '../../lib/session.js';
import { createRecipesApi } from './recipes-api.js';
import type { RecipesApi } from './recipes-api.js';

const RecipesApiContext = createContext<RecipesApi | null>(null);

/** Same client wiring as the auth API: CSRF token from `me`, 401 -> session ended. */
export function RecipesApiProvider({ children, api }: { children: ReactNode; api?: RecipesApi }) {
  const queryClient = useQueryClient();
  const value = useMemo(
    () =>
      api ??
      createRecipesApi(
        createApiClient({
          getCsrfToken: () => queryClient.getQueryData<MeState>(ME_KEY)?.csrfToken,
          onSessionEnded: () => endSession(queryClient, 'session_ended'),
        }),
      ),
    [api, queryClient],
  );
  return <RecipesApiContext.Provider value={value}>{children}</RecipesApiContext.Provider>;
}

export function useRecipesApi(): RecipesApi {
  const api = useContext(RecipesApiContext);
  if (api === null) throw new Error('RecipesApiProvider missing');
  return api;
}
