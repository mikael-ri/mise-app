import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { MeResponse } from '@mise/contracts';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient, isApiError } from '../../lib/api-client.js';
import { createAuthApi } from '../../lib/auth-api.js';
import type { AuthApi } from '../../lib/auth-api.js';
import { ME_KEY, endSession } from '../../lib/session.js';
import type { MeState } from '../../lib/session.js';

const AuthApiContext = createContext<AuthApi | null>(null);

/** Wires the API client to the query cache: CSRF token from `me`, 401 -> session ended. */
export function AuthApiProvider({ children, api }: { children: ReactNode; api?: AuthApi }) {
  const queryClient = useQueryClient();
  const value = useMemo(
    () =>
      api ??
      createAuthApi(
        createApiClient({
          getCsrfToken: () => queryClient.getQueryData<MeState>(ME_KEY)?.csrfToken,
          onSessionEnded: () => endSession(queryClient, 'session_ended'),
        }),
      ),
    [api, queryClient],
  );
  return <AuthApiContext.Provider value={value}>{children}</AuthApiContext.Provider>;
}

export function useAuthApi(): AuthApi {
  const api = useContext(AuthApiContext);
  if (api === null) throw new Error('AuthApiProvider missing');
  return api;
}

/** Resolves to `null` when there is no valid session. */
export function useMe(): UseQueryResult<MeResponse | null> {
  const api = useAuthApi();
  return useQuery<MeResponse | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (isApiError(error) && error.isUnauthenticated) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
