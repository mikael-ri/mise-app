import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health/index.js';
import type { ReadinessCheck } from './health/index.js';
import { buildLoggerOptions, generateCorrelationId, registerPlatform } from './platform/index.js';
import type { AppConfig } from './platform/index.js';

export interface AppOptions {
  checkReady: ReadinessCheck;
  config: Pick<AppConfig, 'publicOrigin' | 'csrfSecret' | 'logLevel' | 'trustProxy'>;
}

// Fastify's types omit the hop-count form, so express it as a trust function (trust the first n hops).
function toTrustProxy(
  value: boolean | number,
): boolean | ((address: string, hop: number) => boolean) {
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
  registerHealthRoutes(app, options.checkReady);
  return app;
}
