import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link } from 'react-router';
import { t } from '../i18n/index.js';
import { useSignOut } from '../features/auth/use-sign-out.js';

const ITEM =
  'flex min-h-11 cursor-pointer items-center rounded-md px-3 py-2 text-base outline-none data-[highlighted]:bg-surface-muted';

/** Sidebar account menu (desktop only; mobile uses the settings tab). */
export function UserMenu({ name }: { name: string }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('nav.userMenu.label', { name })}
        className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-base text-text hover:bg-surface-muted"
      >
        <span>{t('nav.user', { name })}</span>
        <span aria-hidden="true">&#9662;</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-2 text-sm text-text-muted">
            {t('nav.user', { name })}
          </DropdownMenu.Label>
          <DropdownMenu.Item asChild className={ITEM}>
            <Link to="/settings/devices">{t('nav.userMenu.devices')}</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => signOut.mutate()}>
            {t('nav.userMenu.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
