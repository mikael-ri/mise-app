import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AppProviders, createQueryClient } from '../app/providers.js';
import { createTestRouter } from '../app/router.js';
import { ApiError } from '../lib/api-client.js';
import type { AuthApi } from '../lib/auth-api.js';
import { ME } from './fixtures.js';

export const unauthenticated = () =>
  new ApiError({
    status: 401,
    code: 'unauthenticated',
    message: 'no session',
    correlationId: 'c-1',
  });

export function fakeApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    me: vi.fn().mockResolvedValue(ME),
    logout: vi.fn().mockResolvedValue(undefined),
    listDevices: vi.fn().mockResolvedValue([]),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function renderApp(entry: string, api: AuthApi | 'real' = fakeApi()) {
  const queryClient = createQueryClient();
  const router = createTestRouter([entry]);
  const view = render(
    <AppProviders queryClient={queryClient} {...(api === 'real' ? {} : { api })}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, queryClient, api };
}
