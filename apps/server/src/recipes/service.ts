import {
  RECIPE_CONTENT_SCHEMA_VERSION,
  Recipe,
  RecipeContent,
  RecipeVersion,
  RecipeVersionList,
} from '@mise/contracts';
import type {
  CreateRecipeRequest,
  PatchRecipeRequest,
  RestoreRecipeRequest,
} from '@mise/contracts';
import { AppError, canonicalJson, runIdempotent, withTransaction } from '../platform/index.js';
import type { Pool, RequestContext, Tx } from '../platform/index.js';
import { assertContentValid, buildSearchProjection } from './content-rules.js';
import * as repo from './repository.js';

/** Only the session-derived household and member are needed (hard rule 2). */
export type RecipeActor = Pick<RequestContext, 'householdId' | 'memberId'>;

export interface RecipeResult {
  recipe: Recipe;
  /** 201 for a create (including a replay of it), 200 otherwise. */
  status: 200 | 201;
}

export interface RecipesService {
  /** Creates the recipe and version 1 atomically. Retried requests with the same key replay. */
  createRecipe(
    actor: RecipeActor,
    idempotencyKey: string,
    input: CreateRecipeRequest,
  ): Promise<RecipeResult>;
  getRecipe(actor: RecipeActor, id: string): Promise<Recipe>;
  /** `content` makes a new immutable version; everything else only updates the `recipes` row. */
  patchRecipe(
    actor: RecipeActor,
    id: string,
    expectedRevision: number,
    input: PatchRecipeRequest,
  ): Promise<Recipe>;
  listVersions(actor: RecipeActor, id: string): Promise<RecipeVersionList>;
  getVersion(actor: RecipeActor, id: string, versionId: string): Promise<RecipeVersion>;
  restoreRecipe(
    actor: RecipeActor,
    id: string,
    expectedRevision: number,
    idempotencyKey: string,
    input: RestoreRecipeRequest,
  ): Promise<RecipeResult>;
}

const iso = (d: Date): string => d.toISOString();

function versionMeta(v: repo.VersionRow) {
  return {
    id: v.id,
    versionNo: v.versionNo,
    schemaVersion: v.schemaVersion,
    createdByMemberId: v.createdByMemberId,
    changeReason: v.changeReason,
    createdAt: iso(v.createdAt),
  };
}

/** Content is validated again on the way out: the stored JSONB is a boundary too. */
function parseStoredContent(v: repo.VersionRow) {
  const parsed = RecipeContent.safeParse(v.content);
  if (!parsed.success) throw new AppError('internal_error', 'stored recipe content is invalid');
  return parsed.data;
}

function toRecipeDto(r: repo.RecipeWithVersionRow): Recipe {
  return Recipe.parse({
    id: r.id,
    title: r.title,
    description: r.description,
    tags: r.tags,
    generalNotes: r.generalNotes,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    archivedAt: r.archivedAt ? iso(r.archivedAt) : null,
    revision: r.revision,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    currentVersion: versionMeta(r.version),
    content: parseStoredContent(r.version),
  });
}

const notFound = () => new AppError('not_found', 'recipe not found');

