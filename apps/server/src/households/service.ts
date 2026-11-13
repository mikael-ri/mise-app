import { z } from 'zod';
import { HouseholdId, MemberId, UserId, nonEmptyText } from '@mise/contracts';
import type { MEMBER_ROLES } from '@mise/contracts';
import { AppError, withTransaction } from '../platform/index.js';
import type { Pool, RequestContext } from '../platform/index.js';
import * as repo from './repository.js';

/** The actor minus the device session, which only the auth module (A07) knows. */
export type ActorMembership = Pick<RequestContext, 'userId' | 'householdId' | 'memberId'>;

export interface HouseholdView {
  id: HouseholdId;
  name: string;
  timezone: string;
}

export interface MemberView {
  id: MemberId;
  userId: UserId;
  displayName: string;
  role: (typeof MEMBER_ROLES)[number];
}

// P0 provisioning input (CLI only, so kept here rather than in contracts; not an HTTP boundary): exactly two members, the first the owner. No invitations.
const IanaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'expected an IANA timezone');

const ProvisionMember = z.strictObject({
  oidcIssuer: z.url().max(512),
  oidcSubject: nonEmptyText(255),
  displayName: nonEmptyText(100),
});

export const ProvisionHouseholdInput = z.strictObject({
  name: nonEmptyText(100),
  timezone: IanaTimezone.default('Europe/Helsinki'),
  members: z.tuple([ProvisionMember, ProvisionMember]),
});
export type ProvisionHouseholdInput = z.input<typeof ProvisionHouseholdInput>;

export interface HouseholdsService {
  /** Derives the actor from an already-validated session user. Never from client input. */
  resolveActor(userId: string): Promise<ActorMembership>;
  getHousehold(actor: ActorMembership): Promise<HouseholdView>;
  listMembers(actor: ActorMembership): Promise<MemberView[]>;
  provisionHousehold(input: ProvisionHouseholdInput): Promise<HouseholdView>;
}

export function createHouseholdsService(pool: Pool): HouseholdsService {
  return {
    // The only deliberate exception to household scoping: it starts from the session user.
    async resolveActor(userId) {
      const m = await repo.findMembershipByUserId(pool, userId);
      if (!m) throw new AppError('forbidden', 'user is not a member of a household');
      return {
        userId: UserId.parse(m.userId),
        householdId: HouseholdId.parse(m.householdId),
        memberId: MemberId.parse(m.memberId),
      };
    },

    async getHousehold(actor) {
      const h = await repo.getHousehold(pool, actor.householdId);
      if (!h) throw new AppError('not_found', 'household not found');
      return { id: HouseholdId.parse(h.id), name: h.name, timezone: h.timezone };
    },

    async listMembers(actor) {
      const rows = await repo.listMembers(pool, actor.householdId);
      return rows.map((r) => ({
        id: MemberId.parse(r.id),
        userId: UserId.parse(r.userId),
        displayName: r.displayName,
        role: r.role,
      }));
    },

    async provisionHousehold(rawInput) {
      const input = ProvisionHouseholdInput.parse(rawInput);
      const [first, second] = input.members;
      if (first.oidcIssuer === second.oidcIssuer && first.oidcSubject === second.oidcSubject) {
        throw new AppError('validation_failed', 'the two members must be different identities');
      }
      try {
        return await withTransaction(pool, async (tx) => {
          const id = await repo.insertHousehold(tx, input.name, input.timezone);
          await repo.insertUserAndMember(tx, id, { ...first, role: 'owner' });
          await repo.insertUserAndMember(tx, id, { ...second, role: 'member' });
          return { id: HouseholdId.parse(id), name: input.name, timezone: input.timezone };
        });
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError('conflict', 'an OIDC identity is already provisioned');
        }
        throw err;
      }
    },
  };
}
