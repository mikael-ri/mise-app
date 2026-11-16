import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { parseIfMatchHeader } from './http.js';

const codeOf = (header: unknown): string => {
  try {
    parseIfMatchHeader(header);
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return 'ok';
};

describe('parseIfMatchHeader (ADR-013 addendum: 428 missing, 400 malformed)', () => {
  it('returns the revision of one strong ETag', () => {
    expect(parseIfMatchHeader('"3"')).toBe(3);
  });

  it('missing header -> precondition_required (428)', () => {
    expect(codeOf(undefined)).toBe('precondition_required');
  });

  it.each([
    ['weak tag', 'W/"3"'],
    ['wildcard', '*'],
    ['list', '"1", "2"'],
    ['unquoted', '3'],
    ['zero', '"0"'],
    ['not a number', '"abc"'],
    ['repeated header (array)', ['"1"', '"2"']],
  ])('%s -> validation_failed (400)', (_name, header) => {
    expect(codeOf(header)).toBe('validation_failed');
  });
});
