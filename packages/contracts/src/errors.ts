import { z } from 'zod';
import { Revision } from './common.js';

/**
 * Error codes and their HTTP status. Convention (ADR-013 addendum, A04):
 * - stale `If-Match` revision -> 409 `stale_revision` (never 412)
 * - missing `If-Match` on a route that requires it -> 428 `precondition_required`
 * - `Idempotency-Key` reused with a different payload -> 422 `idempotency_key_reused`
 */
export const ERROR_STATUS = {
  validation_failed: 400,
  idempotency_key_required: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  stale_revision: 409,
  conflict: 409,
  payload_too_large: 413,
  idempotency_key_reused: 422,
  precondition_required: 428,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCode = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

/** Standard error body `{code, message, details?, correlationId}`. `message` is for logs/devs, not UI. */
export const ErrorBody = z
  .strictObject({
    code: ErrorCode,
    message: z.string().max(1000),
    details: z.record(z.string(), z.unknown()).optional(),
    correlationId: z.string().min(1).max(128),
  })
  .meta({ id: 'ErrorBody' });
export type ErrorBody = z.infer<typeof ErrorBody>;

/** `details` for `stale_revision`: the client refetches and retries against this revision. */
export const StaleRevisionDetails = z
  .strictObject({ currentRevision: Revision })
  .meta({ id: 'StaleRevisionDetails' });
export type StaleRevisionDetails = z.infer<typeof StaleRevisionDetails>;
