import { parseIfMatch } from '@mise/contracts';
import { AppError } from './errors.js';

/**
 * Expected revision from a raw `If-Match` header (ADR-013 addendum): missing -> 428
 * `precondition_required`, malformed (weak, list, `*`, non-integer) -> 400 `validation_failed`.
 * Whether the revision is stale (409) is for the service to decide.
 */
export function parseIfMatchHeader(header: unknown): number {
  if (header === undefined) {
    throw new AppError('precondition_required', 'If-Match header is required');
  }
  const revision = typeof header === 'string' ? parseIfMatch(header) : null;
  if (revision === null) throw new AppError('validation_failed', 'If-Match is malformed');
  return revision;
}
