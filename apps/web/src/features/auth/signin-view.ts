import { API_PREFIX, ReturnToPath } from '@mise/contracts';
import type { MessageKey } from '../../i18n/index.js';

export type SignInVariant =
  'default' | 'session_ended' | 'signed_out' | 'not_provisioned' | 'failed' | 'unexpected';

export interface SignInView {
  variant: SignInVariant;
  message: MessageKey | null;
  /** No retry loop for an account that is not provisioned: the button is hidden. */
  showSignIn: boolean;
  correlationId: string | undefined;
  /** Start of the OIDC redirect (full-page navigation, handled by the server). */
  signInHref: string;
}

const MESSAGES: Record<SignInVariant, MessageKey | null> = {
  default: null,
  session_ended: 'auth.signin.message.sessionEnded',
  signed_out: 'auth.signin.message.signedOut',
  not_provisioned: 'auth.signin.message.notProvisioned',
  failed: 'auth.signin.message.failed',
  unexpected: 'auth.signin.message.unexpected',
};

function variantOf(error: string | null, reason: string | null): SignInVariant {
  if (error === 'not_provisioned') return 'not_provisioned';
  if (error === 'signin_failed') return 'failed';
  if (error === 'unexpected') return 'unexpected';
  if (reason === 'session_ended') return 'session_ended';
  if (reason === 'signed_out') return 'signed_out';
  return 'default';
}

/** Pure mapping from the /signin query string to what the page shows. */
export function resolveSignInView(params: URLSearchParams): SignInView {
  const variant = variantOf(params.get('error'), params.get('reason'));
  const rawReturnTo = params.get('returnTo');
  const parsed = rawReturnTo === null ? null : ReturnToPath.safeParse(rawReturnTo);
  const returnTo =
    parsed?.success === true && !/^\/(signin|login)(\/|\?|$)/.test(parsed.data)
      ? parsed.data
      : undefined;
  const rawCorrelation = params.get('correlationId');
  const correlationId =
    variant === 'unexpected' &&
    rawCorrelation !== null &&
    /^[A-Za-z0-9_-]+$/.test(rawCorrelation.slice(0, 64))
      ? rawCorrelation.slice(0, 64)
      : undefined;
  const query = returnTo === undefined ? '' : `?${new URLSearchParams({ returnTo }).toString()}`;
  return {
    variant,
    message: MESSAGES[variant],
    showSignIn: variant !== 'not_provisioned',
    correlationId,
    signInHref: `${API_PREFIX}/auth/oidc/start${query}`,
  };
}
