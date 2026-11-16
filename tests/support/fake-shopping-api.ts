/**
 * UI-ONLY fake of the Mise shopping API for Playwright (card A15).
 *
 * There is no real sign-in helper yet (A16 owns it), so these specs stub `/api/**` in the browser.
 * A16 must replace this fake with the real sign-in helper and rerun AC-08 (sync between two
 * devices, reconnect refetch) against the real server, including the real SSE stream.
 *
 * Drift guard: every response is parsed with the Zod schemas from `@mise/contracts` before it is
 * served and every request body is parsed with the request schema, so the fake cannot disagree
 * with the contract.
 *
 * State: one `FakeShoppingServer` holds the lists, items and `changeSeq`; any number of pages
 * (browser contexts) attach to it, so two "devices" see the same data.
 *
 * SSE: Playwright's `route.fulfill` cannot keep a stream open and push later frames, so the
 * browser's `EventSource` is replaced by an init-script fake (`attach`). The server pushes
 * `{listId, seq}` frames into every connected page after each write, like the real endpoint,
 * and sends the current cursor as the first frame on (re)open. `client.disconnect()` simulates a
 * network loss for that page (stream errors, retries keep failing, `/api/**` requests abort);
 * `client.reconnect()` restores it and the fake EventSource re-opens by itself, like the browser.
 */
import type { Page, Route } from '@playwright/test';
import {
  AddShoppingItemRequest,
  CreateShoppingListRequest,
  ErrorBody,
  type ErrorCode,
  MeResponse,
  PatchShoppingItemRequest,
  PatchShoppingListRequest,
  ShoppingCategoryList,
  ShoppingItem,
  ShoppingList,
  ShoppingListSnapshot,
  ShoppingListSummaryList,
  formatEtag,
  isSetPicked,
  parseIfMatch,
} from '../../packages/contracts/src/index.js';
import { CAT, CATEGORIES, uuid } from '../../apps/web/src/features/shopping/shopping-fixtures.js';
import { ME } from '../../apps/web/src/test/fixtures.js';

type ItemT = ReturnType<typeof ShoppingItem.parse>;
type ListT = ReturnType<typeof ShoppingList.parse>;

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });

const error = (route: Route, status: number, code: ErrorCode, extra = {}) =>
  json(
    route,
    status,
    ErrorBody.parse({ code, message: code, correlationId: 'e2e-fake', ...extra }),
  );

/** Stand-in for the server categorizer (A13): just enough names for the specs. */
function defaultCategory(name: string): ItemT['categoryId'] {
  const key = name.trim().toLowerCase();
  if (['milk', 'maito', 'cheese', 'juusto'].includes(key)) return CAT.dairy;
  if (['carrots', 'porkkana', 'cucumber'].includes(key)) return CAT.vegetables;
  return CAT.other;
}

/** Runs in the browser before the app: a controllable EventSource. */
function installFakeEventSource(): void {
  interface Win {
    __fakeSseSeq: (listId: string) => Promise<number>;
    __sse: { offline: boolean; sources: FakeEs[] };
    EventSource: unknown;
  }
  const w = window as unknown as Win;
  w.__sse = { offline: false, sources: [] };
  class FakeEs {
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    readyState = 0;
    open = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly url: string) {
      w.__sse.sources.push(this);
      this.attempt();
    }
    attempt(): void {
      this.timer = setTimeout(() => {
        if (this.readyState === 2) return;
        if (w.__sse.offline) {
          this.open = false;
          this.onerror?.(new Event('error'));
          this.attempt();
          return;
        }
        this.open = true;
        this.readyState = 1;
        this.onopen?.(new Event('open'));
        const listId = /shopping-lists\/([^/]+)\/events/.exec(this.url)?.[1] ?? '';
        void w.__fakeSseSeq(listId).then((seq) => this.push(listId, seq));
      }, 100);
    }
    push(listId: string, seq: number): void {
      if (this.open)
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ listId, seq }) }));
    }
    drop(): void {
      this.open = false;
      this.readyState = 0;
      this.onerror?.(new Event('error'));
      this.attempt();
    }
    close(): void {
      this.readyState = 2;
      this.open = false;
      clearTimeout(this.timer);
    }
  }
  w.EventSource = FakeEs;
}

