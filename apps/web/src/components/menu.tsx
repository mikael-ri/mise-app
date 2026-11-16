import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

const ITEM =
  'flex min-h-11 cursor-pointer items-center rounded-md px-3 py-2 text-base outline-none data-[highlighted]:bg-surface-muted data-[disabled]:opacity-50';

/** Overflow ("...") menu on the Radix dropdown: keyboard operable, focus restored on close. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface text-text"
      >
        <span aria-hidden="true">&hellip;</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  testId,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <DropdownMenu.Item
      className={ITEM}
      onSelect={onSelect}
      {...(disabled === undefined ? {} : { disabled })}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <DropdownMenu.Item asChild className={ITEM}>
      <Link to={to}>{children}</Link>
    </DropdownMenu.Item>
  );
}

export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.CheckboxItem className={ITEM} checked={checked} onCheckedChange={onCheckedChange}>
      <span aria-hidden="true" className="mr-2 inline-block w-4">
        {checked ? '✓' : ''}
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-3 pt-2 text-sm text-text-muted">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  );
}

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem value={value} className={ITEM}>
      <DropdownMenu.ItemIndicator className="mr-2 inline-block w-4" aria-hidden="true">
        &#10003;
      </DropdownMenu.ItemIndicator>
      <span>{children}</span>
    </DropdownMenu.RadioItem>
  );
}
