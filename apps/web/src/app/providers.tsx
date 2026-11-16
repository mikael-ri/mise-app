import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/toast.js';
import { AuthApiProvider } from '../features/auth/use-session.js';
import { RecipesApiProvider } from '../features/recipes/use-recipes-api.js';
import type { RecipesApi } from '../features/recipes/recipes-api.js';
import type { AuthApi } from '../lib/auth-api.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
}

export function AppProviders({
  children,
  queryClient,
  api,
  recipesApi,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
  api?: AuthApi;
  recipesApi?: RecipesApi;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <AuthApiProvider {...(api === undefined ? {} : { api })}>
        <RecipesApiProvider {...(recipesApi === undefined ? {} : { api: recipesApi })}>
          <ToastProvider>{children}</ToastProvider>
        </RecipesApiProvider>
      </AuthApiProvider>
    </QueryClientProvider>
  );
}
