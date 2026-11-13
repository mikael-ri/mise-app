import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerErrorHandling } from './errors.js';
import { registerCsrfProtection, registerSecurityHeaders } from './security.js';

export { ConfigError, loadConfig } from './config.js';
export type { AppConfig } from './config.js';
export { checkDatabaseReady, createPool, withTransaction } from './db.js';
export type { Pool, Tx } from './db.js';
export { AppError, errorBody, generateCorrelationId, toErrorBody } from './errors.js';
export { buildLoggerOptions, REDACT_PATHS } from './logging.js';
export {
  ResultRef,
  parseIdempotencyKey,
  requestHash,
  runIdempotent,
  sweepExpiredKeys,
} from './idempotency.js';
export type { IdempotencyScope, IdempotentOutcome } from './idempotency.js';
export { requireActor } from './request-context.js';
export type { RequestContext } from './request-context.js';
export {
  CSRF_HEADER,
  createRateLimiter,
  issueCsrfToken,
  rateLimitHook,
  verifyCsrfToken,
} from './security.js';
export type { RateLimiter } from './security.js';

export type PlatformConfig = Pick<AppConfig, 'publicOrigin' | 'csrfSecret'>;

/** Registers error model, correlation header, security headers and CSRF/Origin protection. */
export function registerPlatform(app: FastifyInstance, config: PlatformConfig): void {
  app.decorateRequest('actor', null);
  registerErrorHandling(app);
  registerSecurityHeaders(app, config.publicOrigin);
  registerCsrfProtection(app, config);
}
