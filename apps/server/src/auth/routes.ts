import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DeviceSessionList,
  DeviceSessionParams,
  MeResponse,
  OidcCallbackQuery,
  OidcStartQuery,
} from '@mise/contracts';
import { createRateLimiter, rateLimitHook, requireActor } from '../platform/index.js';
import type { RateLimiter } from '../platform/index.js';
import {
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  clearCookie,
  openLoginState,
  readCookie,
  sealLoginState,
  serializeCookie,
} from './cookies.js';
import { OidcError } from './oidc.js';
import type { AuthService } from './service.js';

/** Where a failed login lands (A11 renders it). One generic code for every reason but one. */
export const LOGIN_FAILED_PATH = '/signin?error=signin_failed';
/**
 * The IdP authenticated the user but no active, provisioned member matches the identity
 * (`subject_not_provisioned`). Accepted disclosure: reveals only that fact, never identity data.
 */
export const LOGIN_NOT_PROVISIONED_PATH = '/signin?error=not_provisioned';

export interface AuthRouteOptions {
  service: AuthService;
  publicOrigin: string;
  postLoginLogoutUrl: string;
  loginStateKey: Buffer;
  /** Shared by /auth/oidc/* and /auth/logout, keyed on `request.ip` (needs TRUST_PROXY behind nginx). */
  limiter?: RateLimiter;
  now?: () => number;
}

/** Post-login hop through the Authelia portal logout so no SSO session survives (ADR-003 addendum D4). */
export function postLoginRedirect(
  logoutUrl: string,
  publicOrigin: string,
  returnTo: string,
): string {
  const u = new URL(logoutUrl);
  u.searchParams.set('rd', `${publicOrigin}${returnTo}`);
  return u.toString();
}

const RATE_LIMITED_ROUTES = new Set([
  '/api/v1/auth/oidc/start',
  '/api/v1/auth/oidc/callback',
  '/api/v1/auth/logout',
]);

/**
 * Rate limit for the login surface. A global `onRequest` hook registered before the session hook,
 * so floods are cut off before any session lookup hits the database.
 */
export function registerAuthRateLimit(app: FastifyInstance, limiter?: RateLimiter): void {
  const limited = rateLimitHook(limiter ?? createRateLimiter({ windowMs: 60_000, max: 20 }));
  app.addHook('onRequest', async (request, reply) => {
    if (RATE_LIMITED_ROUTES.has(request.routeOptions.url ?? '')) await limited(request, reply);
  });
}

export function registerAuthRoutes(app: FastifyInstance, o: AuthRouteOptions): void {
  const now = o.now ?? Date.now;
  const publicRoute = { config: { public: true } } as const;

  const redirectFailed = (request: FastifyRequest, reply: FastifyReply, reason: string) => {
    request.log.info({ reason }, 'login rejected'); // fixed reason code only
    const target =
      reason === 'subject_not_provisioned' ? LOGIN_NOT_PROVISIONED_PATH : LOGIN_FAILED_PATH;
    return reply
      .header('set-cookie', clearCookie(LOGIN_STATE_COOKIE))
      .header('cache-control', 'no-store')
      .redirect(target, 302);
  };

  app.get('/api/v1/auth/oidc/start', publicRoute, async (request, reply) => {
    const query = OidcStartQuery.parse(request.query);
    const { authorizationUrl, state } = await o.service.startLogin(query.returnTo);
    return reply
      .header(
        'set-cookie',
        serializeCookie(LOGIN_STATE_COOKIE, sealLoginState(o.loginStateKey, state), {
          maxAgeSeconds: LOGIN_STATE_MAX_AGE_SECONDS,
        }),
      )
      .header('cache-control', 'no-store')
      .redirect(authorizationUrl, 302);
  });

  app.get('/api/v1/auth/oidc/callback', publicRoute, async (request, reply) => {
    const query = OidcCallbackQuery.safeParse(request.query);
    if (!query.success) return redirectFailed(request, reply, 'callback_malformed');
    const state = openLoginState(
      o.loginStateKey,
      readCookie(request.headers.cookie, LOGIN_STATE_COOKIE),
      now(),
    );
    let login;
    try {
      login = await o.service.completeLogin(query.data, state, {
        userAgent: request.headers['user-agent'],
        // Set by the session hook when the browser still holds a valid session cookie.
        replacing: request.actor,
      });
    } catch (err) {
      if (err instanceof OidcError) return redirectFailed(request, reply, err.reason);
      throw err;
    }
    return reply
      .header('set-cookie', [
        clearCookie(LOGIN_STATE_COOKIE),
        serializeCookie(SESSION_COOKIE, login.token, { maxAgeSeconds: login.maxAgeSeconds }),
      ])
      .header('cache-control', 'no-store')
      .redirect(postLoginRedirect(o.postLoginLogoutUrl, o.publicOrigin, login.returnTo), 302);
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    await o.service.logout(requireActor(request));
    return reply.header('set-cookie', clearCookie(SESSION_COOKIE)).code(204).send();
  });

  app.get('/api/v1/auth/me', async (request) =>
    MeResponse.parse(await o.service.me(requireActor(request))),
  );

  app.get('/api/v1/auth/devices', async (request) =>
    DeviceSessionList.parse({ items: await o.service.listDevices(requireActor(request)) }),
  );

  app.delete('/api/v1/auth/devices/:sessionId', async (request, reply) => {
    const actor = requireActor(request);
    const { sessionId } = DeviceSessionParams.parse(request.params);
    await o.service.revokeDevice(actor, sessionId);
    if (sessionId === actor.deviceSessionId) {
      reply.header('set-cookie', clearCookie(SESSION_COOKIE));
    }
    return reply.code(204).send();
  });
}
