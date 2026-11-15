import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  CreateRecipeRequest,
  PatchRecipeRequest,
  RecipeParams,
  RecipeSearchQuery,
  RecipeVersionParams,
  RestoreRecipeRequest,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_IF_MATCH,
  formatEtag,
  parseIfMatch,
} from '@mise/contracts';
import { AppError, parseIdempotencyKey, requireActor } from '../platform/index.js';
import type { RecipeResult, RecipesService } from './service.js';

/** Missing `If-Match` -> 428, malformed -> 400 (stale is decided by the service -> 409). */
function expectedRevision(request: FastifyRequest): number {
  const header = request.headers[HEADER_IF_MATCH];
  if (header === undefined) {
    throw new AppError('precondition_required', 'If-Match header is required');
  }
  const revision = typeof header === 'string' ? parseIfMatch(header) : null;
  if (revision === null) throw new AppError('validation_failed', 'If-Match is malformed');
  return revision;
}

const idempotencyKey = (request: FastifyRequest): string =>
  parseIdempotencyKey(request.headers[HEADER_IDEMPOTENCY_KEY]);

const send = (reply: FastifyReply, { recipe, status }: RecipeResult) =>
  reply.code(status).header('etag', formatEtag(recipe.revision)).send(recipe);

/** Handlers only parse, authenticate, call one service method and map the result (server rules). */
export function registerRecipeRoutes(app: FastifyInstance, service: RecipesService): void {
  const base = `${API_PREFIX}/recipes`;

  app.get(base, async (request) => {
    const query = RecipeSearchQuery.parse(request.query);
    return service.searchRecipes(requireActor(request), query);
  });

  app.post(base, async (request, reply) => {
    const actor = requireActor(request);
    const body = CreateRecipeRequest.parse(request.body);
    return send(reply, await service.createRecipe(actor, idempotencyKey(request), body));
  });

  app.get(`${base}/:id`, async (request, reply) => {
    const { id } = RecipeParams.parse(request.params);
    const recipe = await service.getRecipe(requireActor(request), id);
    return send(reply, { recipe, status: 200 });
  });

  app.patch(`${base}/:id`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = RecipeParams.parse(request.params);
    const body = PatchRecipeRequest.parse(request.body);
    const recipe = await service.patchRecipe(actor, id, expectedRevision(request), body);
    return send(reply, { recipe, status: 200 });
  });

  app.get(`${base}/:id/versions`, async (request) => {
    const { id } = RecipeParams.parse(request.params);
    return service.listVersions(requireActor(request), id);
  });

  app.get(`${base}/:id/versions/:versionId`, async (request) => {
    const { id, versionId } = RecipeVersionParams.parse(request.params);
    return service.getVersion(requireActor(request), id, versionId);
  });

  app.post(`${base}/:id/restore`, async (request, reply) => {
    const actor = requireActor(request);
    const { id } = RecipeParams.parse(request.params);
    const body = RestoreRecipeRequest.parse(request.body);
    const revision = expectedRevision(request);
    return send(
      reply,
      await service.restoreRecipe(actor, id, revision, idempotencyKey(request), body),
    );
  });
}
