import { z } from 'zod';
import { MemberId } from './common.js';

/**
 * A member of the actor's household, for showing who picked or added a shopping item. Minimum
 * data: no email, role, user id or OIDC subject. `id` is `household_members.id`.
 */
export const HouseholdMember = z
  .strictObject({ id: MemberId, displayName: z.string() })
  .meta({ id: 'HouseholdMember' });
export type HouseholdMember = z.infer<typeof HouseholdMember>;

export const HouseholdMemberList = z
  .strictObject({ items: z.array(HouseholdMember) })
  .meta({ id: 'HouseholdMemberList' });
export type HouseholdMemberList = z.infer<typeof HouseholdMemberList>;
