import { NavLink, Outlet } from 'react-router';
import { UserMenu } from '../components/user-menu.js';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';
import { useMe } from '../features/auth/use-session.js';

const TABS: ReadonlyArray<{ to: string; label: MessageKey }> = [
  { to: '/recipes', label: 'nav.recipes' },
  { to: '/shopping', label: 'nav.shopping' },
  { to: '/settings', label: 'nav.settings' },
];

const TAB_BASE =
  'flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 py-2 text-base font-medium lg:flex-none lg:justify-start';

/**
 * One responsive nav: bottom tab bar under 1024 px, sidebar from 1024 px (conventions §2).
 * Only Milestone A tabs are shown.
 */
export function Shell() {
  const me = useMe().data;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr]">
      <nav
        aria-label={t('nav.label')}
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-border bg-surface p-1 lg:static lg:flex-col lg:gap-2 lg:border-r lg:border-t-0 lg:p-4"
      >
        <p className="hidden px-3 py-2 text-xl font-semibold lg:block">{t('app.title')}</p>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `${TAB_BASE} ${isActive ? 'bg-surface-muted font-semibold underline' : 'text-text'}`
            }
          >
            {t(tab.label)}
          </NavLink>
        ))}
        {me != null && (
          <div className="mt-auto hidden lg:block">
            <UserMenu name={me.user.displayName} />
          </div>
        )}
      </nav>
      <main className="mx-auto w-full max-w-[60rem] p-4 pb-24 lg:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
