import { describe, expect, it } from 'vitest';
import { HouseholdMember, HouseholdMemberList } from './household.js';

const ID = '00000000-0000-4000-8000-000000000001';

describe('HouseholdMemberList (FR-34, FR-37: minimum member data)', () => {
  it('accepts id and displayName', () => {
    expect(
      HouseholdMemberList.safeParse({ items: [{ id: ID, displayName: 'Anna' }] }).success,
    ).toBe(true);
  });
  it.each([
    ['email', { id: ID, displayName: 'A', email: 'a@x.test' }],
    ['role', { id: ID, displayName: 'A', role: 'owner' }],
    ['userId', { id: ID, displayName: 'A', userId: ID }],
    ['non-uuid id', { id: 'x', displayName: 'A' }],
    ['missing name', { id: ID }],
  ])('rejects %s', (_n, value) => {
    expect(HouseholdMember.safeParse(value).success).toBe(false);
  });
});
