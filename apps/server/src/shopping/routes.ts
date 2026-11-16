import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  AddShoppingItemRequest,
  CreateShoppingCategoryRequest,
  CreateShoppingListRequest,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_IF_MATCH,
  PatchShoppingCategoryRequest,
  PatchShoppingItemRequest,
  PatchShoppingListRequest,
  ShoppingCategoryParams,
  ShoppingItemParams,
  ShoppingListParams,
  ShoppingListsQuery,
  formatEtag,
  isSetPicked,
} from '@mise/contracts';
import type { ShoppingItem, ShoppingList } from '@mise/contracts';
import { parseIdempotencyKey, parseIfMatchHeader, requireActor } from '../platform/index.js';
import type { ShoppingService } from './service.js';

const idempotencyKey = (request: FastifyRequest): string =>
  parseIdempotencyKey(request.headers[HEADER_IDEMPOTENCY_KEY]);

const sendRevisioned = (
  reply: FastifyReply,
  status: 200 | 201,
  body: ShoppingList | ShoppingItem,
) => reply.code(status).header('etag', formatEtag(body.revision)).send(body);

/** Handlers only parse, authenticate, call one service method and map the result (server rules). */
export function registerShoppingRoutes(app: FastifyInstance, service: ShoppingService): void {
  const categories = `${API_PREFIX}/shopping-categories`;
  const lists = `${API_PREFIX}/shopping-lists`;
  const items = `${API_PREFIX}/shopping-items`;

  app.get(categories, async (request) => service.listCategories(requireActor(request)));

  app.post(categories, async (request, reply) => {
    const actor = requireActor(request);
    const body = CreateShoppingCategoryRequest.parse(request.body);
    const { value, status } = await service.createCategory(actor, idempotencyKey(request), body);
    return reply.code(status).send(value);
  });

  app.patch(`${categories}/:id`, async (request) => {
    const actor = requireActor(request);
    const { id } = ShoppingCategoryParams.parse(request.params);
    const body = PatchShoppingCategoryRequest.parse(request.body);
    return service.patchCategory(actor, id, body);
  });

  app.get(lists, async (request) => {
    const actor = requireActor(request);
    const { status } = ShoppingListsQuery.parse(request.query);
    return service.listLists(actor, status);
  });

  app.post(lists, async (request, reply) => {
    const actor = requireActor(request);
    const body = CreateShoppingListRequest.parse(request.body);
    const { value, status } = await service.createList(actor, idempotencyKey(request), body);
    return sendRevisioned(reply, status, value);
  });

  // No ETag: item changes do not bump the list revision (ADR-013 addendum).
  app.get(`${lists}/:id`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = ShoppingListParams.parse(request.params);
    const snapshot = await service.getSnapshot(actor, id);
    return reply.header('cache-control', 'no-store').send(snapshot);
  });

  app.patch(`${lists}/:id`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = ShoppingListParams.parse(request.params);
    const body = PatchShoppingListRequest.parse(request.body);
    const list = await service.patchList(
      actor,
      id,
      parseIfMatchHeader(request.headers[HEADER_IF_MATCH]),
      body,
    );
    return sendRevisioned(reply, 200, list);
  });

  app.post(`${lists}/:id/items`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = ShoppingListParams.parse(request.params);
    const body = AddShoppingItemRequest.parse(request.body);
    const { value, status } = await service.addItem(actor, id, idempotencyKey(request), body);
    return sendRevisioned(reply, status, value);
  });

  app.patch(`${items}/:id`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = ShoppingItemParams.parse(request.params);
    const body = PatchShoppingItemRequest.parse(request.body);
    // Checkoff ignores revisions entirely (ADR-013): an unrelated edit can never reject it.
    const item = isSetPicked(body)
      ? await service.setPicked(actor, id, body.picked)
      : await service.editItem(
          actor,
          id,
          parseIfMatchHeader(request.headers[HEADER_IF_MATCH]),
          body,
        );
    return sendRevisioned(reply, 200, item);
  });

  app.delete(`${items}/:id`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = ShoppingItemParams.parse(request.params);
    await service.deleteItem(actor, id, parseIfMatchHeader(request.headers[HEADER_IF_MATCH]));
    return reply.code(204).send();
  });
}
