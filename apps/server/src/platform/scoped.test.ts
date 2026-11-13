import { describe, expect, it, vi } from 'vitest';
import { AppError } from './errors.js';
import { assertMemberInHousehold, scopedQuery } from './scoped.js';

const fakeQ = (rowCount: number) => ({ query: vi.fn().mockResolvedValue({ rows: [], rowCount }) });

describe('scopedQuery (FR-30, FR-31)', () => {
  it('passes the household as $1 and shifts caller params', async () => {
    const q = fakeQ(1);
    await scopedQuery(q as never, 'h1', 'SELECT 1 FROM t WHERE household_id = $1 AND id = $2', [
      'x',
    ]);
    expect(q.query).toHaveBeenCalledWith(expect.any(String), ['h1', 'x']);
  });

  it.each([
    ['no scope predicate', 'SELECT * FROM recipes WHERE id = $1'],
    ['scope on another param', 'SELECT * FROM recipes WHERE household_id = $2'],
    ['literal instead of $1', "SELECT * FROM recipes WHERE household_id = 'h'"],
  ])('rejects unscoped SQL: %s', (_name, sql) => {
    const q = fakeQ(0);
    expect(() => scopedQuery(q as never, 'h1', sql)).toThrow(/household_id = \$1/);
    expect(q.query).not.toHaveBeenCalled();
  });
});

describe('assertMemberInHousehold (FR-30)', () => {
  it('passes when the member is in the household', async () => {
    await expect(assertMemberInHousehold(fakeQ(1) as never, 'h', 'm')).resolves.toBeUndefined();
  });
  it('throws not_found otherwise', async () => {
    await expect(assertMemberInHousehold(fakeQ(0) as never, 'h', 'm')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(assertMemberInHousehold(fakeQ(0) as never, 'h', 'm')).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
