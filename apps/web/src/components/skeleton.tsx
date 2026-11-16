import { t } from '../i18n/index.js';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-muted ${className ?? 'h-4 w-full'}`}
    />
  );
}

/** Skeleton rows for a loading list; announces "Loading" once to assistive tech. */
export function SkeletonRows({ rows = 3, testId }: { rows?: number; testId?: string }) {
  return (
    <div role="status" data-testid={testId} className="flex flex-col gap-3">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="mb-2 h-5 w-2/3" />
          <Skeleton className="mb-2 h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}
