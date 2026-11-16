import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe.js';
import { fakeApi, renderApp } from '../test/render-app.js';

describe('app shell (NFR-05)', () => {
  it('has exactly the three Milestone A tabs and no axe violations', async () => {
    const { container } = renderApp('/recipes');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Recipes', 'Shopping', 'Settings']);
    expect(within(nav).getByRole('link', { name: 'Recipes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoAxeViolations(container);
  });

  it('settings and devices screens have no axe violations', async () => {
    const settings = renderApp('/settings');
    await screen.findByText('Signed in as Anna');
    await expectNoAxeViolations(settings.container);
    settings.unmount();
    const devices = renderApp('/settings/devices');
    await screen.findByText('No devices to show');
    await expectNoAxeViolations(devices.container);
  });

  it('unknown routes show a not-found state inside the shell', async () => {
    renderApp('/nope');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});

describe('sidebar user menu', () => {
  it('opens with name, Devices link and Sign out; sign out ends the session', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const { router } = renderApp('/recipes', api);
    await user.click(await screen.findByRole('button', { name: 'Account menu for Anna' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Anna')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Devices' })).toHaveAttribute(
      'href',
      '/settings/devices',
    );
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect(router.state.location.search).toContain('reason=signed_out');
  });

  it('opens from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('/recipes');
    const trigger = await screen.findByRole('button', { name: 'Account menu for Anna' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});
