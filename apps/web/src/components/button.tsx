import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const BASE =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4 py-2 text-base font-medium disabled:opacity-60';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-text',
  secondary: 'border border-border bg-surface text-text',
  danger: 'bg-danger text-danger-text',
};

export function buttonClass(variant: Variant = 'primary'): string {
  return `${BASE} ${VARIANTS[variant]}`;
}

export function Button({
  variant,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonClass(variant)} ${className ?? ''}`} {...props} />;
}

/** A real link that looks like a button (navigation, e.g. the OIDC redirect). */
export function ButtonLink({
  variant,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${buttonClass(variant)} ${className ?? ''}`} {...props} />;
}
