import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShoppingCategory, ShoppingItem, ShoppingList } from '@mise/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/button.js';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { Field, INPUT_CLASS, invalidProps } from '../../components/form-field.js';
import { Menu, MenuItem } from '../../components/menu.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { loadErrorProps } from './error-message.js';
import { categoryLabel } from './category-label.js';
import { ItemSheet } from './item-sheet.js';
import { applyCheckoff, buildListView, categoryOf, diffItems, isRejected } from './list-model.js';
import type { CategoryGroup, CheckoffEntry } from './list-model.js';
import { memberName } from './member-names.js';
import { useMe } from '../auth/use-session.js';
import {
  shoppingKeys,
  useHouseholdMembers,
  useCategories,
  useCheckoff,
  useSnapshot,
} from './queries.js';
import { usePendingAdds } from './use-pending-adds.js';
import type { PendingAdd } from './use-pending-adds.js';
import { useListEvents } from './use-list-events.js';
import { useShoppingApi } from './use-shopping-api.js';

const SYNC_LABEL = {
  connecting: t('shopping.sync.connecting'),
  connected: t('shopping.sync.live'),
  reconnecting: t('shopping.sync.reconnecting'),
} as const;

const ANNOUNCE_KEY = {
  picked: 'shopping.announce.picked',
  unpicked: 'shopping.announce.unpicked',
  added: 'shopping.announce.added',
  removed: 'shopping.announce.removed',
  changed: 'shopping.announce.changed',
} as const;

function ItemRow({
  item,
  entry,
  readOnly,
  onToggle,
  onOpen,
  onRetry,
}: {
  item: ShoppingItem;
  entry: CheckoffEntry | undefined;
  readOnly: boolean;
  onToggle: (item: ShoppingItem, picked: boolean) => void;
  onOpen: (item: ShoppingItem) => void;
  onRetry: (item: ShoppingItem) => void;
}) {
  const pending = entry?.status === 'pending';
  const details = (
    <>
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className={item.picked ? 'line-through' : ''}>{item.name}</span>
        {item.originalQuantityText !== null && (
          <span className="shrink-0 text-sm text-text-muted">{item.originalQuantityText}</span>
        )}
      </span>
      {item.note !== null && (
        <span className="w-full text-left text-sm text-text-muted">{item.note}</span>
      )}
    </>
  );
  return (
    <li
      data-testid="shopping-item"
      data-item-id={item.id}
      {...(pending ? { 'aria-busy': true } : {})}
      className="flex items-stretch border-b border-border"
    >
      {/* The label is the hit area: the whole left part of the row, at least 44 x 44 px. */}
      <label className="flex min-h-11 w-14 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          data-testid="item-checkbox"
          className="size-6"
          checked={item.picked}
          disabled={readOnly}
          aria-label={item.name}
          onChange={(e) => onToggle(item, e.target.checked)}
        />
      </label>
      {readOnly ? (
        <div className="flex min-h-11 flex-1 flex-col items-start justify-center py-2 pr-3">
          {details}
        </div>
      ) : (
        <button
          type="button"
          aria-label={t('shopping.item.open', { name: item.name })}
          onClick={() => onOpen(item)}
          className="flex min-h-11 flex-1 flex-col items-start justify-center py-2 pr-3 text-left"
        >
          {details}
        </button>
      )}
      {pending && (
        <span className="flex items-center pr-3 text-text-muted" role="status">
          <span aria-hidden="true">&hellip;</span>
          <span className="sr-only">{t('shopping.item.pending')}</span>
        </span>
      )}
      {isRejected(item, entry) && (
        <button
          type="button"
          onClick={() => onRetry(item)}
          aria-label={t('shopping.item.saveFailedLabel', { name: item.name })}
          className="mr-1 flex min-h-11 items-center gap-1 px-3 font-medium text-danger underline"
        >
          <span aria-hidden="true">! </span>
          {t('shopping.item.saveFailed')}
        </button>
      )}
    </li>
  );
}

