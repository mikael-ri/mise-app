import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { canonicalJson, parseIdempotencyKey, requestHash } from './idempotency.js';

describe('idempotency helpers (NFR-04)', () => {
  it('canonicalJson sorts keys, drops undefined and is whitespace free', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"z":1}]},"b":1}',
    );
  });

  it('hash ignores key order but depends on operation and values', () => {
    const h = requestHash('recipes.create', { a: 1, b: 2 });
    expect(h).toHaveLength(32);
    expect(requestHash('recipes.create', { b: 2, a: 1 }).equals(h)).toBe(true);
    expect(requestHash('recipes.create', { a: 1, b: 3 }).equals(h)).toBe(false);
    expect(requestHash('recipes.restore', { a: 1, b: 2 }).equals(h)).toBe(false);
  });

  it('parseIdempotencyKey: missing -> 400 idempotency_key_required, malformed -> validation_failed', () => {
    expect(() => parseIdempotencyKey(undefined)).toThrowError(
      expect.objectContaining({ code: 'idempotency_key_required' }),
    );
    expect(() => parseIdempotencyKey('short')).toThrowError(AppError);
    expect(parseIdempotencyKey('a'.repeat(16))).toBe('a'.repeat(16));
  });
});
