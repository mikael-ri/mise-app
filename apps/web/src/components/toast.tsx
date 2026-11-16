import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';

export const TOAST_DURATION_MS = 4000;

interface ToastApi {
  /** Short confirmation, 4 s, one at a time (a new toast replaces the current one). */
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null);
  const show = useCallback((message: string) => {
    setCurrent((prev) => ({ id: (prev?.id ?? 0) + 1, message }));
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
          </RadixToast.Root>
        )}
        <RadixToast.Viewport className="fixed inset-x-4 bottom-20 z-50 m-0 flex list-none flex-col gap-2 p-0 lg:bottom-4 lg:left-auto lg:w-96" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('ToastProvider missing');
  return api;
}
