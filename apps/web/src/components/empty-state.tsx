import type { ReactNode } from 'react';

/** Plain explanation plus one primary action (conventions §3). */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="text-lg font-medium">{title}</p>
      {description !== undefined && <p className="text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
