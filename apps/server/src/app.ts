import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerAuth } from './auth/index.js';
import type { AuthRouteOptions } from './auth/index.js';
import { registerRecipeRoutes } from './recipes/index.js';
import type { RecipesService } from './recipes/index.js';
import { registerHealthRoutes } from './health/index.js';
import type { ReadinessCheck } from './health/index.js';
import { buildLoggerOptions, generateCorrelationId, registerPlatform } from './platform/index.js';
import type { AppConfig } from './platform/index.js';

export interface AppOptions {
  checkReady: ReadinessCheck;
  config: Pick<AppConfig, 'publicOrigin' | 'csrfSecret' | 'logLevel' | 'trustProxy'>;
  /**
   * Session middleware and /auth routes. `null` only in platform tests that exercise the hooks in
   * isolation; the server always passes it (deny-by-default lives in the auth hook).
   */
  auth: AuthRouteOptions | null;
  /** Recipe routes; omitted only in tests that do not need them. */
  recipes?: RecipesService;
}

// Fastify's types omit the hop-count form, so express it as a trust function (trust the first n hops).
function toTrustProxy(
  value: boolean | number | string[],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === 'number' ? (_address, hop) => hop < value : value;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(options.config.logLevel),
    genReqId: generateCorrelationId,
    requestIdHeader: false,
    trustProxy: toTrustProxy(options.config.trustProxy),
  });
  registerPlatform(app, options.config);
  if (options.auth !== null) registerAuth(app, options.auth);
  if (options.recipes) registerRecipeRoutes(app, options.recipes);
  registerHealthRoutes(app, options.checkReady);
  return app;
}
