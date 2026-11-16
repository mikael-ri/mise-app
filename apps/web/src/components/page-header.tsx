import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function PageHeader({
  title,
  back,
  actions,
}: {
  title: string;
  back?: { to: string; label: string };
  /** Right-aligned header actions, e.g. an overflow menu. */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex min-h-11 items-center gap-3">
      {back !== undefined && (
        <Link to={back.to} className="inline-flex min-h-11 items-center gap-1 pr-2 text-primary">
          <span aria-hidden="true">&lsaquo;</span>
          {back.label}
        </Link>
      )}
      <h1 className="text-xl font-semibold">{title}</h1>
      {actions !== undefined && <div className="ml-auto">{actions}</div>}
    </header>
  );
}
