import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi, renderApp } from '../../test/render-app.js';

describe('settings home (FR-30)', () => {
  it('shows the member name and a Devices link', async () => {
    renderApp('/settings');
    expect(await screen.findByText('Signed in as Anna')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Devices/ })).toHaveAttribute(
      'href',
      '/settings/devices',
    );
  });

  it('signing out ends only this device and lands on /signin with the signed-out message', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const { router } = renderApp('/settings', fakeApi({ logout }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out of this device' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect(router.state.location.search).toBe('?reason=signed_out');
    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
  });

  it('shows an error when sign-out fails', async () => {
    renderApp('/settings', fakeApi({ logout: async () => Promise.reject(new Error('x')) }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out of this device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out. Try again.');
  });
});
