import { describe, expect, it } from 'vitest';
import { OidcCallbackQuery, OidcStartQuery } from './auth.js';
import { ERROR_STATUS, ErrorBody } from './errors.js';
import { IdempotencyKeyHeader, formatEtag, parseIfMatch } from './headers.js';

describe('If-Match / ETag (ADR-013 addendum: 409 for stale, 428 for missing, no 412)', () => {
  it.each([
    ['"1"', 1],
    ['"42"', 42],
    ['"2147483647"', 2_147_483_647],
    ['42', null],
    ['W/"42"', null],
    ['*', null],
    ['"1", "2"', null],
    ['"0"', null],
    ['"01"', null],
    ['"2147483648"', null],
  ])('parseIfMatch(%s) = %s', (value, expected) => {
    expect(parseIfMatch(value)).toBe(expected);
  });

  it('round-trips formatEtag', () => {
    expect(parseIfMatch(formatEtag(7))).toBe(7);
  });

  it('maps stale writes to 409 and never uses 412', () => {
    expect(ERROR_STATUS.stale_revision).toBe(409);
    expect(ERROR_STATUS.precondition_required).toBe(428);
    expect(Object.values(ERROR_STATUS)).not.toContain(412);
  });
});

describe('Idempotency-Key header', () => {
  it.each([
    ['3f1c2a9e-0b7d-4c55-9a1e-2f3b4c5d6e7f', true],
    ['abcdefghijklmnop', true],
    ['short', false],
    ['x'.repeat(129), false],
    ['has space in the key!', false],
  ])('%s -> %s', (value, ok) => {
    expect(IdempotencyKeyHeader.safeParse(value).success).toBe(ok);
  });
});

describe('ErrorBody', () => {
  it('requires code, message and correlationId', () => {
    expect(
      ErrorBody.safeParse({
        code: 'stale_revision',
        message: 'stale',
        details: { currentRevision: 3 },
        correlationId: 'c1',
      }).success,
    ).toBe(true);
    expect(ErrorBody.safeParse({ code: 'stale_revision', message: 'stale' }).success).toBe(false);
    expect(ErrorBody.safeParse({ code: 'teapot', message: 'x', correlationId: 'c' }).success).toBe(
      false,
    );
  });
});

describe('OIDC queries', () => {
  it.each([
    ['/recipes/1', true],
    ['/', true],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['https://evil.example', false],
    ['/a b', false],
  ])('returnTo %s -> %s', (returnTo, ok) => {
    expect(OidcStartQuery.safeParse({ returnTo }).success).toBe(ok);
  });

  it.each([
    [{ state: 's', code: 'c' }, true],
    [{ state: 's', error: 'access_denied' }, true],
    [{ state: 's', code: 'c', error: 'x' }, false],
    [{ state: 's' }, false],
    [{ code: 'c' }, false],
  ])('callback %o -> %s', (query, ok) => {
    expect(OidcCallbackQuery.safeParse(query).success).toBe(ok);
  });
});