export interface FakeShoppingClient {
  /** Requests this page made, e.g. "PATCH /api/v1/shopping-items/<id>". */
  readonly requests: string[];
  /** Network loss for this page: stream errors and `/api/**` requests fail until `reconnect`. */
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
}

export class FakeShoppingServer {
  private readonly lists = new Map<string, ListT>();
  private readonly items = new Map<string, ItemT>();
  private readonly seqs = new Map<string, number>();
  private readonly pages = new Set<Page>();
  private readonly offline = new Set<Page>();
  private readonly keys = new Map<string, unknown>();
  private next = 10_000;

  seq(listId: string): number {
    return this.seqs.get(listId) ?? 0;
  }

  /** Broadcast `{listId, seq}` to every connected page, like the real after-commit signal. */
  private async bump(listId: string): Promise<void> {
    const seq = this.seq(listId) + 1;
    this.seqs.set(listId, seq);
    const list = this.lists.get(listId);
    if (list !== undefined) this.lists.set(listId, { ...list, changeSeq: seq });
    await Promise.all(
      [...this.pages]
        .filter((page) => !this.offline.has(page) && !page.isClosed())
        .map(
          (page) =>
            page
              .evaluate(
                ([id, s]) => {
                  const state = (
                    window as unknown as {
                      __sse?: { sources: Array<{ push(l: string, n: number): void }> };
                    }
                  ).__sse;
                  for (const source of state.sources) source.push(id as string, s as number);
                },
                [listId, seq] as const,
              )
              .catch(() => undefined), // page not loaded yet or navigating: it refetches on open anyway
        ),
    );
  }

