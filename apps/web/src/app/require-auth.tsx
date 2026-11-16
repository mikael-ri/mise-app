import { ReturnToPath } from '@mise/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState } from '../components/error-state.js';
import { SkeletonRows } from '../components/skeleton.js';
import { useMe } from '../features/auth/use-session.js';
import { isApiError } from '../lib/api-client.js';
import { readSessionEnd } from '../lib/session.js';

/** Same-origin path to return to after sign-in, or undefined when it is invalid or /signin itself. */
export function toReturnTo(pathname: string, search: string): string | undefined {
  const candidate = `${pathname}${search}`;
  if (pathname === '/signin' || pathname === '/login') return undefined;
  const parsed = ReturnToPath.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function signInPath(options: { returnTo?: string | undefined; reason?: string }): string {
  const params = new URLSearchParams();
  if (options.returnTo !== undefined) params.set('returnTo', options.returnTo);
  if (options.reason !== undefined) params.set('reason', options.reason);
  const query = params.toString();
  return query === '' ? '/signin' : `/signin?${query}`;
}

/** Route guard: signed-out visitors go to /signin?returnTo=<path>. */
export function RequireAuth() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const me = useMe();

  if (me.isPending) return <SkeletonRows rows={2} testId="auth-loading" />;
  if (me.isError) {
    return (
      <ErrorState
        correlationId={isApiError(me.error) ? me.error.correlationId : undefined}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (me.data === null) {
    const reason = readSessionEnd(queryClient);
    const returnTo =
      reason === 'signed_out' ? undefined : toReturnTo(location.pathname, location.search);
    return (
      <Navigate
        replace
        to={signInPath({ returnTo, ...(reason === undefined ? {} : { reason }) })}
      />
    );
  }
  return <Outlet />;
}
