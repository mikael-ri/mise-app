// Public surface of the recipes module. Other modules import only from here.
export { createRecipesService } from './service.js';
export type { RecipeActor, RecipeResult, RecipesService } from './service.js';
export { registerRecipeRoutes } from './routes.js';
