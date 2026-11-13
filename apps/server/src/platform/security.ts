import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF token bound to the device session: HMAC-SHA256(secret, sessionId), base64url. */
export function issueCsrfToken(secret: string, deviceSessionId: string): string {
  return createHmac('sha256', secret).update(`csrf:${deviceSessionId}`).digest('base64url');
}

export function verifyCsrfToken(secret: string, deviceSessionId: string, token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const expected = Buffer.from(issueCsrfToken(secret, deviceSessionId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface CsrfOptions {
  publicOrigin: string;
  csrfSecret: string;
}

/**
 * Same-origin protection for cookie-authenticated mutations (tech §12):
 * - any unsafe-method request carrying a cookie or an actor must have `Origin` equal to the public origin;
 * - when an actor is present it must also send the session-bound `X-CSRF-Token`.
 * Assumes cookie-only sessions: a mutation with neither cookie nor actor skips both checks, so A07 must
 * not accept a non-cookie credential without its own check. Runs in `preHandler`, after the auth hook (A07) has set `request.actor`. No wildcard CORS is ever sent.
 */
export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions): void {
  app.addHook('preHandler', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const cookieAuthenticated = request.actor !== null || request.headers.cookie !== undefined;
    if (!cookieAuthenticated) return;
    if (request.headers.origin !== options.publicOrigin) {
      throw new AppError('forbidden', 'origin not allowed');
    }
    if (
      request.actor !== null &&
      !verifyCsrfToken(
        options.csrfSecret,
        request.actor.deviceSessionId,
        request.headers[CSRF_HEADER],
      )
    ) {
      throw new AppError('forbidden', 'csrf token missing or invalid');
    }
  });
}

export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function registerSecurityHeaders(app: FastifyInstance, publicOrigin: string): void {
  const https = publicOrigin.startsWith('https://');
  app.addHook('onSend', async (request, reply) => {
    reply.header('content-security-policy', buildCsp());
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (https) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}

export interface RateLimiter {
  /** Counts one hit for `key`; returns whether it is allowed and, if not, seconds until reset. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

/** In-process fixed-window limiter (single instance; no Redis in MVP). */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const t = now();
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (t - w.start >= options.windowMs) windows.delete(k);
      }
      let w = windows.get(key);
      if (w === undefined || t - w.start >= options.windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= options.max) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((w.start + options.windowMs - t) / 1000)),
      };
    },
  };
}

/** Route/global hook factory: `app.addHook('onRequest', rateLimitHook(limiter))`. Default key is the client IP. */
export function rateLimitHook(
  limiter: RateLimiter,
  keyOf: (request: FastifyRequest) => string = (r) => r.ip,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const result = limiter.hit(keyOf(request));
    if (result.allowed) return;
    reply.header('retry-after', String(result.retryAfterSeconds));
    throw new AppError('rate_limited', 'too many requests', {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  };
}
