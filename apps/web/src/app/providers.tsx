import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/toast.js';
import { AuthApiProvider } from '../features/auth/use-session.js';
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
}: {
  children: ReactNode;
  queryClient?: QueryClient;
  api?: AuthApi;
}) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <AuthApiProvider {...(api === undefined ? {} : { api })}>
        <ToastProvider>{children}</ToastProvider>
      </AuthApiProvider>
    </QueryClientProvider>
  );
}
