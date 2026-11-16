/**
 * UI-ONLY fake of the Mise API for Playwright (card A12).
 *
 * There is no real sign-in helper yet (A16 owns it), so these specs stub `/api/**` in the browser.
 * Drift guard: every response is parsed with the Zod schemas from `@mise/contracts` before it is
 * served, and every request body is parsed with the request schema, so the fake cannot disagree
 * with the contract. A16 must replace this with the real sign-in helper and rerun the key flows
 * (search, restore, servings preview, and the 409 conflict dialog) against the real server.
 */
import type { Page, Route } from '@playwright/test';
import {
  CreateRecipeRequest,
  ErrorBody,
  type ErrorCode,
  MeResponse,
  PatchRecipeRequest,
  Recipe,
  RecipeList,
  RecipeVersion,
  RecipeVersionList,
  RestoreRecipeRequest,
  formatEtag,
  parseIfMatch,
} from '../../packages/contracts/src/index.js';
import {
  OTHER_MEMBER_ID,
  salmonRecipe,
  uuid,
  versionMeta,
} from '../../apps/web/src/features/recipes/recipe-fixtures.js';
import { ME } from '../../apps/web/src/test/fixtures.js';

type RecipeT = ReturnType<typeof Recipe.parse>;
type Content = RecipeT['content'];

interface Stored {
  recipe: RecipeT;
  versions: Array<{ meta: RecipeT['currentVersion']; content: Content }>;
}

export interface FakeApi {
  /** Requests seen, e.g. "PATCH /api/v1/recipes/<id>". */
  readonly requests: string[];
  /** Another household member saves content (new version, revision + 1) while the user edits. */
  otherMemberEdits(id: string, change: (content: Content) => Content): void;
  /** The next PATCH on this recipe arrives after yet another member save (forces a second 409). */
  otherMemberEditsBeforeNextPatch(id: string): void;
  get(id: string): RecipeT;
}

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

const searchable = (r: RecipeT): string =>
  [
    r.title,
    r.tags.join(' '),
    r.generalNotes ?? '',
    ...r.content.ingredients.map((l) => l.display_name),
    ...r.content.instructions.map((s) => s.text),
  ]
    .join(' ')
    .toLowerCase();

