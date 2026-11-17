import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  CreateRecipeRequest,
  PatchRecipeRequest,
  RecipeExportQuery,
  RecipeParams,
  RecipeSearchQuery,
  RecipeVersionParams,
  RestoreRecipeRequest,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_IF_MATCH,
  formatEtag,
} from '@mise/contracts';
import { parseIdempotencyKey, parseIfMatchHeader, requireActor } from '../platform/index.js';
import type { RecipeResult, RecipesService } from './service.js';

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

  // Registered as a static path; find-my-way prefers it over `/:id`.
  app.get(`${base}/export`, async (request, reply) => {
    const { format } = RecipeExportQuery.parse(request.query);
    const actor = requireActor(request);
    if (format === 'md') {
      const md = await service.exportRecipesMarkdown(actor);
      return reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header('content-disposition', 'attachment; filename="recipes.md"')
        .send(md);
    }
    reply.header('content-disposition', 'attachment; filename="recipes.json"');
    return service.exportRecipes(actor);
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
    const recipe = await service.patchRecipe(
      actor,
      id,
      parseIfMatchHeader(request.headers[HEADER_IF_MATCH]),
      body,
    );
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
    const revision = parseIfMatchHeader(request.headers[HEADER_IF_MATCH]);
    return send(
      reply,
      await service.restoreRecipe(actor, id, revision, idempotencyKey(request), body),
    );
  });
}
