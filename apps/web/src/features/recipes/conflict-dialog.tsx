import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../../components/button.js';
import { t } from '../../i18n/index.js';

export type ConflictStep = 'choose' | 'confirm';

/**
 * R3a: someone else saved while the user was editing. Three explicit choices; "Save mine as newest"
 * needs a second confirmation line. Closing the dialog (Escape) keeps the draft and the form.
 */
export function ConflictDialog({
  open,
  step,
  pending,
  again,
  error,
  onClose,
  onOpenLatest,
  onAskSaveMine,
  onBack,
  onSaveMine,
  onDiscard,
}: {
  open: boolean;
  step: ConflictStep;
  pending: boolean;
  /** A second conflict happened while saving on top of the latest version. */
  again: boolean;
  error: string | undefined;
  onClose: () => void;
  onOpenLatest: () => void;
  onAskSaveMine: () => void;
  onBack: () => void;
  onSaveMine: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay data-modal-overlay="" className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          data-testid="conflict-dialog"
          className="fixed left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg"
        >
          <Dialog.Title className="mb-2 text-lg font-semibold">
            {t('recipes.conflict.title')}
          </Dialog.Title>
          <Dialog.Description className="mb-4 text-text-muted">
            {step === 'confirm'
              ? t('recipes.conflict.confirmLine')
              : t('recipes.conflict.description')}
          </Dialog.Description>
          {again && step === 'choose' && (
            <p role="alert" className="mb-3 text-danger">
              <span aria-hidden="true">! </span>
              {t('recipes.conflict.again')}
            </p>
          )}
          {error !== undefined && (
            <p role="alert" className="mb-3 text-danger">
              <span aria-hidden="true">! </span>
              {error}
            </p>
          )}
          {step === 'choose' ? (
            <div className="flex flex-col gap-2">
              <Button onClick={onOpenLatest}>{t('recipes.conflict.openLatest')}</Button>
              <Button variant="secondary" onClick={onAskSaveMine}>
                {t('recipes.conflict.saveMine')}
              </Button>
              <Button variant="danger" onClick={onDiscard}>
                {t('recipes.conflict.discard')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button disabled={pending} onClick={onSaveMine}>
                {t('recipes.conflict.saveMineConfirm')}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={onBack}>
                {t('recipes.conflict.back')}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
