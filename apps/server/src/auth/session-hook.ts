import type { FastifyInstance } from 'fastify';
import { AppError } from '../platform/index.js';
import { SESSION_COOKIE, clearCookie, readCookie } from './cookies.js';
import type { AuthService } from './service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Only health and the OIDC login endpoints set this. Everything else needs a session. */
    public?: boolean;
  }
}

/**
 * Session middleware (tech §12, AC-11). A global `onRequest` hook, so it runs before every route's
 * `preHandler`, including A06's Origin/CSRF check, which needs `request.actor`.
 * - The only credential is the `__Host-` session cookie. `Authorization` headers are ignored, so
 *   no non-cookie credential can bypass the CSRF check.
 * - Revocation and expiry are checked against the database on every request.
 * - Deny by default: any route not marked `config: { public: true }` (including unknown paths)
 *   answers 401 without a valid session.
 */
export function registerSessionAuth(app: FastifyInstance, auth: AuthService): void {
  app.addHook('onRequest', async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token !== undefined && token !== '') {
      request.actor = await auth.authenticate(token);
      // A dead cookie is removed so the client stops presenting it.
      if (request.actor === null) reply.header('set-cookie', clearCookie(SESSION_COOKIE));
    }
    if (request.actor === null && request.routeOptions.config.public !== true) {
      throw new AppError('unauthenticated', 'authentication required');
    }
  });
}
