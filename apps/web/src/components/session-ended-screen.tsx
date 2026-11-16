import { t } from '../i18n/index.js';
import { ButtonLink } from './button.js';

/** Full-screen "session ended" with a Sign in action (conventions §3). */
export function SessionEndedScreen({ signInHref }: { signInHref: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">{t('app.title')}</h1>
      <p>{t('auth.signin.message.sessionEnded')}</p>
      <ButtonLink href={signInHref}>{t('auth.signin.action')}</ButtonLink>
      <p className="text-sm text-text-muted">{t('auth.signin.securityNote')}</p>
    </main>
  );
}
