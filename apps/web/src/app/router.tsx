import { createBrowserRouter, createMemoryRouter, Link, Navigate, useLocation } from 'react-router';
import type { RouteObject } from 'react-router';
import { buttonClass } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { PageHeader } from '../components/page-header.js';
import { DevicesPage } from '../features/auth/devices-page.js';
import { SettingsPage } from '../features/auth/settings-page.js';
import { SignInPage } from '../features/auth/signin-page.js';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';
import { RequireAuth } from './require-auth.js';
import { Shell } from './shell.js';

/** Legacy /login links: keep the query and show /signin (the server now redirects to /signin directly). */
function LoginRedirect() {
  const { search } = useLocation();
  return <Navigate replace to={`/signin${search}`} />;
}

/** Tab target only; the real screens arrive in A12 and A15. */
function PlaceholderPage({ titleKey }: { titleKey: MessageKey }) {
  return <PageHeader title={t(titleKey)} />;
}

function NotFoundPage() {
  return (
    <EmptyState
      title={t('app.notFound.title')}
      action={
        <Link to="/recipes" className={buttonClass()}>
          {t('app.notFound.action')}
        </Link>
      }
    />
  );
}

export const routes: RouteObject[] = [
  { path: '/signin', element: <SignInPage /> },
  { path: '/login', element: <LoginRedirect /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: '/', element: <Navigate replace to="/recipes" /> },
          { path: '/recipes', element: <PlaceholderPage titleKey="nav.recipes" /> },
          { path: '/shopping', element: <PlaceholderPage titleKey="nav.shopping" /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/settings/devices', element: <DevicesPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

export function createTestRouter(initialEntries: string[]) {
  return createMemoryRouter(routes, { initialEntries });
}
