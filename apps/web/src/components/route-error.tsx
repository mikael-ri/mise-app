import { useRouteError } from 'react-router';
import { t } from '../i18n/index.js';
import { ErrorState } from './error-state.js';

/** Route-level error (e.g. a chunk that failed to load): inline error with Try again, no stack trace. */
export function RouteError() {
  useRouteError();
  return (
    <ErrorState message={t('common.error.network')} onRetry={() => window.location.reload()} />
  );
}
