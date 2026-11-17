import { describe, expect, it } from 'vitest';
import { runLoadRecipes, resolveLoadActor } from './recipe-tools-run.js';

const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = (h: string, n: number) => ({
  householdId: h,
  memberId: M(n),
  role: 'owner' as const,
});
const member = (h: string, n: number) => ({
  householdId: h,
  memberId: M(n),
  role: 'member' as const,
});

describe('resolveLoadActor (FR-32)', () => {
  it('uses the single owner of the single household', () => {
    expect(resolveLoadActor([owner(H1, 1), member(H1, 2)], {})).toEqual({
      householdId: H1,
      memberId: M(1),
    });
  });

  it('--household narrows several households to one', () => {
    const all = [owner(H1, 1), member(H1, 2), owner(H2, 3)];
    expect(resolveLoadActor(all, { household: H2 })).toEqual({ householdId: H2, memberId: M(3) });
  });

  it('--member overrides and derives its household', () => {
    expect(resolveLoadActor([owner(H1, 1), member(H1, 2), owner(H2, 3)], { member: M(2) })).toEqual(
      {
        householdId: H1,
        memberId: M(2),
      },
    );
  });

  it.each([
    ['several households', [owner(H1, 1), owner(H2, 3)], {}],
    ['no owner', [member(H1, 2)], {}],
    ['two owners', [owner(H1, 1), owner(H1, 2)], {}],
    ['nothing provisioned', [], {}],
  ])('fails and lists candidates when ambiguous: %s', (_n, candidates, args) => {
    expect(() => resolveLoadActor(candidates, args)).toThrow(/pass --member/);
  });

  it('lists candidates by id and role', () => {
    expect(() => resolveLoadActor([owner(H1, 1), owner(H2, 3)], {})).toThrow(
      `${H1}/${M(1)} (owner)`,
    );
  });

  it('rejects a member outside the given household', () => {
    expect(() =>
      resolveLoadActor([owner(H1, 1), owner(H2, 3)], { household: H1, member: M(3) }),
    ).toThrow('member not found');
  });
});

describe('load-recipes production guard (FR-32)', () => {
  it('refuses to run when NODE_ENV=production, before touching the database', async () => {
    const err: string[] = [];
    const code = await runLoadRecipes(
      ['some-dir'],
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
      { log: () => {}, error: (l) => err.push(l) },
    );
    expect(code).toBe(1);
    expect(err).toEqual(['refusing to load recipes when NODE_ENV=production']);
  });
});
