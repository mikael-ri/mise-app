import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health/index.js';
import type { ReadinessCheck } from './health/index.js';

export interface AppOptions {
  checkReady: ReadinessCheck;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  registerHealthRoutes(app, options.checkReady);
  return app;
}
