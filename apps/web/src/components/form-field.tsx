import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-text aria-invalid:border-danger';

/** Label above the input, error text with an icon next to it (never colour alone). */
export function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      )}
    </div>
  );
}

/** aria props tying an input to its error message. */
export function invalidProps(id: string, error: string | undefined) {
  return error === undefined
    ? ({ id } as const)
    : ({ id, 'aria-invalid': true, 'aria-describedby': `${id}-error` } as const);
}
