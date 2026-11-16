import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddShoppingItemRequest, ShoppingCategory, ShoppingItem } from '@mise/contracts';
import { useRef, useState } from 'react';
import { Button } from '../../components/button.js';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { ConflictState } from '../../components/conflict-state.js';
import { Field, INPUT_CLASS, invalidProps } from '../../components/form-field.js';
import { useToast } from '../../components/toast.js';
import { DEFAULT_LOCALE, t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { useMe } from '../auth/use-session.js';
import { categoryLabel } from './category-label.js';
import {
  buildEditBody,
  formFromItem,
  mergeLatest,
  rememberKey,
  validateForm,
} from './item-form.js';
import type { ItemFormValues } from './item-form.js';
import {
  HOUSEHOLD_TIMEZONE,
  UNIT_CHIPS,
  formatWhen,
  insertUnit,
  sortCategories,
} from './list-model.js';
import { cacheItem, shoppingKeys, uncacheItem } from './queries.js';
import { useShoppingApi } from './use-shopping-api.js';
import type { ShoppingListSnapshot } from '@mise/contracts';

const CHIP =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-surface px-4 text-base text-text';
const SELECT = `${INPUT_CLASS} appearance-auto`;

function readdBody(item: ShoppingItem): AddShoppingItemRequest {
  return {
    name: item.name,
    ...(item.originalQuantityText === null ? {} : { quantityText: item.originalQuantityText }),
    ...(item.note === null ? {} : { note: item.note }),
    ...(item.categoryId === null ? {} : { categoryId: item.categoryId }),
  };
}

/**
 * S4: item details as a bottom sheet (Radix dialog). One free-text quantity (no number/unit split,
 * never parsed back). Stale edit (409) keeps the sheet open; nothing is overwritten silently.
 * Mounted only while open; `initialItem` is the revision the form is based on.
 */
export function ItemSheet({
  initialItem,
  categories,
  focusCategory,
  gone,
  onClose,
}: {
  initialItem: ShoppingItem;
  categories: readonly ShoppingCategory[];
  focusCategory: boolean;
  /** The item disappeared from the live list (deleted by someone else). */
  gone: boolean;
  onClose: () => void;
}) {
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe().data;
  const timeZone = me?.household.timezone ?? HOUSEHOLD_TIMEZONE;
  const [base, setBase] = useState(initialItem);
  const [values, setValues] = useState<ItemFormValues>(() => formFromItem(initialItem));
  const [nameError, setNameError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [failed, setFailed] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  const initial = formFromItem(base);
  const set = (patch: Partial<ItemFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const onWriteError = (error: unknown) => {
    if (isApiError(error) && error.isConflict) {
      setConflict(true);
      setRefreshed(false);
      setFailed(undefined);
    } else if (isApiError(error) && error.status === 404) {
      setFailed(t('shopping.sheet.gone'));
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.snapshot(base.listId) });
    } else {
      setFailed(t('shopping.sheet.saveError'));
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = buildEditBody(initial, values);
      let item = base;
      if (body !== null) {
        item = await api.editItem(base.id, base.revision, body);
        // The edit is stored: a retry after a failed checkoff must not resend it with a stale revision.
        cacheItem(queryClient, item);
        setBase(item);
      }
      if (values.picked !== item.picked) item = await api.setPicked(base.id, values.picked);
      return item;
    },
    onSuccess: (item) => {
      cacheItem(queryClient, item);
      onClose();
    },
    onError: onWriteError,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteItem(base.id, base.revision),
    onSuccess: () => {
      uncacheItem(queryClient, base.listId, base.id);
      const body = readdBody(base);
      // One key per delete: tapping Undo again (or retrying it) replays, never re-adds twice.
      const undoKey = crypto.randomUUID();
      toast.show(t('shopping.sheet.deleteToast', { name: base.name }), {
        label: t('shopping.sheet.undo'),
        onSelect: () => {
          // Undo re-adds the item as a new row with a new idempotency key.
          void api.addItem(base.listId, body, undoKey).then((item) => {
            cacheItem(queryClient, item);
          });
        },
      });
      onClose();
    },
    onError: (error) => {
      setConfirmDelete(false);
      onWriteError(error);
    },
  });

  const showLatest = async () => {
    await queryClient.refetchQueries({ queryKey: shoppingKeys.snapshot(base.listId) });
    const snapshot = queryClient.getQueryData<ShoppingListSnapshot>(
      shoppingKeys.snapshot(base.listId),
    );
    const latest = snapshot?.items.find((i) => i.id === base.id);
    if (latest === undefined) {
      setConflict(false);
      setFailed(t('shopping.sheet.gone'));
      return;
    }
    // Keep what the user changed; refresh only untouched fields (and the revision via `base`).
    const fresh = formFromItem(latest);
    setValues((v) => mergeLatest(initial, v, fresh));
    setBase(latest);
    setRefreshed(true);
    setFailed(undefined);
  };

  const submit = () => {
    if (validateForm(values) === 'nameRequired') {
      setNameError(t('shopping.sheet.nameRequired'));
      return;
    }
    setNameError(undefined);
    setFailed(undefined);
    if (buildEditBody(initial, values) === null && values.picked === base.picked) {
      onClose();
      return;
    }
    save.mutate();
  };

  const onDelete = () => {
    setFailed(undefined);
    if (base.picked) setConfirmDelete(true);
    else remove.mutate();
  };

  const when = (instant: string) => formatWhen(instant, { locale: DEFAULT_LOCALE, timeZone });
  const pickedBy =
    base.picked && base.pickedAt !== null && base.pickedByMemberId !== null
      ? t('shopping.sheet.pickedBy', {
          name:
            base.pickedByMemberId === me?.member.id
              ? t('shopping.sheet.memberYou')
              : t('shopping.sheet.memberOther'),
          when: when(base.pickedAt),
        })
      : null;
  const busy = save.isPending || remove.isPending;

  return (
    <>
      <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay data-modal-overlay="" className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            data-testid="item-sheet"
            onOpenAutoFocus={(event) => {
              if (focusCategory) {
                event.preventDefault();
                categoryRef.current?.focus();
              }
            }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 shadow-lg"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <Dialog.Title className="text-lg font-semibold">{base.name}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="secondary" aria-label={t('shopping.sheet.close')}>
                  <span aria-hidden="true">&times;</span>
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">{t('shopping.list.items')}</Dialog.Description>

            {conflict && (
              <div className="mb-3" data-testid="item-conflict">
                <ConflictState
                  title={t('shopping.item.conflict', { name: t('shopping.sheet.memberOther') })}
                  {...(refreshed
                    ? { description: t('shopping.item.refreshed') }
                    : {
                        actions: (
                          <Button variant="secondary" onClick={() => void showLatest()}>
                            {t('shopping.item.showLatest')}
                          </Button>
                        ),
                      })}
                />
              </div>
            )}
            {(failed !== undefined || gone) && (
              <p role="alert" className="mb-3 text-danger">
                <span aria-hidden="true">! </span>
                {failed ?? t('shopping.sheet.gone')}
              </p>
            )}

            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
              className="flex flex-col gap-3"
            >
              <Field id="item-name" label={t('shopping.sheet.name')} error={nameError}>
                <input
                  {...invalidProps('item-name', nameError)}
                  className={INPUT_CLASS}
                  value={values.name}
                  maxLength={200}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </Field>
              <Field id="item-quantity" label={t('shopping.sheet.quantity')}>
                <input
                  id="item-quantity"
                  ref={quantityRef}
                  className={INPUT_CLASS}
                  value={values.quantity}
                  maxLength={100}
                  placeholder={t('shopping.sheet.quantityPlaceholder')}
                  onChange={(e) => set({ quantity: e.target.value })}
                />
              </Field>
              <div
                role="group"
                aria-label={t('shopping.sheet.units')}
                className="flex flex-wrap gap-2"
              >
                {UNIT_CHIPS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={CHIP}
                    onClick={() => set({ quantity: insertUnit(values.quantity, unit) })}
                  >
                    {unit}
                  </button>
                ))}
              </div>
              <Field id="item-note" label={t('shopping.sheet.note')}>
                <input
                  id="item-note"
                  className={INPUT_CLASS}
                  value={values.note}
                  maxLength={500}
                  onChange={(e) => set({ note: e.target.value })}
                />
              </Field>
              <Field id="item-category" label={t('shopping.sheet.category')}>
                <select
                  id="item-category"
                  ref={categoryRef}
                  className={SELECT}
                  value={values.categoryId}
                  aria-describedby="item-category-hint"
                  onChange={(e) => set({ categoryId: e.target.value })}
                >
                  <option value="">{t('shopping.sheet.categoryAutomatic')}</option>
                  {sortCategories(categories).map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
                <p id="item-category-hint" className="text-sm text-text-muted">
                  {t('shopping.sheet.remember', { name: rememberKey(base, values.name) })}
                </p>
              </Field>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-6"
                  checked={values.picked}
                  onChange={(e) => set({ picked: e.target.checked })}
                />
                {t('shopping.sheet.picked')}
              </label>

              <div className="text-sm text-text-muted">
                <p>{t('shopping.sheet.addedAt', { when: when(base.createdAt) })}</p>
                {pickedBy !== null && <p>{pickedBy}</p>}
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="secondary" onClick={onDelete} disabled={busy}>
                  {t('shopping.sheet.delete')}
                </Button>
                <Button type="submit" disabled={busy || (conflict && !refreshed) || gone}>
                  {t('shopping.sheet.save')}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('shopping.sheet.deleteTitle', { name: base.name })}
        description={t('shopping.sheet.deleteDescription')}
        confirmLabel={t('shopping.sheet.deleteConfirm')}
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
      />
    </>
  );
}
