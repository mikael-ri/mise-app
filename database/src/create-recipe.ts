import { eq } from 'drizzle-orm';
import { recipes, recipeVersions } from '../schema/index';
import { withTransaction, type Db } from './transaction';

export interface CreateRecipeInput {
  householdId: string;
  memberId: string;
  title: string;
  content: unknown;
  searchText: string;
}

// Atomic: recipe (pointer null) -> version 1 -> pointer + search projection.
export function createRecipe(db: Db, input: CreateRecipeInput) {
  return withTransaction(db, async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({ householdId: input.householdId, title: input.title })
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
      .set({ currentVersionId: version.id, searchText: input.searchText })
      .where(eq(recipes.id, recipe.id));
    return { recipeId: recipe.id, versionId: version.id };
  });
}
