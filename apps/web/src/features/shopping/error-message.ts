import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';

/** Specific copy for a failed load as ErrorState props; empty falls back to the generic title. */
export function loadErrorProps(error: unknown): { message: string } | Record<never, never> {
  if (!isApiError(error)) return {};
  if (error.status === 404) return { message: t('shopping.list.notFound') };
  if (error.code === 'network_error') return { message: t('common.error.network') };
  return {};
}
