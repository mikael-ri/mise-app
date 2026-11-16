import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';

/** A 409 is never silent: explain and offer explicit choices (passed as `actions`). */
export function ConflictState({
  title,
  description,
  actions,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-border p-4"
    >
      <p className="font-medium">{title ?? t('common.conflict.title')}</p>
      {description !== undefined && <p className="text-text-muted">{description}</p>}
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
