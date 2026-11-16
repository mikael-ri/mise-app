import { Link } from 'react-router';

export function PageHeader({
  title,
  back,
}: {
  title: string;
  back?: { to: string; label: string };
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
    </header>
  );
}
