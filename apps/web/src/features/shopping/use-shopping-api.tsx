import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createApiClient } from '../../lib/api-client.js';
import { ME_KEY, endSession } from '../../lib/session.js';
import type { MeState } from '../../lib/session.js';
import { createShoppingApi } from './shopping-api.js';
import type { ShoppingApi } from './shopping-api.js';

const ShoppingApiContext = createContext<ShoppingApi | null>(null);

/** Same client wiring as the auth API: CSRF token from `me`, 401 -> session ended. */
export function ShoppingApiProvider({ children, api }: { children: ReactNode; api?: ShoppingApi }) {
  const queryClient = useQueryClient();
  const value = useMemo(
    () =>
      api ??
      createShoppingApi(
        createApiClient({
          getCsrfToken: () => queryClient.getQueryData<MeState>(ME_KEY)?.csrfToken,
          onSessionEnded: () => endSession(queryClient, 'session_ended'),
        }),
      ),
    [api, queryClient],
  );
  return <ShoppingApiContext.Provider value={value}>{children}</ShoppingApiContext.Provider>;
}

export function useShoppingApi(): ShoppingApi {
  const api = useContext(ShoppingApiContext);
  if (api === null) throw new Error('ShoppingApiProvider missing');
  return api;
}
