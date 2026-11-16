import { t } from '../i18n/index.js';
import { Button } from './button.js';

/** Inline error with Try again and the correlationId in small text. No stack traces. */
export function ErrorState({
  message,
  correlationId,
  onRetry,
}: {
  message?: string;
  correlationId?: string | undefined;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-danger p-4"
    >
      <p className="font-medium">
        <span aria-hidden="true">! </span>
        {message ?? t('common.error.title')}
      </p>
      {onRetry !== undefined && <Button onClick={onRetry}>{t('common.tryAgain')}</Button>}
      {correlationId !== undefined && (
        <p className="text-xs text-text-muted">
          {t('common.error.correlationId', { id: correlationId })}
        </p>
      )}
    </div>
  );
}
