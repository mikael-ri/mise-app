import type { Queryable } from '../platform/index.js';
import { scopedQuery } from '../platform/index.js';

// All SQL for households and household_members. Every statement after login is scoped by household.

export interface HouseholdRow {
  id: string;
  name: string;
  timezone: string;
}

export interface MemberRow {
  id: string;
  userId: string;
  displayName: string;
  role: 'owner' | 'member';
  joinedAt: Date;
}

export interface MembershipRow {
  userId: string;
  householdId: string;
  memberId: string;
}

export interface NewMember {
  oidcIssuer: string;
  oidcSubject: string;
  displayName: string;
  role: 'owner' | 'member';
}

/**
 * Actor resolution: the one query that starts from a user (taken from the validated session), not
 * from a household. P0 has one household per user (unique `household_members.user_id`). Inactive
 * users resolve to nothing.
 */
export async function findMembershipByUserId(
  q: Queryable,
  userId: string,
): Promise<MembershipRow | null> {
  const { rows } = await q.query<{ user_id: string; household_id: string; member_id: string }>(
    `SELECT m.user_id, m.household_id, m.id AS member_id
       FROM household_members m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND u.is_active`,
    [userId],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, householdId: r.household_id, memberId: r.member_id } : null;
}

// `households` has no household_id column; its own id is the scope.
export async function getHousehold(
  q: Queryable,
  householdId: string,
): Promise<HouseholdRow | null> {
  const { rows } = await q.query<HouseholdRow>(
    'SELECT id, name, timezone FROM households WHERE id = $1',
    [householdId],
  );
  return rows[0] ?? null;
}

export async function listMembers(q: Queryable, householdId: string): Promise<MemberRow[]> {
  const { rows } = await scopedQuery<{
    id: string;
    user_id: string;
    display_name: string;
    role: 'owner' | 'member';
    joined_at: Date;
  }>(
    q,
    householdId,
    `SELECT m.id, m.user_id, u.display_name, m.role, m.joined_at
       FROM household_members m JOIN users u ON u.id = m.user_id
      WHERE m.household_id = $1
      ORDER BY m.joined_at, m.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    role: r.role,
    joinedAt: r.joined_at,
  }));
}

export async function insertHousehold(
  q: Queryable,
  name: string,
  timezone: string,
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    'INSERT INTO households (name, timezone) VALUES ($1, $2) RETURNING id',
    [name, timezone],
  );
  return rows[0]!.id;
}

/** Creates the provisioned user and its membership. A duplicate OIDC identity raises 23505. */
export async function insertUserAndMember(
  q: Queryable,
  householdId: string,
  m: NewMember,
): Promise<{ userId: string; memberId: string }> {
  const user = await q.query<{ id: string }>(
    `INSERT INTO users (oidc_issuer, oidc_subject, display_name) VALUES ($1, $2, $3) RETURNING id`,
    [m.oidcIssuer, m.oidcSubject, m.displayName],
  );
  const userId = user.rows[0]!.id;
  const member = await q.query<{ id: string }>(
    `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3) RETURNING id`,
    [householdId, userId, m.role],
  );
  return { userId, memberId: member.rows[0]!.id };
}
