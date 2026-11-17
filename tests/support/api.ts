// Direct API access for seeding and asserting in E2E, as a signed-in member. Uses the member's browser
// context (so the session cookie is the real device session) and every body and response goes through
// the @mise/contracts schemas. Mutations send what the real client sends: Origin, CSRF token, Idempotency-Key.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { E2E_ORIGIN as ORIGIN } from './e2e-ports.js';
import {
  CreateRecipeRequest,
  CreateShoppingListRequest,
  MeResponse,
  PatchRecipeRequest,
  Recipe,
  ShoppingList,
  formatEtag,
} from '../../packages/contracts/src/index.js';

export class MemberApi {
  private csrf: string | undefined;
  constructor(private readonly request: APIRequestContext) {}

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    if (this.csrf === undefined) {
      const res = await this.request.get('/api/v1/auth/me');
      if (!res.ok()) throw new Error(`/auth/me answered ${res.status()}: not signed in`);
      this.csrf = MeResponse.parse(await res.json()).csrfToken;
    }
    return {
      origin: ORIGIN,
      'x-csrf-token': this.csrf,
      'idempotency-key': randomUUID(),
      ...extra,
    };
  }

  async createRecipe(body: CreateRecipeRequest): Promise<Recipe> {
    const res = await this.request.post('/api/v1/recipes', {
      headers: await this.headers(),
      data: CreateRecipeRequest.parse(body),
    });
    if (res.status() !== 201) throw new Error(`create recipe answered ${res.status()}`);
    return Recipe.parse(await res.json());
  }

  async patchRecipe(recipe: Recipe, body: PatchRecipeRequest): Promise<Recipe> {
    const res = await this.request.patch(`/api/v1/recipes/${recipe.id}`, {
      headers: await this.headers({ 'if-match': formatEtag(recipe.revision) }),
      data: PatchRecipeRequest.parse(body),
    });
    if (!res.ok()) throw new Error(`patch recipe answered ${res.status()}`);
    return Recipe.parse(await res.json());
  }

  async getRecipe(id: string): Promise<Recipe> {
    const res = await this.request.get(`/api/v1/recipes/${id}`);
    if (!res.ok()) throw new Error(`get recipe answered ${res.status()}`);
    return Recipe.parse(await res.json());
  }

  async createShoppingList(body: CreateShoppingListRequest): Promise<ShoppingList> {
    const res = await this.request.post('/api/v1/shopping-lists', {
      headers: await this.headers(),
      data: CreateShoppingListRequest.parse(body),
    });
    if (res.status() !== 201) throw new Error(`create list answered ${res.status()}`);
    return ShoppingList.parse(await res.json());
  }
}
