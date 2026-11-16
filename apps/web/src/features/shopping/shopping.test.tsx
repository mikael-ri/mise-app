import type { ShoppingItem } from '@mise/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, createApiClient } from '../../lib/api-client.js';
import { endSession } from '../../lib/session.js';
import { createShoppingApi } from './shopping-api.js';
import { expectNoAxeViolations } from '../../test/axe.js';
import { renderApp } from '../../test/render-app.js';
import type { ShoppingApi } from './shopping-api.js';
import {
  CAT,
  CATEGORIES,
  LIST_ID,
  groceries,
  shoppingItem,
  shoppingList,
  snapshotOf,
  uuid,
} from './shopping-fixtures.js';

class NoopSource {
  static instances: NoopSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    NoopSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  NoopSource.instances = [];
  vi.stubGlobal('EventSource', NoopSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const stale = () =>
  new ApiError({ status: 409, code: 'stale_revision', message: 'x', correlationId: 'c-1' });
const network = () => new ApiError({ status: 0, code: 'network_error', message: 'network error' });

/** In-memory list: a confirmed checkoff is reflected by later snapshots, like the real server. */
function fakeShopping(over: Partial<ShoppingApi> = {}): ShoppingApi {
  const items = groceries();
  const confirmed = new Map<string, ShoppingItem>();
  const shown = () => items.map((i) => confirmed.get(i.id) ?? i);
  const checkoff =
    over.setPicked ??
    ((id: string, picked: boolean) => {
      const found = items.find((i) => i.id === id);
      if (found === undefined) return Promise.reject(new Error('unknown item'));
      return Promise.resolve({ ...found, picked, revision: found.revision + 1 });
    });
  return {
    listLists: vi.fn().mockResolvedValue([]),
    createList: vi.fn().mockResolvedValue(shoppingList()),
    getSnapshot: vi.fn().mockImplementation(() => Promise.resolve(snapshotOf(shown()))),
    patchList: vi.fn().mockResolvedValue(shoppingList()),
    addItem: vi
      .fn()
      .mockImplementation((_l, body: { name: string }) =>
        Promise.resolve(shoppingItem(9, { name: body.name, categoryId: CAT.dairy })),
      ),
    editItem: vi.fn().mockResolvedValue(shoppingItem(1, { name: 'Milk', revision: 2 })),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    listCategories: vi.fn().mockResolvedValue(CATEGORIES),
    ...over,
    setPicked: vi.fn().mockImplementation((id: string, picked: boolean) =>
      checkoff(id, picked).then((item) => {
        confirmed.set(item.id, item);
        return item;
      }),
    ),
  };
}

const renderList = (api: ShoppingApi) =>
  renderApp(`/shopping/${LIST_ID}`, undefined, undefined, api);

const row = (name: string) => {
  const el = screen.getByText(name).closest('[data-testid="shopping-item"]');
  if (!(el instanceof HTMLElement)) throw new Error(`no row for ${name}`);
  return el;
};

describe('lists index (FR-34)', () => {
  it('FR-34: shows active lists newest activity first, archived behind a toggle with Restore', async () => {
    const active = [
      shoppingList({
        id: uuid(1),
        name: 'Old',
        updatedAt: '2026-11-10T08:00:00Z',
        itemCount: 8,
        pickedCount: 3,
      }),
      shoppingList({ id: uuid(2), name: 'New', updatedAt: '2026-11-15T08:00:00Z' }),
    ];
    const archived = [
      shoppingList({ id: uuid(3), name: 'Gone', status: 'archived', itemCount: 1, pickedCount: 0 }),
    ];
    const api = fakeShopping({
      listLists: vi
        .fn()
        .mockImplementation((s: string) => Promise.resolve(s === 'active' ? active : archived)),
    });
    renderApp('/shopping', undefined, undefined, api);
    const cards = await screen.findAllByTestId('shopping-list-card');
    expect(cards.map((c) => within(c).getByRole('link').textContent)).toEqual([
      expect.stringContaining('New'),
      expect.stringContaining('Old'),
    ]);
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByTestId('list-card-progress')).toHaveTextContent(
      '3 of 8 items picked up',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archived lists (1)' }));
    expect(screen.getAllByTestId('list-card-progress')[2]).toHaveTextContent(
      '0 of 1 item picked up',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Restore Gone' }));
    expect(api.patchList).toHaveBeenCalledWith(uuid(3), 1, { status: 'active' });
  });

  it('shows the empty state with New list, and creates a list with a default name', async () => {
    const api = fakeShopping();
    renderApp('/shopping', undefined, undefined, api);
    expect(await screen.findByText('No lists yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const input = screen.getByLabelText('List name');
    expect((input as HTMLInputElement).value).toMatch(/^Shopping /);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(api.createList).toHaveBeenCalledWith(
        { name: (input as HTMLInputElement).value },
        expect.any(String),
      ),
    );
  });

  it('shows an error with Try again', async () => {
    const listLists = vi.fn().mockRejectedValueOnce(network()).mockResolvedValue([]);
    renderApp('/shopping', undefined, undefined, fakeShopping({ listLists }));
    expect(
      await screen.findByText('Could not reach the server. Check your connection.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No lists yet')).toBeInTheDocument();
  });
});

describe('list view (FR-36, FR-37, AC-08)', () => {
  it('FR-36: groups by category with Other last, shows progress and the sync indicator', async () => {
    renderList(fakeShopping());
    await screen.findByText('Milk');
    const headers = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent?.replace(/[v>]$/, ''));
    expect(headers).toEqual(['Vegetables (1)', 'Dairy (1)', 'Other (1)']);
    expect(screen.getByTestId('list-progress')).toHaveTextContent('0 of 3 picked up');
    expect(screen.getByTestId('sync-status')).toBeInTheDocument();
    expect(screen.getAllByTestId('item-checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('type', 'checkbox');
  });

  it('shows the empty state and the all-picked state', async () => {
    const empty = fakeShopping({ getSnapshot: vi.fn().mockResolvedValue(snapshotOf([])) });
    const { unmount } = renderList(empty);
    expect(
      await screen.findByText('Nothing here yet. Add your first item below.'),
    ).toBeInTheDocument();
    unmount();
    const done = fakeShopping({
      getSnapshot: vi.fn().mockResolvedValue(snapshotOf([shoppingItem(1, { picked: true })])),
    });
    renderList(done);
    expect(await screen.findByText('Everything is picked up')).toBeInTheDocument();
    expect(screen.getByTestId('picked-section')).toBeInTheDocument();
  });

  it('FR-37: checkoff is optimistic and moves the row to Picked up at once (desired state)', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const setPicked = vi.fn().mockImplementation(
      (id: string, picked: boolean) =>
        new Promise((r) => {
          resolve = () =>
            r(
              shoppingItem(1, {
                id: id as never,
                name: 'Milk',
                categoryId: CAT.dairy,
                picked,
                revision: 2,
              }),
            );
        }),
    );
    renderList(fakeShopping({ setPicked }));
    await screen.findByText('Milk');
    await userEvent.click(within(row('Milk')).getByTestId('item-checkbox'));
    expect(setPicked).toHaveBeenCalledWith(shoppingItem(1).id, true);
    expect(screen.getByTestId('list-progress')).toHaveTextContent('1 of 3 picked up');
    const picked = screen.getByTestId('picked-section');
    expect(within(picked).getByRole('button')).toHaveTextContent('Picked up (1)');
    resolve(undefined);
    await waitFor(() => expect(screen.queryByText('Saving')).not.toBeInTheDocument());
    // expanded: still grouped by category, struck through, checkbox checked
    await userEvent.click(within(picked).getByRole('button'));
    const pickedRow = within(picked).getByTestId('shopping-item');
    expect(within(pickedRow).getByTestId('item-checkbox')).toBeChecked();
    expect(within(pickedRow).getByText('Milk')).toHaveClass('line-through');
    expect(within(picked).getByRole('heading', { name: 'Dairy (1)' })).toBeInTheDocument();
  });

  it('FR-37: a failed checkoff reverts, shows Not saved. Retry, and Retry resends the desired state', async () => {
    const setPicked = vi
      .fn()
      .mockRejectedValueOnce(network())
      .mockImplementation((id: string, picked: boolean) =>
        Promise.resolve(
          shoppingItem(1, {
            id: id as never,
            name: 'Milk',
            categoryId: CAT.dairy,
            picked,
            revision: 2,
          }),
        ),
      );
    renderList(fakeShopping({ setPicked }));
    await screen.findByText('Milk');
    await userEvent.click(within(row('Milk')).getByTestId('item-checkbox'));
    const retry = await screen.findByRole('button', { name: 'Not saved. Retry: Milk' });
    expect(within(row('Milk')).getByTestId('item-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('list-progress')).toHaveTextContent('0 of 3 picked up');
    await userEvent.click(retry);
    expect(setPicked).toHaveBeenLastCalledWith(shoppingItem(1).id, true);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Not saved/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('list-progress')).toHaveTextContent('1 of 3 picked up');
  });

  it('FR-37: two people ticking the same item converge without an error', async () => {
    // The other member already picked it; our desired-state request succeeds as a no-op.
    const already = shoppingItem(1, {
      name: 'Milk',
      categoryId: CAT.dairy,
      picked: true,
      revision: 3,
    });
    const api = fakeShopping({ setPicked: vi.fn().mockResolvedValue(already) });
    renderList(api);
    await screen.findByText('Milk');
    await userEvent.click(within(row('Milk')).getByTestId('item-checkbox'));
    await waitFor(() => expect(screen.getByTestId('list-progress')).toHaveTextContent('1 of 3'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('FR-34: an archived list is read-only with a banner and Restore list', async () => {
    const api = fakeShopping({
      getSnapshot: vi.fn().mockResolvedValue(snapshotOf(groceries(), { status: 'archived' })),
    });
    renderList(api);
    await screen.findByText('Milk');
    expect(screen.getByTestId('archived-banner')).toHaveTextContent('read-only');
    expect(screen.queryByTestId('add-item-input')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('item-checkbox')[0]).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Restore list' }));
    expect(api.patchList).toHaveBeenCalledWith(LIST_ID, 1, { status: 'active' });
  });

  it('FR-34: archive asks first and names the list; the menu has no Manage categories', async () => {
    const api = fakeShopping();
    renderList(api);
    await screen.findByText('Milk');
    await userEvent.click(screen.getByRole('button', { name: 'List actions' }));
    expect(screen.queryByText(/Manage categories/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive list' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Archive "Weekend shop"?');
    expect(api.patchList).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(api.patchList).toHaveBeenCalledWith(LIST_ID, 1, { status: 'archived' });
  });

  it('has no axe violations (jsdom)', async () => {
    const { container } = renderList(fakeShopping());
    await screen.findByText('Milk');
    await expectNoAxeViolations(container);
  });
});

describe('session end on the stream (FR-34)', () => {
  it('FR-34: a stream error then a 401 on the snapshot refetch ends the session and closes the stream', async () => {
    let queryClient: QueryClient | undefined = undefined as QueryClient | undefined;
    let snapshots = 0;
    const jsonResponse = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const fetchImpl = vi.fn((path: string | URL | Request) => {
      const url = String(path);
      if (url.endsWith('/shopping-categories')) {
        return Promise.resolve(jsonResponse(200, { items: CATEGORIES }));
      }
      snapshots += 1;
      return Promise.resolve(
        snapshots === 1
          ? jsonResponse(200, snapshotOf(groceries()))
          : jsonResponse(401, {
              code: 'unauthenticated',
              message: 'no session',
              correlationId: 'c-1',
            }),
      );
    });
    const api = createShoppingApi(
      createApiClient({
        getCsrfToken: () => undefined,
        onSessionEnded: () => queryClient && endSession(queryClient, 'session_ended'),
        fetchImpl: fetchImpl as typeof fetch,
      }),
    );
    const view = renderList(api);
    queryClient = view.queryClient;
    await screen.findByText('Milk');
    const source = NoopSource.instances[0];
    source?.onerror?.();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/signin'));
    expect(source?.closed).toBe(true);
    // the session is over: the stream is closed and requests stop (no retry loop)
    const settled = snapshots;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(snapshots).toBe(settled);
  });
});

describe('list view fixes', () => {
  it('FR-36: a category header collapses and expands its rows', async () => {
    renderList(fakeShopping());
    await screen.findByText('Milk');
    const toggle = screen.getByRole('button', { name: /^Dairy \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Milk')).not.toBeInTheDocument();
    expect(screen.getByText('Carrots')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText('Milk')).toBeInTheDocument();
  });

  it('FR-34: the stream starts neutral (no Reconnecting warning on load) and keeps toasts above the add bar', async () => {
    const { unmount } = renderList(fakeShopping());
    await screen.findByText('Milk');
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-state', 'connecting');
    expect(screen.getByTestId('sync-status')).not.toHaveTextContent('Reconnecting');
    expect(document.documentElement.style.getPropertyValue('--toast-offset')).not.toBe('');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--toast-offset')).toBe('');
  });

  it('FR-37: a stale in-flight snapshot refetch cannot revert a confirmed checkoff', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let releaseOld: (v: unknown) => void = () => undefined;
    let calls = 0;
    const getSnapshot = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(snapshotOf(groceries()));
      if (calls === 2) return new Promise((r) => (releaseOld = r)); // old data, still in flight
      return new Promise(() => undefined); // the follow-up refetch stays pending: only the cache counts
    });
    renderList(fakeShopping({ getSnapshot }));
    await screen.findByText('Milk');
    document.dispatchEvent(new Event('visibilitychange')); // starts the stale refetch
    await waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    await userEvent.click(within(row('Milk')).getByTestId('item-checkbox'));
    await waitFor(() => expect(screen.queryByText('Saving')).not.toBeInTheDocument());
    releaseOld(snapshotOf(groceries()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('list-progress')).toHaveTextContent('1 of 3 picked up');
    vi.restoreAllMocks();
  });

  it('FR-37: the Retry button names the item', async () => {
    const setPicked = vi.fn().mockRejectedValue(network());
    renderList(fakeShopping({ setPicked }));
    await screen.findByText('Carrots');
    await userEvent.click(within(row('Carrots')).getByTestId('item-checkbox'));
    expect(
      await screen.findByRole('button', { name: 'Not saved. Retry: Carrots' }),
    ).toBeInTheDocument();
  });
});

describe('adding an item (FR-35, FR-36, FR-39)', () => {
  const deferred = () => {
    let resolve: (v: unknown) => void = () => undefined;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
  const maito = (name = 'Maito') => shoppingItem(9, { name, categoryId: CAT.dairy });

  it('FR-35: submitting shows an "Adding…" placeholder at once (not pickable), the field clears and keeps focus; it becomes the real item in its category', async () => {
    const d = deferred();
    const api = fakeShopping({ addItem: vi.fn().mockReturnValue(d.promise) });
    renderList(api);
    await screen.findByText('Milk');
    const input = screen.getByTestId('add-item-input');
    await userEvent.type(input, 'Maito{Enter}');
    const placeholder = await screen.findByTestId('pending-item');
    expect(placeholder).toHaveTextContent('Maito');
    expect(placeholder).toHaveTextContent('Adding…');
    expect(placeholder).toHaveAttribute('aria-busy', 'true');
    expect(within(placeholder).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByText('Added "Maito" to Dairy.')).not.toBeInTheDocument();
    d.resolve(maito());
    expect(await screen.findByText('Added "Maito" to Dairy.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('pending-item')).not.toBeInTheDocument());
    expect(screen.getAllByText('Maito')).toHaveLength(1); // the real row only: no duplicate
    expect(screen.getAllByTestId('shopping-item')).toHaveLength(4);
  });

  it('FR-35: a failed add keeps the placeholder with Not saved, Retry reuses the same key and Remove drops it', async () => {
    const addItem = vi
      .fn()
      .mockRejectedValueOnce(network())
      .mockRejectedValueOnce(network())
      .mockImplementation((_l, body: { name: string }) => Promise.resolve(maito(body.name)));
    renderList(fakeShopping({ addItem }));
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), 'Maito{Enter}');
    const failed = await screen.findByText('Not saved');
    expect(failed).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry adding Maito' }));
    await screen.findByRole('button', { name: 'Remove Maito' }); // failed again
    await userEvent.click(screen.getByRole('button', { name: 'Retry adding Maito' }));
    expect(await screen.findByText('Added "Maito" to Dairy.')).toBeInTheDocument();
    expect(addItem).toHaveBeenCalledTimes(3);
    const keys = addItem.mock.calls.map((c) => c[2]);
    expect(new Set(keys).size).toBe(1);
    expect(screen.queryByTestId('pending-item')).not.toBeInTheDocument();
  });

  it('FR-35: a failed placeholder is announced as an alert', async () => {
    renderList(fakeShopping({ addItem: vi.fn().mockRejectedValue(network()) }));
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), 'Maito{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved');
  });

  it('FR-35: a late success after leaving the page shows no toast', async () => {
    const d = deferred();
    const view = renderList(fakeShopping({ addItem: vi.fn().mockReturnValue(d.promise) }));
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), 'Maito{Enter}');
    await screen.findByTestId('pending-item');
    await view.router.navigate('/shopping');
    await screen.findByText('No lists yet');
    d.resolve(maito());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/Added "Maito"/)).not.toBeInTheDocument();
  });

  it('FR-35: Remove drops a failed placeholder without sending anything', async () => {
    const addItem = vi.fn().mockRejectedValue(network());
    renderList(fakeShopping({ addItem }));
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), 'Maito{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Maito' }));
    expect(screen.queryByTestId('pending-item')).not.toBeInTheDocument();
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('FR-35: two concurrent adds each get a placeholder and their own idempotency key', async () => {
    const first = deferred();
    const second = deferred();
    const addItem = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderList(fakeShopping({ addItem }));
    await screen.findByText('Milk');
    const input = screen.getByTestId('add-item-input');
    await userEvent.type(input, 'Maito{Enter}');
    await userEvent.type(input, 'Juusto{Enter}');
    expect(screen.getAllByTestId('pending-item')).toHaveLength(2);
    expect(addItem.mock.calls[0]?.[2]).not.toBe(addItem.mock.calls[1]?.[2]);
    second.resolve(shoppingItem(10, { name: 'Juusto', categoryId: CAT.dairy }));
    await waitFor(() => expect(screen.getAllByTestId('pending-item')).toHaveLength(1));
    expect(screen.getByTestId('pending-item')).toHaveTextContent('Maito');
    first.resolve(maito());
    await waitFor(() => expect(screen.queryByTestId('pending-item')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('shopping-item')).toHaveLength(5);
  });

  it('FR-35: Enter adds, clears the field and keeps it focused; the toast names the category', async () => {
    const api = fakeShopping();
    renderList(api);
    await screen.findByText('Milk');
    const input = screen.getByTestId('add-item-input');
    await userEvent.type(input, 'Maito{Enter}');
    expect(api.addItem).toHaveBeenCalledWith(LIST_ID, { name: 'Maito' }, expect.any(String));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(await screen.findByText('Added "Maito" to Dairy.')).toBeInTheDocument();
    expect(await screen.findByText('Maito')).toBeInTheDocument();
  });

  it('FR-35: a whitespace-only name is rejected and nothing is sent', async () => {
    const api = fakeShopping();
    renderList(api);
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), '   {Enter}');
    expect(api.addItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.');
  });

  it('FR-36: the toast Change action opens the item sheet focused on the category', async () => {
    renderList(fakeShopping());
    await screen.findByText('Milk');
    await userEvent.type(screen.getByTestId('add-item-input'), 'Maito{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Change' }));
    const sheet = await screen.findByTestId('item-sheet');
    await waitFor(() => expect(within(sheet).getByLabelText('Category')).toHaveFocus());
  });
});

describe('item sheet (FR-35, FR-36, FR-37)', () => {
  const open = async (api: ShoppingApi, name = 'Milk') => {
    renderList(api);
    await screen.findByText(name);
    await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));
    return screen.findByTestId('item-sheet');
  };

