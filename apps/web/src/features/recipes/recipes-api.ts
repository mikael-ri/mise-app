import {
  API_PREFIX,
  HEADER_IDEMPOTENCY_KEY,
  Recipe,
  RecipeList,
  RecipeVersion,
  RecipeVersionList,
  formatEtag,
} from '@mise/contracts';
import type {
  CreateRecipeRequest,
  PatchRecipeRequest,
  RecipeSearchQuery,
  RecipeVersionMeta,
} from '@mise/contracts';
import type { ApiClient } from '../../lib/api-client.js';

/** Header names as the contract defines them; the client sends them as given. */
const IF_MATCH = 'If-Match';
const IDEMPOTENCY_KEY = HEADER_IDEMPOTENCY_KEY;

export interface RecipesApi {
  search(query: RecipeSearchQuery): Promise<RecipeList>;
  get(id: string): Promise<Recipe>;
  create(body: CreateRecipeRequest, idempotencyKey: string): Promise<Recipe>;
  /** `revision` is the recipe revision the edit is based on; stale -> 409 `stale_revision`. */
  patch(id: string, revision: number, body: PatchRecipeRequest): Promise<Recipe>;
  listVersions(id: string): Promise<RecipeVersionMeta[]>;
  getVersion(id: string, versionId: string): Promise<RecipeVersion>;
  restore(id: string, revision: number, versionId: string, idempotencyKey: string): Promise<Recipe>;
}

export function searchPath(query: RecipeSearchQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set('q', query.q);
  for (const tag of query.tags ?? []) params.append('tags', tag);
  if (query.maxTime !== undefined) params.set('maxTime', String(query.maxTime));
  if (query.includeArchived !== undefined)
    params.set('includeArchived', String(query.includeArchived));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return `${API_PREFIX}/recipes${qs === '' ? '' : `?${qs}`}`;
}

const recipePath = (id: string) => `${API_PREFIX}/recipes/${encodeURIComponent(id)}`;

export function createRecipesApi(client: ApiClient): RecipesApi {
  return {
    search: (query) => client.request({ path: searchPath(query), schema: RecipeList }),
    get: (id) => client.request({ path: recipePath(id), schema: Recipe }),
    create: (body, key) =>
      client.request({
        method: 'POST',
        path: `${API_PREFIX}/recipes`,
        body,
        headers: { [IDEMPOTENCY_KEY]: key },
        schema: Recipe,
      }),
    patch: (id, revision, body) =>
      client.request({
        method: 'PATCH',
        path: recipePath(id),
        body,
        headers: { [IF_MATCH]: formatEtag(revision) },
        schema: Recipe,
      }),
    async listVersions(id) {
      const list = await client.request({
        path: `${recipePath(id)}/versions`,
        schema: RecipeVersionList,
      });
      return list.items;
    },
    getVersion: (id, versionId) =>
      client.request({
        path: `${recipePath(id)}/versions/${encodeURIComponent(versionId)}`,
        schema: RecipeVersion,
      }),
    restore: (id, revision, versionId, key) =>
      client.request({
        method: 'POST',
        path: `${recipePath(id)}/restore`,
        body: { versionId },
        headers: { [IF_MATCH]: formatEtag(revision), [IDEMPOTENCY_KEY]: key },
        schema: Recipe,
      }),
  };
}
