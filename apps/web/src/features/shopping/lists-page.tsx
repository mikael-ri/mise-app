import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShoppingList } from '@mise/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/button.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { Field, INPUT_CLASS, invalidProps } from '../../components/form-field.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { formatDate, t, DEFAULT_LOCALE } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { useMe } from '../auth/use-session.js';
import { loadErrorProps } from './error-message.js';
import { HOUSEHOLD_TIMEZONE, formatUpdated } from './list-model.js';
import { shoppingKeys, useLists } from './queries.js';
import { useShoppingApi } from './use-shopping-api.js';

function useUpdatedLabel(): (list: ShoppingList) => string {
  const timeZone = useMe().data?.household.timezone ?? HOUSEHOLD_TIMEZONE;
  return (list) =>
    t('shopping.lists.updated', {
      when: formatUpdated(list.updatedAt, new Date(), { locale: DEFAULT_LOCALE, timeZone }),
    });
}

function ListCard({
  list,
  updated,
  action,
}: {
  list: ShoppingList;
  updated: string;
  action?: ReactNode;
}) {
  return (
    <li
      data-testid="shopping-list-card"
      className="flex items-center gap-2 rounded-lg border border-border bg-surface"
    >
      <Link to={`/shopping/${list.id}`} className="flex min-h-11 flex-1 flex-col gap-1 p-4">
        <span className="text-lg font-medium">{list.name}</span>
        <span className="text-sm text-text-muted">{updated}</span>
      </Link>
      {action !== undefined && <div className="pr-3">{action}</div>}
    </li>
  );
}

function NewListDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const keyRef = useRef<{ name: string; key: string } | null>(null);

  const create = useMutation({
    mutationFn: (listName: string) => {
      // Same name = same retry: replay instead of creating a second list.
      if (keyRef.current?.name !== listName) {
        keyRef.current = { name: listName, key: crypto.randomUUID() };
      }
      return api.createList({ name: listName }, keyRef.current.key);
    },
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
      onOpenChange(false);
      void navigate(`/shopping/${list.id}`);
    },
  });

  useEffect(() => {
    if (!open) return;
    setName(t('shopping.lists.newDefaultName', { date: formatDate(new Date()) }));
    setError(undefined);
    create.reset();
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('shopping.sheet.nameRequired'));
      return;
    }
    setError(undefined);
    create.mutate(trimmed);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-modal-overlay="" className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg">
          <Dialog.Title className="mb-3 text-lg font-semibold">
            {t('shopping.lists.newTitle')}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('shopping.lists.nameLabel')}
          </Dialog.Description>
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <Field id="new-list-name" label={t('shopping.lists.nameLabel')} error={error}>
              <input
                {...invalidProps('new-list-name', error)}
                className={INPUT_CLASS}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            {create.isError && (
              <p role="alert" className="text-danger">
                <span aria-hidden="true">! </span>
                {t('shopping.lists.createError')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" disabled={create.isPending}>
                {t('shopping.lists.create')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** S1: lists index. The list summary carries no item counts, so cards show name and time only. */
export function ShoppingListsPage() {
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const active = useLists('active');
  const archived = useLists('archived');
  const updated = useUpdatedLabel();
  const [newOpen, setNewOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [restoreError, setRestoreError] = useState(false);

  const restore = useMutation({
    mutationFn: (list: ShoppingList) => api.patchList(list.id, list.revision, { status: 'active' }),
    onSuccess: (list) => {
      setRestoreError(false);
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
      toast.show(t('shopping.lists.restoreToast', { name: list.name }));
    },
    onError: () => {
      setRestoreError(true);
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
    },
  });

  const newButton = (
    <Button onClick={() => setNewOpen(true)} data-testid="new-list">
      <span aria-hidden="true">+ </span>
      {t('shopping.lists.new')}
    </Button>
  );

  const lists = [...(active.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const archivedLists = archived.data ?? [];

  let body: ReactNode;
  if (active.isPending) body = <SkeletonRows testId="shopping-lists-loading" />;
  else if (active.isError) {
    body = (
      <ErrorState
        {...loadErrorProps(active.error)}
        correlationId={isApiError(active.error) ? active.error.correlationId : undefined}
        onRetry={() => void active.refetch()}
      />
    );
  } else if (lists.length === 0) {
    body = <EmptyState title={t('shopping.lists.empty.title')} action={newButton} />;
  } else {
    body = (
      <ul aria-label={t('shopping.lists.label')} className="flex flex-col gap-3">
        {lists.map((list) => (
          <ListCard key={list.id} list={list} updated={updated(list)} />
        ))}
      </ul>
    );
  }

  return (
    <div className="mx-auto max-w-[40rem]">
      <PageHeader title={t('shopping.lists.title')} />
      {body}
      {archivedLists.length > 0 && (
        <section className="mt-6">
          <h2>
            <button
              type="button"
              aria-expanded={showArchived}
              {...(showArchived ? { 'aria-controls': 'archived-lists' } : {})}
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-left text-base font-medium"
            >
              {t('shopping.lists.archivedToggle', { count: archivedLists.length })}
              <span aria-hidden="true">{showArchived ? 'v' : '>'}</span>
            </button>
          </h2>
          {showArchived && (
            <div id="archived-lists">
              {restoreError && (
                <p role="alert" className="mb-2 text-danger">
                  <span aria-hidden="true">! </span>
                  {t('shopping.lists.restoreError')}
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {archivedLists.map((list) => (
                  <ListCard
                    key={list.id}
                    list={list}
                    updated={updated(list)}
                    action={
                      <Button
                        variant="secondary"
                        disabled={restore.isPending}
                        aria-label={t('shopping.lists.restoreLabel', { name: list.name })}
                        onClick={() => restore.mutate(list)}
                      >
                        {t('shopping.lists.restore')}
                      </Button>
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {lists.length > 0 && (
        <div className="sticky bottom-20 mt-6 flex justify-end lg:bottom-4">{newButton}</div>
      )}
      <NewListDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
