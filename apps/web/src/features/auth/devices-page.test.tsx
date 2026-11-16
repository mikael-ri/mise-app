import type { MemberId } from '@mise/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import { device } from '../../test/fixtures.js';
import { fakeApi, renderApp } from '../../test/render-app.js';

const CURRENT = device({ id: '10000000-0000-4000-8000-000000000001', current: true });
const IPHONE = device({
  id: '10000000-0000-4000-8000-000000000002',
  deviceLabel: 'iPhone - Safari',
  lastSeenAt: '2026-10-26T09:00:00Z',
});
const OTHER_MEMBER = device({
  id: '10000000-0000-4000-8000-000000000003',
  deviceLabel: 'Laptop - Firefox',
  lastSeenAt: '2026-10-25T09:00:00Z',
  member: { id: '55555555-5555-4555-8555-555555555555' as MemberId, displayName: 'Bea' },
});

describe('devices screen (FR-30, AC-11)', () => {
  it('shows loading skeletons first', async () => {
    renderApp('/settings/devices', fakeApi({ listDevices: () => new Promise(() => {}) }));
    expect(await screen.findByTestId('devices-loading')).toBeInTheDocument();
  });

  it('marks the current device first without a Revoke button; shows member name on others', async () => {
    renderApp(
      '/settings/devices',
      fakeApi({ listDevices: async () => [OTHER_MEMBER, IPHONE, CURRENT] }),
    );
    const rows = await screen.findAllByTestId('device-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Pixel 8 - Chrome')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('This device')).toBeInTheDocument();
    expect(within(rows[0]!).queryByTestId('revoke-device')).not.toBeInTheDocument();
    expect(within(rows[0]!).queryByText(/Member:/)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('iPhone - Safari')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Member: Bea')).toBeInTheDocument();
    expect(screen.getAllByTestId('revoke-device')).toHaveLength(2);
  });

  it('revoke flow: confirm dialog names the device, row disappears, toast confirms', async () => {
    const revokeDevice = vi.fn().mockResolvedValue(undefined);
    renderApp(
      '/settings/devices',
      fakeApi({ listDevices: async () => [CURRENT, IPHONE], revokeDevice }),
    );
    const user = userEvent.setup();
    await screen.findAllByTestId('device-row');
    await user.click(screen.getByTestId('revoke-device'));

    const dialog = await screen.findByRole('dialog', { name: 'Revoke "iPhone - Safari"?' });
    expect(
      within(dialog).getByText('It will be signed out immediately and must sign in again.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.getAllByTestId('device-row')).toHaveLength(1));
    expect(revokeDevice).toHaveBeenCalledWith(IPHONE.id);
    expect(await screen.findByTestId('toast')).toHaveTextContent('Revoked "iPhone - Safari".');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancel in the confirm dialog revokes nothing', async () => {
    const revokeDevice = vi.fn();
    renderApp(
      '/settings/devices',
      fakeApi({ listDevices: async () => [CURRENT, IPHONE], revokeDevice }),
    );
    const user = userEvent.setup();
    await screen.findAllByTestId('device-row');
    await user.click(screen.getByTestId('revoke-device'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(revokeDevice).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('device-row')).toHaveLength(2);
  });

  it('shows an error in the dialog when revoke fails and keeps the row', async () => {
    renderApp(
      '/settings/devices',
      fakeApi({
        listDevices: async () => [CURRENT, IPHONE],
        revokeDevice: async () => Promise.reject(new Error('boom')),
      }),
    );
    const user = userEvent.setup();
    await screen.findAllByTestId('device-row');
    await user.click(screen.getByTestId('revoke-device'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not revoke this device. Try again.',
    );
    expect(screen.getAllByTestId('device-row')).toHaveLength(2);
  });

  it('error state with Try again and correlationId; retry loads the list', async () => {
    const listDevices = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ status: 500, code: 'internal_error', message: 'x', correlationId: 'c-7' }),
      )
      .mockResolvedValue([CURRENT]);
    renderApp('/settings/devices', fakeApi({ listDevices }));
    const user = userEvent.setup();
    expect(await screen.findByText('Reference: c-7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('device-row')).toBeInTheDocument();
  });

  it('empty list shows a plain explanation', async () => {
    renderApp('/settings/devices', fakeApi({ listDevices: async () => [] }));
    expect(await screen.findByText('No devices to show')).toBeInTheDocument();
  });
});
