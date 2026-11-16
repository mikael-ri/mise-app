import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceSession } from '@mise/contracts';
import { useState } from 'react';
import { Button } from '../../components/button.js';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { formatDate, t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { isJustNow, sortDevices } from './devices.js';
import { useAuthApi, useMe } from './use-session.js';

const DEVICES_KEY = ['auth', 'devices'] as const;

function deviceName(device: DeviceSession): string {
  return device.deviceLabel ?? t('devices.row.unknownDevice');
}

function DeviceRow({
  device,
  showMember,
  timeZone,
  onRevoke,
}: {
  device: DeviceSession;
  showMember: boolean;
  timeZone: string | undefined;
  onRevoke: (device: DeviceSession) => void;
}) {
  const dateOptions = timeZone === undefined ? {} : { timeZone };
  return (
    <li
      data-testid="device-row"
      data-current={device.current ? 'true' : undefined}
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium">{deviceName(device)}</p>
        {showMember && (
          <p className="text-sm text-text-muted">
            {t('devices.row.member', { name: device.member.displayName })}
          </p>
        )}
        <p className="text-sm text-text-muted">
          {t('devices.row.signedIn', { date: formatDate(device.createdAt, dateOptions) })}
        </p>
        <p className="text-sm text-text-muted">
          {isJustNow(device.lastSeenAt, Date.now())
            ? t('devices.row.lastActiveNow')
            : t('devices.row.lastActive', { date: formatDate(device.lastSeenAt, dateOptions) })}
        </p>
      </div>
      {device.current ? (
        <span className="rounded-md border border-border px-2 py-1 text-xs font-semibold uppercase">
          {t('devices.row.thisDevice')}
        </span>
      ) : (
        <Button
          variant="secondary"
          data-testid="revoke-device"
          aria-label={t('devices.row.revokeLabel', { name: deviceName(device) })}
          onClick={() => onRevoke(device)}
        >
          {t('devices.row.revoke')}
        </Button>
      )}
    </li>
  );
}

export function DevicesPage() {
  const api = useAuthApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe().data;
  const [target, setTarget] = useState<DeviceSession | null>(null);
  // Kept after close so the dialog title does not blank out during the exit animation.
  const [shownTarget, setShownTarget] = useState<DeviceSession | null>(null);
  const openRevoke = (device: DeviceSession) => {
    setShownTarget(device);
    setTarget(device);
  };

  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: () => api.listDevices() });

  const revoke = useMutation({
    mutationFn: (device: DeviceSession) => api.revokeDevice(device.id),
    // Stale row (e.g. already revoked elsewhere): resync with the server.
    onError: () => void queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
    onSuccess: (_data, device) => {
      queryClient.setQueryData<DeviceSession[]>(DEVICES_KEY, (rows) =>
        rows?.filter((row) => row.id !== device.id),
      );
      setTarget(null);
      toast.show(t('devices.revoke.toast', { name: deviceName(device) }));
    },
  });

  const closeDialog = (open: boolean) => {
    if (open) return;
    setTarget(null);
    revoke.reset();
  };

  return (
    <>
      <PageHeader
        title={t('devices.screen.title')}
        back={{ to: '/settings', label: t('devices.screen.back') }}
      />
      <p className="mb-4 text-text-muted">{t('devices.screen.intro')}</p>

      {devices.isPending && <SkeletonRows testId="devices-loading" />}
      {devices.isError && (
        <ErrorState
          correlationId={isApiError(devices.error) ? devices.error.correlationId : undefined}
          onRetry={() => void devices.refetch()}
        />
      )}
      {devices.isSuccess &&
        (devices.data.length === 0 ? (
          <EmptyState title={t('devices.list.empty.title')} />
        ) : (
          <ul aria-label={t('devices.list.label')} className="flex flex-col gap-3">
            {sortDevices(devices.data).map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                showMember={me != null && device.member.id !== me.member.id}
                timeZone={me?.household.timezone}
                onRevoke={openRevoke}
              />
            ))}
          </ul>
        ))}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={closeDialog}
        title={t('devices.revoke.title', {
          name: shownTarget === null ? '' : deviceName(shownTarget),
        })}
        description={t('devices.revoke.description')}
        confirmLabel={t('devices.revoke.confirm')}
        pending={revoke.isPending}
        error={revoke.isError ? t('devices.revoke.error') : undefined}
        onConfirm={() => target !== null && revoke.mutate(target)}
      />
    </>
  );
}
