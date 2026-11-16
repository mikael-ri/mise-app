import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';

export const TOAST_DURATION_MS = 4000;

export interface ToastAction {
  label: string;
  onSelect: () => void;
}

interface ToastApi {
  /** Short confirmation, 4 s, one at a time (a new toast replaces the current one). */
  show: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{
    id: number;
    message: string;
    action?: ToastAction;
  } | null>(null);
  const show = useCallback((message: string, action?: ToastAction) => {
    setCurrent((prev) => ({
      id: (prev?.id ?? 0) + 1,
      message,
      ...(action === undefined ? {} : { action }),
    }));
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider duration={TOAST_DURATION_MS} label={t('toast.close')}>
        {children}
        {current !== null && (
          <RadixToast.Root
            key={current.id}
            data-testid="toast"
            defaultOpen
            onOpenChange={(open) => {
              if (!open) setCurrent(null);
            }}
            className="rounded-lg border border-border bg-surface px-4 py-3 shadow-lg"
          >
            <RadixToast.Description>{current.message}</RadixToast.Description>
            {current.action !== undefined && (
              <RadixToast.Action
                altText={current.action.label}
                onClick={current.action.onSelect}
                className="mt-2 inline-flex min-h-11 min-w-11 items-center rounded-lg border border-border px-4 font-medium text-primary"
              >
                {current.action.label}
              </RadixToast.Action>
            )}
          </RadixToast.Root>
        )}
        <RadixToast.Viewport className="fixed inset-x-4 bottom-[var(--toast-offset,5rem)] z-50 m-0 flex list-none flex-col gap-2 p-0 lg:bottom-[var(--toast-offset-lg,1rem)] lg:left-auto lg:w-96" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('ToastProvider missing');
  return api;
}
