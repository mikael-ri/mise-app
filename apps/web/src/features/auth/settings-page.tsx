import { Link } from 'react-router';
import { Button, buttonClass } from '../../components/button.js';
import { PageHeader } from '../../components/page-header.js';
import { t } from '../../i18n/index.js';
import { useMe } from './use-session.js';
import { useSignOut } from './use-sign-out.js';

export function SettingsPage() {
  const me = useMe().data;
  const signOut = useSignOut();

  return (
    <>
      <PageHeader title={t('settings.home.title')} />
      {me != null && (
        <p className="mb-4">{t('settings.home.signedInAs', { name: me.user.displayName })}</p>
      )}
      <div className="flex flex-col items-stretch gap-3 sm:max-w-sm">
        <Link to="/settings/devices" className={`${buttonClass('secondary')} justify-between`}>
          {t('settings.home.devices')}
          <span aria-hidden="true">&rsaquo;</span>
        </Link>
        <Button variant="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          {t('settings.home.signOut')}
        </Button>
        {signOut.isError && (
          <p role="alert" className="text-danger">
            {t('settings.home.signOutError')}
          </p>
        )}
      </div>
    </>
  );
}
