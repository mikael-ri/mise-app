import {
  API_PREFIX,
  HEADER_IDEMPOTENCY_KEY,
  HouseholdMemberList,
  ShoppingCategoryList,
  ShoppingItem,
  ShoppingList,
  ShoppingListSnapshot,
  ShoppingListSummaryList,
  formatEtag,
} from '@mise/contracts';
import type {
  AddShoppingItemRequest,
  CreateShoppingListRequest,
  EditShoppingItemRequest,
  PatchShoppingListRequest,
  HouseholdMember,
  ShoppingCategory,
} from '@mise/contracts';
import type { ApiClient } from '../../lib/api-client.js';

const IF_MATCH = 'If-Match';

export interface ShoppingApi {
  listLists(status: 'active' | 'archived'): Promise<ShoppingList[]>;
  createList(body: CreateShoppingListRequest, idempotencyKey: string): Promise<ShoppingList>;
  getSnapshot(listId: string): Promise<ShoppingListSnapshot>;
  /** `revision` is the list revision (name, status); stale -> 409. */
  patchList(
    listId: string,
    revision: number,
    body: PatchShoppingListRequest,
  ): Promise<ShoppingList>;
  addItem(
    listId: string,
    body: AddShoppingItemRequest,
    idempotencyKey: string,
  ): Promise<ShoppingItem>;
  /** Checkoff: desired state, never a toggle, no revision (ADR-013). */
  setPicked(itemId: string, picked: boolean): Promise<ShoppingItem>;
  /** Detail edit; `revision` is the item revision the form was loaded from; stale -> 409. */
  editItem(itemId: string, revision: number, body: EditShoppingItemRequest): Promise<ShoppingItem>;
  deleteItem(itemId: string, revision: number): Promise<void>;
  listCategories(): Promise<ShoppingCategory[]>;
  /** Household members (id + display name), read-only, for attribution lines. */
  listMembers(): Promise<HouseholdMember[]>;
}

const listPath = (id: string) => `${API_PREFIX}/shopping-lists/${encodeURIComponent(id)}`;
const itemPath = (id: string) => `${API_PREFIX}/shopping-items/${encodeURIComponent(id)}`;

/** SSE endpoint for one list; the stream carries only `{listId, seq}`. */
export const eventsPath = (listId: string): string => `${listPath(listId)}/events`;

export function createShoppingApi(client: ApiClient): ShoppingApi {
  return {
    async listLists(status) {
      const list = await client.request({
        path: `${API_PREFIX}/shopping-lists?status=${status}`,
        schema: ShoppingListSummaryList,
      });
      return list.items;
    },
    createList: (body, key) =>
      client.request({
        method: 'POST',
        path: `${API_PREFIX}/shopping-lists`,
        body,
        headers: { [HEADER_IDEMPOTENCY_KEY]: key },
        schema: ShoppingList,
      }),
    getSnapshot: (listId) =>
      client.request({ path: listPath(listId), schema: ShoppingListSnapshot }),
    patchList: (listId, revision, body) =>
      client.request({
        method: 'PATCH',
        path: listPath(listId),
        body,
        headers: { [IF_MATCH]: formatEtag(revision) },
        schema: ShoppingList,
      }),
    addItem: (listId, body, key) =>
      client.request({
        method: 'POST',
        path: `${listPath(listId)}/items`,
        body,
        headers: { [HEADER_IDEMPOTENCY_KEY]: key },
        schema: ShoppingItem,
      }),
    setPicked: (itemId, picked) =>
      client.request({
        method: 'PATCH',
        path: itemPath(itemId),
        body: { picked },
        schema: ShoppingItem,
      }),
    editItem: (itemId, revision, body) =>
      client.request({
        method: 'PATCH',
        path: itemPath(itemId),
        body,
        headers: { [IF_MATCH]: formatEtag(revision) },
        schema: ShoppingItem,
      }),
    deleteItem: (itemId, revision) =>
      client.request({
        method: 'DELETE',
        path: itemPath(itemId),
        headers: { [IF_MATCH]: formatEtag(revision) },
      }),
    async listCategories() {
      const list = await client.request({
        path: `${API_PREFIX}/shopping-categories`,
        schema: ShoppingCategoryList,
      });
      return list.items;
    },
    async listMembers() {
      const list = await client.request({
        path: `${API_PREFIX}/household/members`,
        schema: HouseholdMemberList,
      });
      return list.items;
    },
  };
}
