import {
  NormalizedKey,
  ShoppingCategory,
  ShoppingCategoryList,
  ShoppingItem,
  ShoppingList,
  ShoppingListSnapshot,
  ShoppingListEvent,
  ShoppingListSummaryList,
} from '@mise/contracts';
import type {
  AddShoppingItemRequest,
  CreateShoppingCategoryRequest,
  CreateShoppingListRequest,
  EditShoppingItemRequest,
  PatchShoppingCategoryRequest,
  PatchShoppingListRequest,
  ShoppingListStatus,
} from '@mise/contracts';
import { normalizeKey, parseQuantityText } from '@mise/domain';
import { AppError, runIdempotent, withTransaction } from '../platform/index.js';
import type { Pool, Queryable, RequestContext, Tx } from '../platform/index.js';
import { categorize } from './categorize.js';
import type { ListEventHub, ListEventListener } from './events.js';
import * as repo from './repository.js';

/** Only the session-derived household and member are needed (hard rule 2). */
export type ShoppingActor = Pick<RequestContext, 'householdId' | 'memberId'>;

export interface Created<T> {
  value: T;
  /** 201 for a create, including a replay of it. */
  status: 201;
}

export interface ShoppingService {
  listCategories(actor: ShoppingActor): Promise<ShoppingCategoryList>;
  createCategory(
    actor: ShoppingActor,
    idempotencyKey: string,
    input: CreateShoppingCategoryRequest,
  ): Promise<Created<ShoppingCategory>>;
  /** Last write wins, no revision (owner decision, A13). System defaults are read-only. */
  patchCategory(
    actor: ShoppingActor,
    id: string,
    input: PatchShoppingCategoryRequest,
  ): Promise<ShoppingCategory>;

  listLists(actor: ShoppingActor, status?: ShoppingListStatus): Promise<ShoppingListSummaryList>;
  createList(
    actor: ShoppingActor,
    idempotencyKey: string,
    input: CreateShoppingListRequest,
  ): Promise<Created<ShoppingList>>;
  /** List plus items at one `changeSeq` (one snapshot transaction). */
  getSnapshot(actor: ShoppingActor, id: string): Promise<ShoppingListSnapshot>;
  patchList(
    actor: ShoppingActor,
    id: string,
    expectedRevision: number,
    input: PatchShoppingListRequest,
  ): Promise<ShoppingList>;
  /** The list's committed cursor; 404 unless the list is in the actor's household (A14). */
  currentEvent(actor: ShoppingActor, listId: string): Promise<ShoppingListEvent>;
  /** Change signals for one list of the actor's household, after commit only. */
  subscribe(actor: ShoppingActor, listId: string, listener: ListEventListener): () => void;

  addItem(
    actor: ShoppingActor,
    listId: string,
    idempotencyKey: string,
    input: AddShoppingItemRequest,
  ): Promise<Created<ShoppingItem>>;
  /** Desired state, idempotent, server-time last write wins; never checks a revision (ADR-013). */
  setPicked(actor: ShoppingActor, itemId: string, picked: boolean): Promise<ShoppingItem>;
  /** Detail edit; stale `expectedRevision` -> 409 `stale_revision`. */
  editItem(
    actor: ShoppingActor,
    itemId: string,
    expectedRevision: number,
    input: EditShoppingItemRequest,
  ): Promise<ShoppingItem>;
  deleteItem(actor: ShoppingActor, itemId: string, expectedRevision: number): Promise<void>;

  /**
   * Stores the household staple flag for a normalized key (ADR-015). No endpoint until plan
   * generation needs it (ADR-002 addendum, owner decision); Milestone D reads it.
   */
  setStaple(actor: ShoppingActor, normalizedKey: string, isStaple: boolean): Promise<void>;
}

const iso = (d: Date): string => d.toISOString();

const toCategoryDto = (c: repo.CategoryRow): ShoppingCategory =>
  ShoppingCategory.parse({
    id: c.id,
    systemCode: c.systemCode,
    name: c.name,
    sortOrder: c.sortOrder,
  });

const toListDto = (l: repo.ListRow): ShoppingList =>
  ShoppingList.parse({
    id: l.id,
    name: l.name,
    status: l.status,
    changeSeq: l.changeSeq,
    revision: l.revision,
    createdByMemberId: l.createdByMemberId,
    createdAt: iso(l.createdAt),
    updatedAt: iso(l.updatedAt),
  });

