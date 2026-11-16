// Public surface of the shopping module. Other modules import only from here.
export { createShoppingService } from './service.js';
export type { Created, ShoppingActor, ShoppingService } from './service.js';
export { registerShoppingRoutes } from './routes.js';