function staleRevision(current: number): AppError {
  return new AppError('stale_revision', 'recipe was changed by someone else', {
    currentRevision: current,
  });
}

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function createRecipesService(pool: Pool): RecipesService {
  async function load(actor: RecipeActor, id: string, q: Pool | Tx = pool, lock = false) {
    const row = await repo.getRecipeWithVersion(q, actor.householdId, id, lock);
    if (!row) throw notFound();
    return row;
  }

  /** Locks the recipe row and enforces the expected revision (stale -> 409). */
  async function loadForEdit(actor: RecipeActor, tx: Tx, id: string, expectedRevision: number) {
    const row = await load(actor, id, tx, true);
    if (row.revision !== expectedRevision) throw staleRevision(row.revision);
    return row;
  }

  const rejectArchivedContent = (row: repo.RecipeRow) => {
    if (row.archivedAt !== null) {
      throw new AppError('conflict', 'archived recipe cannot get a new version; unarchive first');
    }
  };

  return {
    async createRecipe(actor, idempotencyKey, input) {
      assertContentValid(input.content);
      const outcome = await runIdempotent(
        pool,
        {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          operation: 'recipes.create',
        },
        idempotencyKey,
        input,
        async (tx) => {
          const tags = input.tags ?? [];
          const recipeId = await repo.insertRecipe(tx, actor.householdId, actor.memberId, {
            title: input.title,
            description: input.description ?? null,
            tags,
            generalNotes: input.generalNotes ?? null,
            sourceType: input.sourceUrl === undefined ? 'manual' : 'url',
            sourceUrl: input.sourceUrl ?? null,
          });
          const versionId = await repo.insertVersion(
            tx,
            actor.householdId,
            recipeId,
            actor.memberId,
            RECIPE_CONTENT_SCHEMA_VERSION,
            input.content,
            null,
          );
          await repo.setInitialPointer(
            tx,
            actor.householdId,
            recipeId,
            versionId,
            buildSearchProjection({
              title: input.title,
              description: input.description ?? null,
              tags,
              generalNotes: input.generalNotes ?? null,
              content: input.content,
            }),
          );
          await repo.insertAuditEvent(
            tx,
            actor.householdId,
            actor.memberId,
            'recipe.created',
            recipeId,
            {
              versionId,
              versionNo: 1,
            },
          );
          return {
            resultRef: { status: 201, resourceType: 'recipe', resourceId: recipeId },
            value: recipeId,
          };
        },
      );
      // Re-read after commit, so a replay returns the recipe as it is now.
      const recipe = toRecipeDto(await load(actor, outcome.resultRef.resourceId));
      return { recipe, status: 201 };
    },

    async getRecipe(actor, id) {
      return toRecipeDto(await load(actor, id));
    },

    async patchRecipe(actor, id, expectedRevision, input) {
      if (input.content !== undefined) assertContentValid(input.content);

      await withTransaction(pool, async (tx) => {
        const cur = await loadForEdit(actor, tx, id, expectedRevision);
        const curContent = parseStoredContent(cur.version);

        const update: repo.RecipeUpdate = {};
        const fields: string[] = [];
        if (input.title !== undefined && input.title !== cur.title) {
          update.title = input.title;
          fields.push('title');
        }
        if (input.description !== undefined && input.description !== cur.description) {
          update.description = input.description;
          fields.push('description');
        }
        if (input.tags !== undefined && !sameStrings(input.tags, cur.tags)) {
          update.tags = input.tags;
          fields.push('tags');
        }
        if (input.generalNotes !== undefined && input.generalNotes !== cur.generalNotes) {
          update.generalNotes = input.generalNotes;
          fields.push('generalNotes');
        }
        if (input.sourceUrl !== undefined && input.sourceUrl !== cur.sourceUrl) {
          update.sourceUrl = input.sourceUrl;
          // Imported text/photo recipes keep their type; only manual <-> url follows the link.
          if (cur.sourceType === null || cur.sourceType === 'manual' || cur.sourceType === 'url') {
            update.sourceType = input.sourceUrl === null ? 'manual' : 'url';
          }
          fields.push('sourceUrl');
        }
        const wantArchived = input.archived;
        const archiveChanged =
          wantArchived !== undefined && wantArchived !== (cur.archivedAt !== null);
        if (archiveChanged) update.archivedAt = wantArchived ? new Date() : null;

        const contentChanged =
          input.content !== undefined && canonicalJson(input.content) !== canonicalJson(curContent);
        if (contentChanged) rejectArchivedContent(cur);

        if (fields.length === 0 && !archiveChanged && !contentChanged) return; // nothing to do

        const content = input.content !== undefined && contentChanged ? input.content : curContent;
        let versionNo: number | undefined;
        let versionId: string | undefined;
        if (contentChanged) {
          versionId = await repo.insertVersion(
            tx,
            actor.householdId,
            id,
            actor.memberId,
            RECIPE_CONTENT_SCHEMA_VERSION,
            content,
            input.changeReason ?? null,
          );
          update.currentVersionId = versionId;
          versionNo = cur.version.versionNo + 1;
        }
        if (
          contentChanged ||
          fields.some((f) => ['title', 'description', 'tags', 'generalNotes'].includes(f))
        ) {
          update.search = buildSearchProjection({
            title: update.title ?? cur.title,
            description: update.description === undefined ? cur.description : update.description,
            tags: update.tags ?? cur.tags,
            generalNotes:
              update.generalNotes === undefined ? cur.generalNotes : update.generalNotes,
            content,
          });
        }
        await repo.updateRecipe(tx, actor.householdId, id, update);

        if (contentChanged) {
          await repo.insertAuditEvent(
            tx,
            actor.householdId,
            actor.memberId,
            'recipe.version_created',
            id,
            {
              versionId,
              versionNo,
            },
          );
        }
        if (fields.length > 0) {
          await repo.insertAuditEvent(tx, actor.householdId, actor.memberId, 'recipe.updated', id, {
            fields,
          });
        }
        if (archiveChanged) {
          await repo.insertAuditEvent(
            tx,
            actor.householdId,
            actor.memberId,
            wantArchived ? 'recipe.archived' : 'recipe.unarchived',
            id,
            {},
          );
        }
      });
      return toRecipeDto(await load(actor, id));
    },

    async listVersions(actor, id) {
      await load(actor, id); // 404 for unknown or other-household recipes
      const rows = await repo.listVersions(pool, actor.householdId, id);
      return RecipeVersionList.parse({ items: rows.map(versionMeta) });
    },

    async getVersion(actor, id, versionId) {
      const v = await repo.getVersion(pool, actor.householdId, id, versionId);
      if (!v) throw new AppError('not_found', 'recipe version not found');
      return RecipeVersion.parse({ version: versionMeta(v), content: parseStoredContent(v) });
    },

    async restoreRecipe(actor, id, expectedRevision, idempotencyKey, input) {
      const outcome = await runIdempotent(
        pool,
        {
          householdId: actor.householdId,
          actorMemberId: actor.memberId,
          operation: 'recipes.restore',
        },
        idempotencyKey,
        { id, expectedRevision, input },
        async (tx) => {
          const cur = await loadForEdit(actor, tx, id, expectedRevision);
          rejectArchivedContent(cur);
          const source = await repo.getVersion(tx, actor.householdId, id, input.versionId);
          if (!source) throw new AppError('not_found', 'recipe version not found');
          const content = parseStoredContent(source);
          const versionId = await repo.insertVersion(
            tx,
            actor.householdId,
            id,
            actor.memberId,
            RECIPE_CONTENT_SCHEMA_VERSION,
            content,
            input.changeReason ?? null,
          );
          await repo.updateRecipe(tx, actor.householdId, id, {
            currentVersionId: versionId,
            search: buildSearchProjection({
              title: cur.title,
              description: cur.description,
              tags: cur.tags,
              generalNotes: cur.generalNotes,
              content,
            }),
          });
          await repo.insertAuditEvent(
            tx,
            actor.householdId,
            actor.memberId,
            'recipe.restored',
            id,
            {
              versionId,
              versionNo: cur.version.versionNo + 1,
              restoredFromVersionId: source.id,
              restoredFromVersionNo: source.versionNo,
            },
          );
          return { resultRef: { status: 200, resourceType: 'recipe', resourceId: id }, value: id };
        },
      );
      return { recipe: toRecipeDto(await load(actor, outcome.resultRef.resourceId)), status: 200 };
    },
  };
}
