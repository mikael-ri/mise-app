import type { z } from 'zod';
import {
  DeviceSessionList,
  DeviceSessionParams,
  MeResponse,
  OidcCallbackQuery,
  OidcStartQuery,
} from './auth.js';
import { HealthOk, HealthUnavailable } from './health.js';
import {
  CreateRecipeRequest,
  PatchRecipeRequest,
  Recipe,
  RecipeList,
  RecipeParams,
  RecipeSearchQuery,
  RecipeVersion,
  RecipeVersionList,
  RecipeVersionParams,
  RestoreRecipeRequest,
} from './recipes.js';
import {
  AddShoppingItemRequest,
  CreateShoppingListRequest,
  PatchShoppingItemRequest,
  PatchShoppingListRequest,
  ShoppingCategoryList,
  ShoppingItem,
  ShoppingItemParams,
  ShoppingList,
  ShoppingListEvent,
  ShoppingListParams,
  ShoppingListSnapshot,
  ShoppingListSummaryList,
  ShoppingListsQuery,
} from './shopping.js';

export const API_PREFIX = '/api/v1';

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
  /** Response carries `ETag: "<revision>"`. */
  etag?: boolean;
  /** `text/event-stream` whose `data:` lines carry `schema`. */
  eventStream?: boolean;
  /** Redirect with a `Location` header. */
  redirect?: boolean;
}

export interface RouteDef {
  operationId: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  /** Path below API_PREFIX, OpenAPI style (`{id}`). */
  path: string;
  tag: 'auth' | 'health' | 'recipes' | 'shopping';
  summary: string;
  /** False only for health and the OIDC login endpoints. */
  auth: boolean;
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType;
  /**
   * `If-Match` (missing -> 428, stale -> 409). `required-for-edits`: required unless the body is a
   * desired-state checkoff (`isSetPicked`), which is last-write-wins and ignores revisions.
   */
  ifMatch?: 'required' | 'required-for-edits';
  /** Requires `Idempotency-Key`. */
  idempotencyKey?: boolean;
  responses: Record<number, RouteResponse>;
}

const noContent: RouteResponse = { description: 'Done' };

