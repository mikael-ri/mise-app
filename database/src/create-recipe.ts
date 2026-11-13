import { eq } from 'drizzle-orm';
import { recipes, recipeVersions } from '../schema/index';
import { withTransaction, type Db } from './transaction';

export interface CreateRecipeInput {
  householdId: string;
  memberId: string;
  title: string;
  content: unknown;
  /** Flattened search projection (ADR-010 addendum); written in the same transaction as the version. */
  search: { title: string; ingredients: string; body: string };
}

// Atomic: recipe (pointer null) -> version 1 -> pointer + search projection.
export function createRecipe(db: Db, input: CreateRecipeInput) {
  return withTransaction(db, async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({
        householdId: input.householdId,
        title: input.title,
        createdByMemberId: input.memberId,
      })
      .returning();
    if (!recipe) throw new Error('recipe insert returned no row');
    const [version] = await tx
      .insert(recipeVersions)
      .values({
        recipeId: recipe.id,
        versionNo: 1,
        schemaVersion: 1,
        content: input.content,
        createdByMemberId: input.memberId,
      })
      .returning();
    if (!version) throw new Error('version insert returned no row');
    await tx
      .update(recipes)
      .set({
        currentVersionId: version.id,
        searchTitle: input.search.title,
        searchIngredients: input.search.ingredients,
        searchBody: input.search.body,
      })
      .where(eq(recipes.id, recipe.id));
    return { recipeId: recipe.id, versionId: version.id };
  });
}