const toItemDto = (i: repo.ItemRow): ShoppingItem =>
  ShoppingItem.parse({
    id: i.id,
    listId: i.listId,
    origin: i.origin,
    name: i.name,
    normalizedKey: i.normalizedKey,
    amountMin: i.amountMin,
    amountMax: i.amountMax,
    unitCode: i.unitCode,
    originalQuantityText: i.originalQuantityText,
    note: i.note,
    categoryId: i.categoryId,
    picked: i.picked,
    pickedAt: i.pickedAt ? iso(i.pickedAt) : null,
    pickedByMemberId: i.pickedByMemberId,
    userModified: i.userModified,
    revision: i.revision,
    createdAt: iso(i.createdAt),
    updatedAt: iso(i.updatedAt),
  });

const listNotFound = () => new AppError('not_found', 'shopping list not found');
const itemNotFound = () => new AppError('not_found', 'shopping item not found');
const categoryNotFound = () => new AppError('not_found', 'shopping category not found');
const staleRevision = (current: number) =>
  new AppError('stale_revision', 'item was changed by someone else', { currentRevision: current });
const nameTaken = () =>
  new AppError('category_name_taken', 'a category with this name already exists');

/** Original quantity text is always kept; amounts only when the text parses exactly (hard rule 3). */
function quantityColumns(text: string | null) {
  const parsed = text === null ? null : parseQuantityText(text);
  return {
    originalQuantityText: text,
    amountMin: parsed?.amountMin ?? null,
    amountMax: parsed?.amountMax ?? null,
    unitCode: parsed?.unitCode ?? null,
  };
}

/** Same rule as the contract's `NormalizedKey`: lowercased and trimmed (ADR-015, Milestone A). */
const keyFor = (name: string): string | null => {
  const parsed = NormalizedKey.safeParse(normalizeKey(name));
  return parsed.success ? parsed.data : null;
};