// Single source for every Milestone A endpoint. Error responses (ErrorBody) are added by the generator.
export const ROUTES: readonly RouteDef[] = [
  // Health
  {
    operationId: 'healthLive',
    method: 'get',
    path: '/health/live',
    tag: 'health',
    summary: 'Liveness',
    auth: false,
    responses: { 200: { description: 'Process is up', schema: HealthOk } },
  },
  {
    operationId: 'healthReady',
    method: 'get',
    path: '/health/ready',
    tag: 'health',
    summary: 'Readiness (database reachable)',
    auth: false,
    responses: {
      200: { description: 'Ready', schema: HealthOk },
      503: { description: 'Not ready', schema: HealthUnavailable },
    },
  },

  // Auth (ADR-003): no password endpoints exist.
  {
    operationId: 'oidcStart',
    method: 'get',
    path: '/auth/oidc/start',
    tag: 'auth',
    summary: 'Start a fresh OIDC login (code + PKCE, forced re-authentication)',
    auth: false,
    query: OidcStartQuery,
    responses: { 302: { description: 'Redirect to the identity provider', redirect: true } },
  },
  {
    operationId: 'oidcCallback',
    method: 'get',
    path: '/auth/oidc/callback',
    tag: 'auth',
    summary: 'OIDC callback; creates a new device session on verified fresh authentication',
    auth: false,
    query: OidcCallbackQuery,
    responses: {
      302: { description: 'Redirect into the app (session cookie set)', redirect: true },
    },
  },
  {
    operationId: 'logout',
    method: 'post',
    path: '/auth/logout',
    tag: 'auth',
    summary: 'Revoke the current device session',
    auth: true,
    responses: { 204: noContent },
  },
  {
    operationId: 'getMe',
    method: 'get',
    path: '/auth/me',
    tag: 'auth',
    summary: 'Current user, household membership and session',
    auth: true,
    responses: { 200: { description: 'Current identity', schema: MeResponse } },
  },
  {
    operationId: 'listDevices',
    method: 'get',
    path: '/auth/devices',
    tag: 'auth',
    summary: "List the current user's device sessions",
    auth: true,
    responses: { 200: { description: 'Device sessions', schema: DeviceSessionList } },
  },
  {
    operationId: 'revokeDevice',
    method: 'delete',
    path: '/auth/devices/{sessionId}',
    tag: 'auth',
    summary: "Revoke one of the current user's device sessions",
    auth: true,
    params: DeviceSessionParams,
    responses: { 204: noContent },
  },

  // Recipes
  {
    operationId: 'searchRecipes',
    method: 'get',
    path: '/recipes',
    tag: 'recipes',
    summary: 'List or search household recipes',
    auth: true,
    query: RecipeSearchQuery,
    responses: { 200: { description: 'Matching recipes', schema: RecipeList } },
  },
  {
    operationId: 'createRecipe',
    method: 'post',
    path: '/recipes',
    tag: 'recipes',
    summary: 'Create a recipe with version 1',
    auth: true,
    body: CreateRecipeRequest,
    idempotencyKey: true,
    responses: { 201: { description: 'Created (or replayed)', schema: Recipe, etag: true } },
  },
  {
    operationId: 'getRecipe',
    method: 'get',
    path: '/recipes/{id}',
    tag: 'recipes',
    summary: 'Get a recipe with its current version',
    auth: true,
    params: RecipeParams,
    responses: { 200: { description: 'Recipe', schema: Recipe, etag: true } },
  },
  {
    operationId: 'patchRecipe',
    method: 'patch',
    path: '/recipes/{id}',
    tag: 'recipes',
    summary: 'Edit metadata and/or create a new version',
    auth: true,
    params: RecipeParams,
    body: PatchRecipeRequest,
    ifMatch: 'required',
    responses: { 200: { description: 'Updated', schema: Recipe, etag: true } },
  },
  {
    operationId: 'listRecipeVersions',
    method: 'get',
    path: '/recipes/{id}/versions',
    tag: 'recipes',
    summary: 'Version history, newest first',
    auth: true,
    params: RecipeParams,
    responses: { 200: { description: 'Versions', schema: RecipeVersionList } },
  },
  {
    operationId: 'getRecipeVersion',
    method: 'get',
    path: '/recipes/{id}/versions/{versionId}',
    tag: 'recipes',
    summary: 'One historical version with its content',
    auth: true,
    params: RecipeVersionParams,
    responses: { 200: { description: 'Version', schema: RecipeVersion } },
  },
  {
    operationId: 'restoreRecipeVersion',
    method: 'post',
    path: '/recipes/{id}/restore',
    tag: 'recipes',
    summary: 'Copy an earlier version into a new current version',
    auth: true,
    params: RecipeParams,
    body: RestoreRecipeRequest,
    ifMatch: 'required',
    idempotencyKey: true,
    responses: { 200: { description: 'Restored (or replayed)', schema: Recipe, etag: true } },
  },

  // Shopping
  {
    operationId: 'listShoppingCategories',
    method: 'get',
    path: '/shopping-categories',
    tag: 'shopping',
    summary: 'System and household shopping categories',
    auth: true,
    responses: { 200: { description: 'Categories', schema: ShoppingCategoryList } },
  },
  {
    operationId: 'listShoppingLists',
    method: 'get',
    path: '/shopping-lists',
    tag: 'shopping',
    summary: 'Household shopping lists (default: active)',
    auth: true,
    query: ShoppingListsQuery,
    responses: { 200: { description: 'Lists', schema: ShoppingListSummaryList } },
  },
  {
    operationId: 'createShoppingList',
    method: 'post',
    path: '/shopping-lists',
    tag: 'shopping',
    summary: 'Create a shopping list',
    auth: true,
    body: CreateShoppingListRequest,
    idempotencyKey: true,
    responses: { 201: { description: 'Created (or replayed)', schema: ShoppingList, etag: true } },
  },
  {
    operationId: 'getShoppingList',
    method: 'get',
    path: '/shopping-lists/{id}',
    tag: 'shopping',
    summary: 'Authoritative list snapshot with items and change_seq',
    auth: true,
    params: ShoppingListParams,
    // No ETag: item changes do not bump the list revision, so a list ETag here would be stale. Served no-store.
    responses: {
      200: { description: 'Snapshot (Cache-Control: no-store)', schema: ShoppingListSnapshot },
    },
  },
  {
    operationId: 'patchShoppingList',
    method: 'patch',
    path: '/shopping-lists/{id}',
    tag: 'shopping',
    summary: 'Rename or archive a list',
    auth: true,
    params: ShoppingListParams,
    body: PatchShoppingListRequest,
    ifMatch: 'required',
    responses: { 200: { description: 'Updated', schema: ShoppingList, etag: true } },
  },
  {
    operationId: 'addShoppingItem',
    method: 'post',
    path: '/shopping-lists/{id}/items',
    tag: 'shopping',
    summary: 'Add a user item',
    auth: true,
    params: ShoppingListParams,
    body: AddShoppingItemRequest,
    idempotencyKey: true,
    responses: { 201: { description: 'Created (or replayed)', schema: ShoppingItem, etag: true } },
  },
  {
    operationId: 'patchShoppingItem',
    method: 'patch',
    path: '/shopping-items/{id}',
    tag: 'shopping',
    summary:
      'Set picked state (no If-Match, last write wins) or edit details (If-Match required); never both',
    auth: true,
    params: ShoppingItemParams,
    body: PatchShoppingItemRequest,
    ifMatch: 'required-for-edits',
    responses: { 200: { description: 'Updated', schema: ShoppingItem, etag: true } },
  },
  {
    operationId: 'deleteShoppingItem',
    method: 'delete',
    path: '/shopping-items/{id}',
    tag: 'shopping',
    summary: 'Remove an item',
    auth: true,
    params: ShoppingItemParams,
    ifMatch: 'required',
    responses: { 204: noContent },
  },
  {
    operationId: 'shoppingListEvents',
    method: 'get',
    path: '/shopping-lists/{id}/events',
    tag: 'shopping',
    summary: 'SSE stream of {listId, seq}; refetch the snapshot on each event and on reconnect',
    auth: true,
    params: ShoppingListParams,
    responses: {
      200: { description: 'Event stream', schema: ShoppingListEvent, eventStream: true },
    },
  },
];
