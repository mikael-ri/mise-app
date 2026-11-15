// Public surface of the auth module. Other modules import only from here.
import type { FastifyInstance } from 'fastify';
import { registerAuthRateLimit, registerAuthRoutes } from './routes.js';
import type { AuthRouteOptions } from './routes.js';
import { registerSessionAuth } from './session-hook.js';

export { loginStateKey } from './cookies.js';
export { createIdpClient } from './idp.js';
export type { IdpClient } from './idp.js';
export { createRevocationHub } from './revocation.js';
export type { RevocationHub, RevocationListener } from './revocation.js';
export { createAuthService, createOperatorService } from './service.js';
export type { AuthService, OperatorService } from './service.js';
export type { AuthRouteOptions } from './routes.js';

/** Session middleware on every route plus the /auth endpoints. */
export function registerAuth(app: FastifyInstance, options: AuthRouteOptions): void {
  registerAuthRateLimit(app, options.limiter);
  registerSessionAuth(app, options.service);
  registerAuthRoutes(app, options);
}