  it('FR-36: an unchanged category is not sent; only changed fields and the item revision are', async () => {
    const api = fakeShopping();
    const sheet = await open(api);
    expect(within(sheet).getByLabelText('Category')).toHaveValue(CAT.dairy);
    expect(within(sheet).getByText('Remember this category for "milk"')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Note'), 'rasvaton');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.editItem).toHaveBeenCalledTimes(1));
    expect(api.editItem).toHaveBeenCalledWith(shoppingItem(1).id, 1, { note: 'rasvaton' });
  });

  it('FR-36: changing the category sends it; choosing Automatic afterwards sends null', async () => {
    const api = fakeShopping();
    const sheet = await open(api);
    await userEvent.selectOptions(within(sheet).getByLabelText('Category'), 'Automatic');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.editItem).toHaveBeenCalled());
    expect(api.editItem).toHaveBeenCalledWith(shoppingItem(1).id, 1, { categoryId: null });
  });

  it('FR-35: the quantity is one free-text field; unit chips insert into it and it maps to quantityText', async () => {
    const api = fakeShopping();
    const sheet = await open(api);
    const qty = within(sheet).getByLabelText('Quantity');
    expect(qty).toHaveAttribute('placeholder', '2 l');
    await userEvent.clear(qty);
    await userEvent.type(qty, '1,5');
    await userEvent.click(within(sheet).getByRole('button', { name: 'dl' }));
    expect(qty).toHaveValue('1,5 dl');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.editItem).toHaveBeenCalled());
    expect(api.editItem).toHaveBeenCalledWith(shoppingItem(1).id, 1, { quantityText: '1,5 dl' });
  });

  it('FR-35: a stale edit keeps the sheet open; Show latest refreshes untouched fields and keeps the draft', async () => {
    const latest = shoppingItem(1, {
      name: 'Milk',
      categoryId: CAT.dairy,
      originalQuantityText: '3 l',
      note: 'laktoositon',
      revision: 5,
    });
    const getSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshotOf(groceries()))
      .mockResolvedValue(snapshotOf([latest]));
    const api = fakeShopping({
      getSnapshot,
      editItem: vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue(latest),
    });
    const sheet = await open(api);
    await userEvent.type(within(sheet).getByLabelText('Note'), 'minun');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    const conflict = await within(sheet).findByTestId('item-conflict');
    expect(conflict).toHaveTextContent(
      'Changed by Another household member while you were editing.',
    );
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(within(conflict).getByRole('button', { name: 'Show latest' }));
    // untouched quantity is refreshed; the user's note draft is kept; the banner stays
    await waitFor(() => expect(within(sheet).getByLabelText('Quantity')).toHaveValue('3 l'));
    expect(within(sheet).getByLabelText('Note')).toHaveValue('minun');
    expect(within(sheet).getByTestId('item-conflict')).toHaveTextContent('Your edits are kept');
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled();
    // saving is based on the latest revision and sends only the user's change
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.editItem).toHaveBeenCalledTimes(2));
    expect(api.editItem).toHaveBeenLastCalledWith(latest.id, 5, { note: 'minun' });
  });

  it('FR-35: deleting an unpicked item is immediate with an Undo that re-adds it', async () => {
    const api = fakeShopping();
    const sheet = await open(api);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete item' }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(shoppingItem(1).id, 1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.addItem).toHaveBeenCalled());
    expect(api.addItem).toHaveBeenCalledWith(
      LIST_ID,
      { name: 'Milk', quantityText: '2 l', categoryId: CAT.dairy },
      expect.any(String),
    );
  });

  it('FR-35: deleting a picked item asks for confirmation first', async () => {
    const picked = shoppingItem(1, {
      name: 'Milk',
      categoryId: CAT.dairy,
      picked: true,
      pickedAt: '2026-11-16T09:00:00Z',
      pickedByMemberId: uuid<NonNullable<ShoppingItem['pickedByMemberId']>>(900),
    });
    const api = fakeShopping({ getSnapshot: vi.fn().mockResolvedValue(snapshotOf([picked])) });
    renderList(api);
    await screen.findByText('Picked up (1)');
    await userEvent.click(screen.getByRole('button', { name: 'Picked up (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Milk' }));
    const sheet = await screen.findByTestId('item-sheet');
    expect(within(sheet).getByText(/Picked up by Another household member/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete item' }));
    expect(api.deleteItem).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: 'Delete "Milk"?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteItem).toHaveBeenCalledWith(picked.id, 1));
  });
});