export async function installFakeApi(
  page: Page,
  extra: Array<{ id: string; title: string; tags?: string[] }> = [],
): Promise<FakeApi> {
  const store = new Map<string, Stored>();
  const requests: string[] = [];
  let nextId = 500;
  let raceOn: string | null = null;

  const seed = (recipe: RecipeT): void => {
    store.set(recipe.id, {
      recipe,
      versions: [{ meta: recipe.currentVersion, content: recipe.content }],
    });
  };
  const salmon = salmonRecipe();
  // Version 1 is the 400 g state, so AC-03 can show that the earlier version stays reachable.
  const first = versionMeta(1, OTHER_MEMBER_ID, 'Ensimmäinen versio');
  const firstContent: Content = {
    ...salmon.content,
    ingredients: salmon.content.ingredients.map((l) =>
      l.id === uuid(11)
        ? { ...l, original_quantity_text: '800 g', amount_min: '800', amount_max: '800' }
        : l,
    ),
  };
  seed(salmon);
  store.get(salmon.id)?.versions.push({ meta: first, content: firstContent });
  for (const [index, item] of extra.entries()) {
    seed(
      Recipe.parse({
        ...salmon,
        id: item.id,
        title: item.title,
        tags: item.tags ?? [],
        revision: 1,
        sourceUrl: null,
        generalNotes: null,
        currentVersion: { ...salmon.currentVersion, id: uuid(7000 + index) },
        // Own small content, so searches for salmon ingredients do not match the extra recipes.
        content: {
          ...salmon.content,
          prep_minutes: null,
          cook_minutes: null,
          ingredient_groups: [],
          ingredients: [
            {
              ...salmon.content.ingredients[0],
              id: uuid(8000 + index),
              group_id: null,
              display_name: 'jauhoja',
            },
          ],
          instructions: [{ id: uuid(8100 + index), order: 1, text: 'Sekoita.' }],
        },
      }),
    );
  }

  const write = (id: string, recipe: RecipeT): RecipeT => {
    const parsed = Recipe.parse(recipe);
    const entry = store.get(id);
    if (entry !== undefined) entry.recipe = parsed;
    return parsed;
  };

  const newVersion = (entry: Stored, content: Content, memberId: string, reason: string | null) => {
    const versionNo = Math.max(...entry.versions.map((v) => v.meta.versionNo)) + 1;
    const meta = versionMeta(versionNo, memberId, reason);
    entry.versions.push({
      meta: { ...meta, id: uuid(5000 + versionNo + entry.versions.length) },
      content,
    });
    const added = entry.versions[entry.versions.length - 1];
    return added?.meta ?? meta;
  };

  function bump(id: string, change: (content: Content) => Content): void {
    const entry = store.get(id);
    if (entry === undefined) throw new Error('unknown recipe');
    const content = change(entry.recipe.content);
    const meta = newVersion(entry, content, OTHER_MEMBER_ID, 'Muokattu toisella laitteella');
    write(id, {
      ...entry.recipe,
      content,
      currentVersion: meta,
      revision: entry.recipe.revision + 1,
    });
  }

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const path = url.pathname.replace('/api/v1', '');
      requests.push(`${method} ${url.pathname}${url.search}`);

      if (method === 'GET' && path === '/auth/me') return json(route, 200, MeResponse.parse(ME));

      if (method === 'GET' && path === '/recipes') {
        const q = url.searchParams.get('q')?.toLowerCase();
        const tags = url.searchParams.getAll('tags');
        const maxTime = url.searchParams.get('maxTime');
        const archived = url.searchParams.get('includeArchived') === 'true';
        const limit = Number(url.searchParams.get('limit') ?? 20);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const hits = [...store.values()]
          .map((s) => s.recipe)
          .filter((r) => archived || r.archivedAt === null)
          .filter((r) => q === undefined || q.split(/\s+/).every((w) => searchable(r).includes(w)))
          .filter((r) => tags.every((t) => r.tags.includes(t)))
          .filter((r) => {
            if (maxTime === null) return true;
            const { prep_minutes: p, cook_minutes: c } = r.content;
            return p === null && c === null ? true : (p ?? 0) + (c ?? 0) <= Number(maxTime);
          });
        const page_ = hits.slice(offset, offset + limit);
        return json(
          route,
          200,
          RecipeList.parse({
            items: page_.map((r) => ({
              id: r.id,
              title: r.title,
              tags: r.tags,
              archivedAt: r.archivedAt,
              revision: r.revision,
              updatedAt: r.updatedAt,
              totalMinutes:
                r.content.prep_minutes === null && r.content.cook_minutes === null
                  ? null
                  : (r.content.prep_minutes ?? 0) + (r.content.cook_minutes ?? 0),
              yield: r.content.yield,
            })),
            nextOffset: offset + limit < hits.length ? offset + limit : null,
          }),
        );
      }

      if (method === 'POST' && path === '/recipes') {
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(request.headers()['idempotency-key'] ?? '')) {
          return error(route, 400, 'idempotency_key_required');
        }
        const body = CreateRecipeRequest.parse(request.postDataJSON());
        const id = uuid(nextId++);
        const created = Recipe.parse({
          id,
          title: body.title,
          description: null,
          tags: body.tags ?? [],
          generalNotes: body.generalNotes ?? null,
          sourceType: body.sourceUrl === undefined ? 'manual' : 'url',
          sourceUrl: body.sourceUrl ?? null,
          archivedAt: null,
          revision: 1,
          createdAt: '2026-11-16T10:00:00Z',
          updatedAt: '2026-11-16T10:00:00Z',
          currentVersion: versionMeta(1, ME.member.id, null),
          content: body.content,
        });
        seed(created);
        return json(route, 201, created, { etag: formatEtag(1) });
      }

      const match = /^\/recipes\/([^/]+)(?:\/(versions|restore)(?:\/([^/]+))?)?$/.exec(path);
      const entry = match?.[1] === undefined ? undefined : store.get(match[1]);
      if (match === null || entry === undefined) return error(route, 404, 'not_found');
      const [, id = '', sub, versionId] = match;

      if (method === 'GET' && sub === undefined) {
        return json(route, 200, entry.recipe, { etag: formatEtag(entry.recipe.revision) });
      }
      if (method === 'GET' && sub === 'versions' && versionId === undefined) {
        const items = [...entry.versions]
          .map((v) => v.meta)
          .sort((a, b) => b.versionNo - a.versionNo);
        return json(route, 200, RecipeVersionList.parse({ items }));
      }
      if (method === 'GET' && sub === 'versions') {
        const found = entry.versions.find((v) => v.meta.id === versionId);
        if (found === undefined) return error(route, 404, 'not_found');
        return json(
          route,
          200,
          RecipeVersion.parse({ version: found.meta, content: found.content }),
        );
      }

      if (method === 'PATCH' && raceOn === id) {
        raceOn = null;
        bump(id, (c) => c);
      }
      const ifMatch = request.headers()['if-match'];
      if (ifMatch === undefined) return error(route, 428, 'precondition_required');
      if (parseIfMatch(ifMatch) !== entry.recipe.revision) {
        return error(route, 409, 'stale_revision', {
          details: { currentRevision: entry.recipe.revision },
        });
      }

      if (method === 'PATCH' && sub === undefined) {
        const body = PatchRecipeRequest.parse(request.postDataJSON());
        const r = entry.recipe;
        let currentVersion = r.currentVersion;
        if (body.content !== undefined) {
          currentVersion = newVersion(entry, body.content, ME.member.id, body.changeReason ?? null);
        }
        const updated = write(id, {
          ...r,
          title: body.title ?? r.title,
          tags: body.tags ?? r.tags,
          generalNotes: body.generalNotes === undefined ? r.generalNotes : body.generalNotes,
          sourceUrl: body.sourceUrl === undefined ? r.sourceUrl : body.sourceUrl,
          archivedAt:
            body.archived === undefined
              ? r.archivedAt
              : body.archived
                ? '2026-11-16T11:00:00Z'
                : null,
          content: body.content ?? r.content,
          currentVersion,
          revision: r.revision + 1,
        });
        return json(route, 200, updated, { etag: formatEtag(updated.revision) });
      }

      if (method === 'POST' && sub === 'restore') {
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(request.headers()['idempotency-key'] ?? '')) {
          return error(route, 400, 'idempotency_key_required');
        }
        const body = RestoreRecipeRequest.parse(request.postDataJSON());
        const source = entry.versions.find((v) => v.meta.id === body.versionId);
        if (source === undefined) return error(route, 404, 'not_found');
        const meta = newVersion(
          entry,
          source.content,
          ME.member.id,
          `Restored v${source.meta.versionNo}`,
        );
        const updated = write(id, {
          ...entry.recipe,
          content: source.content,
          currentVersion: meta,
          revision: entry.recipe.revision + 1,
        });
        return json(route, 200, updated, { etag: formatEtag(updated.revision) });
      }

      return error(route, 404, 'not_found');
    },
  );

  return {
    requests,
    get: (id) => {
      const entry = store.get(id);
      if (entry === undefined) throw new Error('unknown recipe');
      return entry.recipe;
    },
    otherMemberEdits: bump,
    otherMemberEditsBeforeNextPatch(id) {
      raceOn = id;
    },
  };
}