  async attach(page: Page): Promise<FakeShoppingClient> {
    this.pages.add(page);
    const requests: string[] = [];
    await page.exposeFunction('__fakeSseSeq', (listId: string) => this.seq(listId));
    await page.addInitScript(installFakeEventSource);
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => this.handle(page, route, requests),
    );
    return {
      requests,
      disconnect: async () => {
        this.offline.add(page);
        await page.evaluate(() => {
          const state = (
            window as unknown as {
              __sse: { offline: boolean; sources: Array<{ open: boolean; drop(): void }> };
            }
          ).__sse;
          state.offline = true;
          for (const source of state.sources) if (source.open) source.drop();
        });
      },
      reconnect: async () => {
        this.offline.delete(page);
        await page.evaluate(() => {
          (window as unknown as { __sse: { offline: boolean } }).__sse.offline = false;
        });
      },
    };
  }

  private async handle(page: Page, route: Route, requests: string[]): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace('/api/v1', '');
    requests.push(`${method} ${url.pathname}${url.search}`);
    if (this.offline.has(page)) return route.abort('connectionfailed');

    if (method === 'GET' && path === '/auth/me') return json(route, 200, MeResponse.parse(ME));
    if (method === 'GET' && path === '/shopping-categories') {
      return json(route, 200, ShoppingCategoryList.parse({ items: CATEGORIES }));
    }

    const needsKey = () =>
      !/^[A-Za-z0-9_-]{16,128}$/.test(request.headers()['idempotency-key'] ?? '');
    const now = new Date().toISOString();

    if (path === '/shopping-lists') {
      if (method === 'GET') {
        const status = url.searchParams.get('status');
        const items = [...this.lists.values()].filter(
          (l) => status === null || l.status === status,
        );
        return json(route, 200, ShoppingListSummaryList.parse({ items }));
      }
      if (method === 'POST') {
        if (needsKey()) return error(route, 400, 'idempotency_key_required');
        const body = CreateShoppingListRequest.parse(request.postDataJSON());
        const replay = this.keys.get(request.headers()['idempotency-key'] ?? '');
        if (replay !== undefined) return json(route, 200, replay);
        const list = ShoppingList.parse({
          id: uuid(this.next++),
          name: body.name,
          status: 'active',
          changeSeq: 0,
          revision: 1,
          createdByMemberId: ME.member.id,
          createdAt: now,
          updatedAt: now,
        });
        this.lists.set(list.id, list);
        this.keys.set(request.headers()['idempotency-key'] ?? '', list);
        return json(route, 201, list, { etag: formatEtag(1) });
      }
    }

    const listMatch = /^\/shopping-lists\/([^/]+)(\/items)?$/.exec(path);
    if (listMatch !== null) {
      const listId = listMatch[1] ?? '';
      const list = this.lists.get(listId);
      if (list === undefined) return error(route, 404, 'not_found');
      if (method === 'GET' && listMatch[2] === undefined) {
        const items = [...this.items.values()].filter((i) => i.listId === listId);
        return json(route, 200, ShoppingListSnapshot.parse({ list, items }), {
          'cache-control': 'no-store',
        });
      }
      if (method === 'PATCH' && listMatch[2] === undefined) {
        const body = PatchShoppingListRequest.parse(request.postDataJSON());
        const ifMatch = request.headers()['if-match'];
        if (ifMatch === undefined) return error(route, 428, 'precondition_required');
        if (parseIfMatch(ifMatch) !== list.revision) return error(route, 409, 'stale_revision');
        const updated = ShoppingList.parse({
          ...list,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.status === undefined ? {} : { status: body.status }),
          revision: list.revision + 1,
          updatedAt: now,
        });
        this.lists.set(listId, updated);
        await this.bump(listId);
        return json(route, 200, updated, { etag: formatEtag(updated.revision) });
      }
      if (method === 'POST' && listMatch[2] !== undefined) {
        if (needsKey()) return error(route, 400, 'idempotency_key_required');
        const body = AddShoppingItemRequest.parse(request.postDataJSON());
        const item = ShoppingItem.parse({
          id: uuid(this.next++),
          listId,
          origin: 'user',
          name: body.name,
          normalizedKey: body.name.trim().toLowerCase(),
          amountMin: null,
          amountMax: null,
          unitCode: null,
          originalQuantityText: body.quantityText ?? null,
          note: body.note ?? null,
          categoryId: body.categoryId ?? defaultCategory(body.name),
          picked: false,
          pickedAt: null,
          pickedByMemberId: null,
          userModified: false,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        this.items.set(item.id, item);
        await this.bump(listId);
        return json(route, 201, item, { etag: formatEtag(1) });
      }
    }

    const itemMatch = /^\/shopping-items\/([^/]+)$/.exec(path);
    if (itemMatch !== null) {
      const item = this.items.get(itemMatch[1] ?? '');
      if (item === undefined) return error(route, 404, 'not_found');
      if (method === 'PATCH') {
        const body = PatchShoppingItemRequest.parse(request.postDataJSON());
        if (isSetPicked(body)) {
          // Desired state, no revision check; an already satisfied state is a no-op.
          if (item.picked === body.picked)
            return json(route, 200, item, { etag: formatEtag(item.revision) });
          const updated = ShoppingItem.parse({
            ...item,
            picked: body.picked,
            pickedAt: body.picked ? now : null,
            pickedByMemberId: body.picked ? ME.member.id : null,
            revision: item.revision + 1,
            updatedAt: now,
          });
          this.items.set(item.id, updated);
          await this.bump(item.listId);
          return json(route, 200, updated, { etag: formatEtag(updated.revision) });
        }
        const ifMatch = request.headers()['if-match'];
        if (ifMatch === undefined) return error(route, 428, 'precondition_required');
        if (parseIfMatch(ifMatch) !== item.revision) return error(route, 409, 'stale_revision');
        const updated = ShoppingItem.parse({
          ...item,
          ...(body.name === undefined
            ? {}
            : { name: body.name, normalizedKey: body.name.trim().toLowerCase() }),
          ...(body.quantityText === undefined ? {} : { originalQuantityText: body.quantityText }),
          ...(body.note === undefined ? {} : { note: body.note }),
          ...(body.categoryId === undefined
            ? {}
            : { categoryId: body.categoryId ?? defaultCategory(body.name ?? item.name) }),
          userModified: true,
          revision: item.revision + 1,
          updatedAt: now,
        });
        this.items.set(item.id, updated);
        await this.bump(item.listId);
        return json(route, 200, updated, { etag: formatEtag(updated.revision) });
      }
      if (method === 'DELETE') {
        const ifMatch = request.headers()['if-match'];
        if (ifMatch === undefined) return error(route, 428, 'precondition_required');
        if (parseIfMatch(ifMatch) !== item.revision) return error(route, 409, 'stale_revision');
        this.items.delete(item.id);
        await this.bump(item.listId);
        return route.fulfill({ status: 204 });
      }
    }

    return error(route, 404, 'not_found');
  }
}