export function createShoppingService(pool: Pool, events: ListEventHub): ShoppingService {
  /**
   * Signals open streams. Callers pass only a seq returned by `bumpChangeSeq` inside a transaction
   * that has already committed (DB §8.2); a rollback throws before this line, so it signals nothing.
   */
  const signal = (actor: ShoppingActor, listId: string, seq: number | null) => {
    if (seq === null) return;
    events.publish(actor.householdId, ShoppingListEvent.parse({ listId, seq }));
  };

  /** A category the household may use: a system default or its own (ADR-002 addendum, item 4). */
  async function assertUsableCategory(q: Queryable, actor: ShoppingActor, id: string) {
    if (!(await repo.getVisibleCategory(q, actor.householdId, id))) throw categoryNotFound();
  }

  /**
   * The item's category and, when needed, the household correction (FR-36, ADR-015 addendum).
   * The default for a name is what the categorizer returns now, including any existing override.
   * - no choice (`undefined`) or `null`: the default; nothing is written.
   * - a choice equal to the default: nothing is written, so re-sending the current category with
   *   every edit never creates or pins an override.
   * - a different choice: written as the override for the key (replacing any earlier one).
   * Resetting a correction to the system default is a separate action, never a side effect here.
   */
  async function resolveCategory(
    tx: Tx,
    actor: ShoppingActor,
    normalizedKey: string | null,
    chosen: string | null | undefined,
  ): Promise<string> {
    if (chosen !== undefined && chosen !== null) await assertUsableCategory(tx, actor, chosen);
    const fallback = await categorize(tx, { householdId: actor.householdId, normalizedKey });
    if (chosen === undefined || chosen === null) return fallback;
    if (chosen !== fallback && normalizedKey !== null) {
      await repo.upsertCategoryOverride(tx, actor.householdId, normalizedKey, chosen);
    }
    return chosen;
  }

  async function loadList(actor: ShoppingActor, id: string, q: Queryable = pool) {
    const list = await repo.getList(q, actor.householdId, id);
    if (!list) throw listNotFound();
    return list;
  }

  async function loadItem(actor: ShoppingActor, id: string, q: Queryable = pool) {
    const item = await repo.getItem(q, actor.householdId, id);
    if (!item) throw itemNotFound();
    return item;
  }

  /** Locks the list row (serializes all writers on the list), then rejects archived lists. */
  async function lockActiveList(tx: Tx, actor: ShoppingActor, listId: string) {
    const list = await repo.getList(tx, actor.householdId, listId, true);
    if (!list) throw listNotFound();
    if (list.status !== 'active') {
      throw new AppError('conflict', 'shopping list is archived', { reason: 'list_archived' });
    }
    return list;
  }

  /** Lock order is always list -> item, so concurrent writers on one list cannot deadlock. */
  async function lockItemForWrite(tx: Tx, actor: ShoppingActor, itemId: string) {
    const unlocked = await repo.getItem(tx, actor.householdId, itemId);
    if (!unlocked) throw itemNotFound();
    await lockActiveList(tx, actor, unlocked.listId);
    const item = await repo.getItem(tx, actor.householdId, itemId, true);
    if (!item) throw itemNotFound(); // deleted while we waited for the list lock
    return item;
  }

  async function loadCategory(actor: ShoppingActor, id: string, q: Queryable = pool) {
    const c = await repo.getVisibleCategory(q, actor.householdId, id);
    if (!c) throw categoryNotFound();
    return c;
  }

  return {
    async listCategories(actor) {
      const rows = await repo.listCategories(pool, actor.householdId);
      return ShoppingCategoryList.parse({ items: rows.map(toCategoryDto) });
    },

    async createCategory(actor, idempotencyKey, input) {
      const outcome = await runIdempotent(
        pool,
        {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          operation: 'shopping.categories.create',
        },
        idempotencyKey,
        input,
        async (tx) => {
          await repo.lockCategoryNames(tx, actor.householdId);
          if (await repo.categoryNameTaken(tx, actor.householdId, input.name, null)) {
            throw nameTaken();
          }
          const sortOrder =
            input.sortOrder ?? (await repo.nextCategorySortOrder(tx, actor.householdId));
          const id = await repo.insertCategory(tx, actor.householdId, input.name, sortOrder);
          return {
            resultRef: { status: 201, resourceType: 'shopping_category', resourceId: id },
            value: id,
          };
        },
      );
      return {
        value: toCategoryDto(await loadCategory(actor, outcome.resultRef.resourceId)),
        status: 201,
      };
    },

    async patchCategory(actor, id, input) {
      await withTransaction(pool, async (tx) => {
        await repo.lockCategoryNames(tx, actor.householdId);
        const cur = await loadCategory(actor, id, tx);
        if (cur.householdId === null) {
          throw new AppError('forbidden', 'system categories cannot be changed');
        }
        if (
          input.name !== undefined &&
          (await repo.categoryNameTaken(tx, actor.householdId, input.name, id))
        ) {
          throw nameTaken();
        }
        await repo.updateCategory(tx, actor.householdId, id, input);
      });
      return toCategoryDto(await loadCategory(actor, id));
    },

    async listLists(actor, status = 'active') {
      const rows = await repo.listLists(pool, actor.householdId, status);
      return ShoppingListSummaryList.parse({ items: rows.map(toListDto) });
    },

    async createList(actor, idempotencyKey, input) {
      const outcome = await runIdempotent(
        pool,
        {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          operation: 'shopping.lists.create',
        },
        idempotencyKey,
        input,
        async (tx) => {
          const id = await repo.insertList(tx, actor.householdId, actor.memberId, input.name);
          return {
            resultRef: { status: 201, resourceType: 'shopping_list', resourceId: id },
            value: id,
          };
        },
      );
      return { value: toListDto(await loadList(actor, outcome.resultRef.resourceId)), status: 201 };
    },

    async getSnapshot(actor, id) {
      // One REPEATABLE READ snapshot: the items are exactly the state at `changeSeq`, so a client
      // that refetches after an SSE event never sees a cursor newer than its items.
      return withTransaction(pool, async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const list = await loadList(actor, id, tx);
        const items = await repo.listItems(tx, actor.householdId, id);
        return ShoppingListSnapshot.parse({ list: toListDto(list), items: items.map(toItemDto) });
      });
    },

    async patchList(actor, id, expectedRevision, input) {
      await withTransaction(pool, async (tx) => {
        const cur = await repo.getList(tx, actor.householdId, id, true);
        if (!cur) throw listNotFound();
        if (cur.revision !== expectedRevision) {
          throw new AppError('stale_revision', 'list was changed by someone else', {
            currentRevision: cur.revision,
          });
        }
        const name = input.name ?? cur.name;
        const status = input.status ?? cur.status;
        if (name === cur.name && status === cur.status) return; // nothing to do
        await repo.updateList(tx, actor.householdId, id, { name, status });
      });
      return toListDto(await loadList(actor, id));
    },

    async currentEvent(actor, listId) {
      const list = await loadList(actor, listId);
      return ShoppingListEvent.parse({ listId: list.id, seq: list.changeSeq });
    },

    subscribe(actor, listId, listener) {
      return events.subscribe(actor.householdId, listId, listener);
    },

    async addItem(actor, listId, idempotencyKey, input) {
      const outcome = await runIdempotent(
        pool,
        {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          operation: 'shopping.items.add',
        },
        idempotencyKey,
        { listId, input },
        async (tx) => {
          await lockActiveList(tx, actor, listId);
          const normalizedKey = keyFor(input.name);
          const categoryId = await resolveCategory(tx, actor, normalizedKey, input.categoryId);
          const id = await repo.insertUserItem(tx, actor.householdId, listId, {
            name: input.name,
            normalizedKey,
            ...quantityColumns(input.quantityText ?? null),
            note: input.note ?? null,
            categoryId,
          });
          const seq = await repo.bumpChangeSeq(tx, actor.householdId, listId);
          return {
            resultRef: { status: 201, resourceType: 'shopping_item', resourceId: id },
            value: seq,
          };
        },
      );
      // A replay changed nothing now, so it signals nothing.
      if (!outcome.replayed) signal(actor, listId, outcome.value);
      return { value: toItemDto(await loadItem(actor, outcome.resultRef.resourceId)), status: 201 };
    },

    async setPicked(actor, itemId, picked) {
      const { listId, seq } = await withTransaction(pool, async (tx) => {
        const item = await lockItemForWrite(tx, actor, itemId);
        const changed = await repo.setPicked(tx, actor.householdId, itemId, picked, actor.memberId);
        // An already-satisfied desired state is a no-op: no attribution change, no cursor bump.
        const bumped = changed
          ? await repo.bumpChangeSeq(tx, actor.householdId, item.listId)
          : null;
        return { listId: item.listId, seq: bumped };
      });
      signal(actor, listId, seq);
      return toItemDto(await loadItem(actor, itemId));
    },

    async editItem(actor, itemId, expectedRevision, input) {
      const { listId, seq } = await withTransaction(pool, async (tx) => {
        const cur = await lockItemForWrite(tx, actor, itemId);
        if (cur.revision !== expectedRevision) throw staleRevision(cur.revision);

        const name = input.name ?? cur.name;
        const normalizedKey = input.name === undefined ? cur.normalizedKey : keyFor(name);
        const quantity =
          input.quantityText === undefined
            ? {
                originalQuantityText: cur.originalQuantityText,
                amountMin: cur.amountMin,
                amountMax: cur.amountMax,
                unitCode: cur.unitCode,
              }
            : quantityColumns(input.quantityText);
        const note = input.note === undefined ? cur.note : input.note;

        // A rename keeps the category: it may have been chosen on purpose (owner decision, A13).
        const categoryId =
          input.categoryId === undefined
            ? cur.categoryId
            : await resolveCategory(tx, actor, normalizedKey, input.categoryId);

        const next: repo.ItemDetails = { name, normalizedKey, ...quantity, note, categoryId };
        const unchanged =
          next.name === cur.name &&
          next.normalizedKey === cur.normalizedKey &&
          next.originalQuantityText === cur.originalQuantityText &&
          next.note === cur.note &&
          next.categoryId === cur.categoryId;
        if (unchanged) return { listId: cur.listId, seq: null }; // no revision or cursor bump

        await repo.updateItemDetails(tx, actor.householdId, itemId, next);
        return {
          listId: cur.listId,
          seq: await repo.bumpChangeSeq(tx, actor.householdId, cur.listId),
        };
      });
      signal(actor, listId, seq);
      return toItemDto(await loadItem(actor, itemId));
    },

    async deleteItem(actor, itemId, expectedRevision) {
      const { listId, seq } = await withTransaction(pool, async (tx) => {
        const cur = await lockItemForWrite(tx, actor, itemId);
        if (cur.revision !== expectedRevision) throw staleRevision(cur.revision);
        await repo.deleteItem(tx, actor.householdId, itemId);
        return {
          listId: cur.listId,
          seq: await repo.bumpChangeSeq(tx, actor.householdId, cur.listId),
        };
      });
      signal(actor, listId, seq);
    },

    async setStaple(actor, normalizedKey, isStaple) {
      const key = NormalizedKey.parse(normalizedKey);
      await repo.upsertStaple(pool, actor.householdId, key, isStaple);
    },
  };
}
