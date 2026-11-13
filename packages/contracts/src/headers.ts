import { z } from 'zod';

export const HEADER_IF_MATCH = 'if-match';
export const HEADER_ETAG = 'etag';
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';

/**
 * `If-Match` carries exactly one strong ETag `"<revision>"`. Weak tags, lists and `*` are rejected.
 * Stale value -> 409 `stale_revision`; missing -> 428 `precondition_required` (ADR-013 addendum).
 */
export const IfMatchHeader = z
  .string()
  .regex(/^"[1-9]\d{0,9}"$/, 'expected a strong ETag "<revision>"');

export const formatEtag = (revision: number): string => `"${revision}"`;

/** Returns the revision in an `If-Match` value, or null if the value is malformed. */
export const parseIfMatch = (value: string): number | null => {
  if (!IfMatchHeader.safeParse(value).success) return null;
  const revision = Number(value.slice(1, -1));
  return revision <= 2_147_483_647 ? revision : null;
};

/**
 * `Idempotency-Key`: opaque client-generated token (a UUID is recommended), 16-128 chars of [A-Za-z0-9_-].
 * Scoped to (household, actor member, operation). Same key + same payload replays the first outcome;
 * same key + different payload -> 422 `idempotency_key_reused`. Retained 24 h (ADR-013 addendum).
 */
export const IdempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, 'expected 16-128 characters of [A-Za-z0-9_-]');

export const IDEMPOTENCY_KEY_TTL_HOURS = 24;
