import { describe, expect, it } from 'vitest';
import type { HouseholdMember } from '@mise/contracts';
import { memberName } from './member-names.js';
import { uuid } from './shopping-fixtures.js';

const anna: HouseholdMember = { id: uuid(1), displayName: 'Anna' };
const ankka: HouseholdMember = { id: uuid(2), displayName: 'Ankka' };
const blank: HouseholdMember = { id: uuid(2), displayName: '  ' };

describe('memberName', () => {
  it.each([
    ['current member', [anna, ankka], uuid(1), uuid(1), 'You'],
    ['other known member', [anna, ankka], uuid(2), uuid(1), 'Ankka'],
    ['unknown id', [anna], uuid(3), uuid(1), 'Another household member'],
    ['members not loaded', undefined, uuid(2), uuid(1), 'Another household member'],
    ['current member before members load', undefined, uuid(1), uuid(1), 'You'],
    ['blank display name', [blank], uuid(2), uuid(1), 'Another household member'],
    ['no current member known', [anna], uuid(1), undefined, 'Anna'],
  ])('%s', (_name, members, id, current, expected) => {
    expect(memberName(members, id, current)).toBe(expected);
  });
});
