import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api-client.js';
import { ME } from '../test/fixtures.js';
import { fakeApi, renderApp, unauthenticated } from '../test/render-app.js';
import { signInPath, toReturnTo } from './require-auth.js';

describe('return path (FR-30)', () => {
  it.each([
    ['/settings/devices', '', '/settings/devices'],
    ['/recipes', '?q=pata', '/recipes?q=pata'],
    ['/signin', '', undefined],
    ['//evil.example', '', undefined],
    ['/ok', '?x=a b', undefined],
  ])('toReturnTo(%s, %s) = %s', (pathname, search, expected) => {
    expect(toReturnTo(pathname, search)).toBe(expected);
  });

  it('builds the sign-in path', () => {
    expect(signInPath({})).toBe('/signin');
    expect(signInPath({ returnTo: '/a?b=1', reason: 'session_ended' })).toBe(
      '/signin?returnTo=%2Fa%3Fb%3D1&reason=session_ended',
    );
  });
});

describe('route guard (FR-30, AC-11)', () => {
  it('redirects a signed-out deep link to /signin with a same-origin returnTo', async () => {
    const { router } = renderApp(
      '/settings/devices',
      fakeApi({ me: async () => Promise.reject(unauthenticated()) }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect(router.state.location.search).toBe('?returnTo=%2Fsettings%2Fdevices');
  });

  it('redirects / to /recipes when signed in', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/recipes'));
    expect(await screen.findByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
  });

  it('shows an error with Try again and correlationId when me fails for another reason', async () => {
    renderApp(
      '/recipes',
      fakeApi({
        me: async () =>
          Promise.reject(
            new ApiError({
              status: 500,
              code: 'internal_error',
              message: 'x',
              correlationId: 'c-9',
            }),
          ),
      }),
    );
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Reference: c-9')).toBeInTheDocument();
  });

  it('a 401 after sign-in routes to /signin with the session-ended message (real client)', async () => {
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.endsWith('/auth/me')
          ? json(ME, 200)
          : json({ code: 'unauthenticated', message: 'x', correlationId: 'c' }, 401),
      ),
    );
    const { router } = renderApp('/settings/devices', 'real');
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect(router.state.location.search).toContain('reason=session_ended');
    expect(await screen.findByText('Your session has ended. Sign in again.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
