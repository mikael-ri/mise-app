import { useSearchParams } from 'react-router';
import { ButtonLink } from '../../components/button.js';
import { SessionEndedScreen } from '../../components/session-ended-screen.js';
import { t } from '../../i18n/index.js';
import { resolveSignInView } from './signin-view.js';

/** Signed-out landing and its message variants (auth-and-devices.md A1). */
export function SignInPage() {
  const [params] = useSearchParams();
  const view = resolveSignInView(params);

  if (view.variant === 'session_ended') return <SessionEndedScreen signInHref={view.signInHref} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">{t('app.title')}</h1>
      <p className="text-text-muted">{t('auth.signin.tagline')}</p>
      {view.message !== null && (
        <p role={view.variant === 'signed_out' ? 'status' : 'alert'}>{t(view.message)}</p>
      )}
      {view.correlationId !== undefined && (
        <p className="text-xs text-text-muted">
          {t('common.error.correlationId', { id: view.correlationId })}
        </p>
      )}
      {view.showSignIn && (
        <>
          <ButtonLink href={view.signInHref}>{t('auth.signin.action')}</ButtonLink>
          <p className="text-sm text-text-muted">{t('auth.signin.securityNote')}</p>
        </>
      )}
    </main>
  );
}