function Rows({
  groups,
  collapsible,
  collapsed,
  onCollapse,
  ...rowProps
}: {
  groups: CategoryGroup[];
  collapsible: boolean;
  collapsed: ReadonlySet<string>;
  onCollapse: (id: string) => void;
  entries: ReadonlyMap<string, CheckoffEntry>;
  readOnly: boolean;
  onToggle: (item: ShoppingItem, picked: boolean) => void;
  onOpen: (item: ShoppingItem) => void;
  onRetry: (item: ShoppingItem) => void;
}) {
  const { entries, ...handlers } = rowProps;
  return (
    <>
      {groups.map(({ category, items }) => {
        const label = t('shopping.list.categoryCount', {
          name: categoryLabel(category),
          count: items.length,
        });
        const isCollapsed = collapsible && collapsed.has(category.id);
        return (
          <section key={category.id} data-category-id={category.id} className="mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
              {collapsible ? (
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => onCollapse(category.id)}
                  className="flex min-h-11 w-full items-center justify-between"
                >
                  {label}
                  <span aria-hidden="true">{isCollapsed ? '>' : 'v'}</span>
                </button>
              ) : (
                <span className="flex min-h-11 items-center">{label}</span>
              )}
            </h2>
            {!isCollapsed && (
              <ul>
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} entry={entries.get(item.id)} {...handlers} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function RenameDialog({
  list,
  open,
  onOpenChange,
  onSubmit,
  pending,
  failed,
}: {
  list: ShoppingList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
  pending: boolean;
  failed: boolean;
}) {
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (!open) return;
    setName(list.name);
    setError(undefined);
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-modal-overlay="" className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg">
          <Dialog.Title className="mb-3 text-lg font-semibold">
            {t('shopping.list.renameTitle')}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('shopping.lists.nameLabel')}
          </Dialog.Description>
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (name.trim() === '') setError(t('shopping.sheet.nameRequired'));
              else onSubmit(name.trim());
            }}
          >
            <Field id="rename-list" label={t('shopping.lists.nameLabel')} error={error}>
              <input
                {...invalidProps('rename-list', error)}
                className={INPUT_CLASS}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {failed && (
              <p role="alert" className="text-danger">
                <span aria-hidden="true">! </span>
                {t('shopping.list.writeError')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" disabled={pending}>
                {t('shopping.list.save')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Sticky add bar (S3): one field, Enter or [+]; stays focused so several items go in quickly. */
function AddBar({ onAdd }: { onAdd: (name: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | undefined>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = text.trim();
    if (name === '') {
      setMessage(t('shopping.sheet.nameRequired'));
      inputRef.current?.focus();
      return;
    }
    setMessage(undefined);
    setText('');
    onAdd(name);
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="sticky bottom-14 z-30 -mx-4 border-t border-border bg-surface px-4 py-3 lg:bottom-0"
    >
      {message !== undefined && (
        <p role="alert" className="mb-2 text-danger">
          <span aria-hidden="true">! </span>
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <label htmlFor="add-item-input" className="sr-only">
          {t('shopping.add.label')}
        </label>
        <input
          id="add-item-input"
          ref={inputRef}
          data-testid="add-item-input"
          className={INPUT_CLASS}
          value={text}
          maxLength={200}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={t('shopping.add.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(undefined);
          }}
        />
        <Button type="submit" aria-label={t('shopping.add.button')}>
          <span aria-hidden="true">+</span>
        </Button>
      </div>
    </form>
  );
}

/** Placeholder rows for adds the server has not confirmed yet: not pickable, never in a category. */
function PendingRows({
  pending,
  onRetry,
  onDismiss,
}: {
  pending: readonly PendingAdd[];
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <ul aria-label={t('shopping.add.pendingList')} data-testid="pending-adds" className="mb-2">
      {pending.map((p) => (
        <li
          key={p.id}
          data-testid="pending-item"
          {...(p.status === 'pending' ? { 'aria-busy': true } : {})}
          className="flex min-h-11 items-center gap-2 border-b border-border px-3 py-2"
        >
          <span className="flex-1">{p.name}</span>
          {p.status === 'pending' ? (
            <span className="text-sm text-text-muted">{t('shopping.add.pending')}</span>
          ) : (
            <>
              <span role="alert" className="text-sm font-medium text-danger">
                <span aria-hidden="true">! </span>
                {t('shopping.add.notSaved')}
              </span>
              <button
                type="button"
                aria-label={t('shopping.add.retryLabel', { name: p.name })}
                onClick={() => onRetry(p.id)}
                className="flex min-h-11 items-center px-3 font-medium underline"
              >
                {t('shopping.add.retry')}
              </button>
              <button
                type="button"
                aria-label={t('shopping.add.dismissLabel', { name: p.name })}
                onClick={() => onDismiss(p.id)}
                className="flex min-h-11 items-center px-3 underline"
              >
                {t('shopping.add.dismiss')}
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** S2: the shopping list. Live updates come from SSE-triggered refetches (AC-08). */
export function ShoppingListPage() {
  const { listId = '' } = useParams();
  const api = useShoppingApi();
  const queryClient = useQueryClient();
  const snapshot = useSnapshot(listId);
  const categories = useCategories();
  const { status } = useListEvents(listId, snapshot.refetch);
  const checkoff = useCheckoff(listId);
  const toast = useToast();
  // Keep toasts above the sticky add bar while this page is shown.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--toast-offset', '9rem');
    root.setProperty('--toast-offset-lg', '5rem');
    return () => {
      root.removeProperty('--toast-offset');
      root.removeProperty('--toast-offset-lg');
    };
  }, []);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pickedOpen, setPickedOpen] = useState(false);
  const [sheet, setSheet] = useState<{ itemId: string; focusCategory: boolean } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [listMessage, setListMessage] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('');
  const touched = useRef(new Set<string>());
  const me = useMe().data;
  const members = useHouseholdMembers().data;
  const membersRef = useRef(members);
  membersRef.current = members;
  const meRef = useRef(me);
  meRef.current = me;
  const previous = useRef<readonly ShoppingItem[] | null>(null);

  const list = snapshot.data?.list;
  const serverItems = snapshot.data?.items;
  const cats = useMemo(() => categories.data ?? [], [categories.data]);

  const adds = usePendingAdds(listId, (item) => {
    touched.current.add(item.id);
    toast.show(
      t('shopping.add.toast', {
        name: item.name,
        category: categoryLabel(categoryOf(item, cats)),
      }),
      {
        label: t('shopping.add.change'),
        onSelect: () => setSheet({ itemId: item.id, focusCategory: true }),
      },
    );
  });

  // Polite announcement of changes made by the other member; own changes are not announced.
  useEffect(() => {
    if (serverItems === undefined) return;
    if (previous.current !== null) {
      const changes = diffItems(previous.current, serverItems).filter(
        (c) => !touched.current.has(c.itemId),
      );
      if (changes.length > 0) {
        const text = (c: (typeof changes)[number]) =>
          c.kind === 'picked' && c.memberId !== undefined
            ? t('shopping.announce.pickedBy', {
                name: c.name,
                member: memberName(membersRef.current, c.memberId, meRef.current?.member.id),
              })
            : t(ANNOUNCE_KEY[c.kind], { name: c.name });
        setAnnouncement(changes.map(text).join('. '));
      }
    }
    touched.current.clear();
    previous.current = serverItems;
  }, [serverItems]);

  const patchList = useMutation({
    mutationFn: (body: { name?: string; status?: 'active' | 'archived' }) => {
      if (list === undefined) throw new Error('list not loaded');
      return api.patchList(list.id, list.revision, body);
    },
    onSuccess: (updated) => {
      setListMessage(undefined);
      setRenameOpen(false);
      setArchiveOpen(false);
      queryClient.setQueryData(shoppingKeys.snapshot(updated.id), (old: typeof snapshot.data) =>
        old === undefined ? old : { ...old, list: updated },
      );
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.listsAll });
    },
    onError: (error) => {
      setRenameOpen(false);
      setArchiveOpen(false);
      setListMessage(
        isApiError(error) && error.isConflict
          ? t('shopping.list.conflict')
          : t('shopping.list.writeError'),
      );
      void snapshot.refetch();
    },
  });

  const items = useMemo(
    () => applyCheckoff(serverItems ?? [], checkoff.entries),
    [serverItems, checkoff.entries],
  );
  const view = useMemo(() => buildListView(items, cats), [items, cats]);

  const readOnly = list?.status === 'archived';
  const sheetItem = sheet === null ? undefined : serverItems?.find((i) => i.id === sheet.itemId);
  const toggleSet = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const onToggle = (item: ShoppingItem, picked: boolean) => {
    touched.current.add(item.id);
    checkoff.setPicked(item.id, picked);
  };
  const onRetry = (item: ShoppingItem) => {
    touched.current.add(item.id);
    checkoff.retry(item.id);
  };

  let body: ReactNode;
  if (snapshot.isPending) {
    body = <SkeletonRows testId="shopping-list-loading" rows={5} />;
  } else if (snapshot.isError && list === undefined) {
    const error = snapshot.error;
    body = (
      <ErrorState
        {...loadErrorProps(error)}
        correlationId={isApiError(error) ? error.correlationId : undefined}
        onRetry={() => void snapshot.refetch()}
      />
    );
  } else {
    const rowProps = {
      entries: checkoff.entries,
      readOnly: readOnly === true,
      onToggle,
      onOpen: (item: ShoppingItem) => setSheet({ itemId: item.id, focusCategory: false }),
      onRetry,
    };
    body = (
      <>
        {view.total === 0 && adds.pending.length === 0 && (
          <EmptyState title={t('shopping.list.empty')} />
        )}
        {view.total > 0 && view.open.length === 0 && (
          <p className="py-6 text-center text-lg font-medium" data-testid="all-picked">
            {t('shopping.list.allPicked')}
          </p>
        )}
        <PendingRows pending={adds.pending} onRetry={adds.retry} onDismiss={adds.dismiss} />
        <Rows
          groups={view.open}
          collapsible
          collapsed={collapsed}
          onCollapse={toggleSet}
          {...rowProps}
        />
        {view.pickedCount > 0 && (
          <section data-testid="picked-section" className="mt-4">
            <h2>
              <button
                type="button"
                aria-expanded={pickedOpen}
                onClick={() => setPickedOpen((v) => !v)}
                className="flex min-h-11 w-full items-center justify-between font-semibold"
              >
                {t('shopping.list.pickedUp', { count: view.pickedCount })}
                <span aria-hidden="true">{pickedOpen ? 'v' : '>'}</span>
              </button>
            </h2>
            {pickedOpen && (
              <Rows
                groups={view.picked}
                collapsible={false}
                collapsed={collapsed}
                onCollapse={() => undefined}
                {...rowProps}
              />
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[40rem]">
      <PageHeader
        title={list?.name ?? t('shopping.lists.title')}
        back={{ to: '/shopping', label: t('shopping.list.back') }}
        actions={
          list !== undefined && !readOnly ? (
            <Menu label={t('shopping.list.menu')}>
              <MenuItem onSelect={() => setRenameOpen(true)} testId="rename-list">
                {t('shopping.list.rename')}
              </MenuItem>
              <MenuItem onSelect={() => setArchiveOpen(true)} testId="archive-list">
                {t('shopping.list.archive')}
              </MenuItem>
            </Menu>
          ) : undefined
        }
      />
      <div className="mb-3 flex items-center justify-between text-sm">
        <p
          data-testid="sync-status"
          data-state={status}
          role="status"
          aria-label={t('shopping.sync.label')}
          className={status === 'reconnecting' ? 'font-medium text-text' : 'text-text-muted'}
        >
          <span aria-hidden="true">{status === 'reconnecting' ? '! ' : '● '}</span>
          {SYNC_LABEL[status]}
        </p>
        {view.total > 0 && (
          <p data-testid="list-progress">
            {t('shopping.list.progress', { picked: view.pickedCount, total: view.total })}
          </p>
        )}
      </div>
      {/* Polite live region: other-member changes are read out without moving focus or scroll. */}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-announcements"
      >
        {announcement}
      </div>

      {readOnly && (
        <div
          data-testid="archived-banner"
          className="mb-3 flex flex-col items-start gap-2 rounded-lg border border-border p-3"
        >
          <p className="font-medium">{t('shopping.list.archivedBanner')}</p>
          <Button
            variant="secondary"
            disabled={patchList.isPending}
            onClick={() => patchList.mutate({ status: 'active' })}
          >
            {t('shopping.list.restoreList')}
          </Button>
        </div>
      )}
      {listMessage !== undefined && (
        <p role="alert" className="mb-3 text-danger">
          <span aria-hidden="true">! </span>
          {listMessage}
        </p>
      )}

      {body}

      {list !== undefined && !readOnly && <AddBar onAdd={adds.add} />}

      {list !== undefined && (
        <>
          <RenameDialog
            list={list}
            open={renameOpen}
            onOpenChange={setRenameOpen}
            onSubmit={(name) => patchList.mutate({ name })}
            pending={patchList.isPending}
            failed={patchList.isError}
          />
          <ConfirmDialog
            open={archiveOpen}
            onOpenChange={setArchiveOpen}
            title={t('shopping.list.archiveTitle', { name: list.name })}
            description={t('shopping.list.archiveDescription')}
            confirmLabel={t('shopping.list.archiveConfirm')}
            onConfirm={() => patchList.mutate({ status: 'archived' })}
            pending={patchList.isPending}
          />
        </>
      )}
      {sheet !== null && (
        <SheetHost
          key={sheet.itemId}
          itemId={sheet.itemId}
          focusCategory={sheet.focusCategory}
          item={sheetItem}
          categories={cats}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/** Keeps the sheet open on the revision it started from, even if the live item changes or vanishes. */
function SheetHost({
  item,
  categories,
  focusCategory,
  onClose,
}: {
  itemId: string;
  item: ShoppingItem | undefined;
  categories: readonly ShoppingCategory[];
  focusCategory: boolean;
  onClose: () => void;
}) {
  const [start] = useState<ShoppingItem | undefined>(item);
  if (start === undefined) return null;
  return (
    <ItemSheet
      initialItem={start}
      categories={categories}
      focusCategory={focusCategory}
      gone={item === undefined}
      onClose={onClose}
    />
  );
}
