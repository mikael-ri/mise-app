import type { Queryable } from '../platform/index.js';
import { scopedQuery } from '../platform/index.js';

// All SQL for users (identity lookups) and device_sessions (DB §3). Only token digests are stored.
// Timestamps come from the service clock, not DB defaults, so expiry is testable and consistent.

export interface NewSession {
  userId: string;
  tokenHash: Buffer;
  userAgent: string | null;
  now: Date;
  authenticatedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface ValidSessionRow {
  sessionId: string;
  userId: string;
  householdId: string;
  memberId: string;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionListRow {
  id: string;
  memberId: string;
  displayName: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  authenticatedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

/** A provisioned, active user for an OIDC identity. Unknown or inactive identities give null. */
export async function findActiveUserIdByIdentity(
  q: Queryable,
  issuer: string,
  subject: string,
): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM users WHERE oidc_issuer = $1 AND oidc_subject = $2 AND is_active`,
    [issuer, subject],
  );
  return rows[0]?.id ?? null;
}

export async function insertSession(q: Queryable, s: NewSession): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO device_sessions
       (user_id, token_hash, user_agent, created_at, last_seen_at, authenticated_at,
        idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7) RETURNING id`,
    [
      s.userId,
      s.tokenHash,
      s.userAgent,
      s.now,
      s.authenticatedAt,
      s.idleExpiresAt,
      s.absoluteExpiresAt,
    ],
  );
  return rows[0]!.id;
}

/**
 * The per-request check: a session is valid only if not revoked, inside both expiries, its user is
 * active and still a household member. The join yields the actor; nothing comes from the client.
 */
export async function findValidSession(
  q: Queryable,
  tokenHash: Buffer,
  now: Date,
): Promise<ValidSessionRow | null> {
  const { rows } = await q.query<{
    id: string;
    user_id: string;
    household_id: string;
    member_id: string;
    last_seen_at: Date;
    absolute_expires_at: Date;
  }>(
    `SELECT s.id, s.user_id, m.household_id, m.id AS member_id, s.last_seen_at, s.absolute_expires_at
       FROM device_sessions s
       JOIN users u ON u.id = s.user_id AND u.is_active
       JOIN household_members m ON m.user_id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > $2
        AND s.absolute_expires_at > $2`,
    [tokenHash, now],
  );
  const r = rows[0];
  return r
    ? {
        sessionId: r.id,
        userId: r.user_id,
        householdId: r.household_id,
        memberId: r.member_id,
        lastSeenAt: r.last_seen_at,
        absoluteExpiresAt: r.absolute_expires_at,
      }
    : null;
}

/** `authenticated_at` of a live session in the household, or null. */
export async function findSessionAuthenticatedAt(
  q: Queryable,
  householdId: string,
  sessionId: string,
  now: Date,
): Promise<Date | null> {
  const { rows } = await scopedQuery<{ authenticated_at: Date }>(
    q,
    householdId,
    `SELECT s.authenticated_at
       FROM device_sessions s JOIN household_members m ON m.user_id = s.user_id
      WHERE m.household_id = $1 AND s.id = $2
        AND s.revoked_at IS NULL AND s.idle_expires_at > $3 AND s.absolute_expires_at > $3`,
    [sessionId, now],
  );
  return rows[0]?.authenticated_at ?? null;
}

/** Sliding expiry; never beyond the absolute expiry and never revives a revoked session. */
export async function touchSession(
  q: Queryable,
  sessionId: string,
  now: Date,
  idleExpiresAt: Date,
): Promise<void> {
  await q.query(
    `UPDATE device_sessions
        SET last_seen_at = $2, idle_expires_at = LEAST($3::timestamptz, absolute_expires_at)
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, now, idleExpiresAt],
  );
}

/** Active sessions of every member of the household (lost-device runbook: the partner revokes). */
export async function listHouseholdSessions(
  q: Queryable,
  householdId: string,
  now: Date,
): Promise<SessionListRow[]> {
  const { rows } = await scopedQuery<{
    id: string;
    member_id: string;
    display_name: string;
    device_label: string | null;
    user_agent: string | null;
    created_at: Date;
    last_seen_at: Date;
    authenticated_at: Date;
    idle_expires_at: Date;
    absolute_expires_at: Date;
  }>(
    q,
    householdId,
    `SELECT s.id, m.id AS member_id, u.display_name, s.device_label, s.user_agent, s.created_at,
            s.last_seen_at,
            s.authenticated_at, s.idle_expires_at, s.absolute_expires_at
       FROM device_sessions s
       JOIN household_members m ON m.user_id = s.user_id
       JOIN users u ON u.id = s.user_id
      WHERE m.household_id = $1
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > $2
        AND s.absolute_expires_at > $2
      ORDER BY s.last_seen_at DESC, s.id`,
    [now],
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    displayName: r.display_name,
    deviceLabel: r.device_label,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    authenticatedAt: r.authenticated_at,
    idleExpiresAt: r.idle_expires_at,
    absoluteExpiresAt: r.absolute_expires_at,
  }));
}

/**
 * Revokes a session that belongs to a member of the household. Idempotent: an already revoked
 * session keeps its first `revoked_at`. `found` is false when no such session exists in the
 * household; `newlyRevoked` is true only for the call that actually revoked it.
 */
export async function revokeHouseholdSession(
  q: Queryable,
  householdId: string,
  sessionId: string,
  now: Date,
): Promise<{ found: boolean; newlyRevoked: boolean }> {
  const { rows } = await scopedQuery<{ newly: boolean }>(
    q,
    householdId,
    // The row lock makes a concurrent second revoke wait and then see the first one's revoked_at,
    // so exactly one caller gets newly = true, independent of timestamps.
    `WITH target AS (
       SELECT s.id, s.revoked_at AS previous
         FROM device_sessions s JOIN household_members m ON m.user_id = s.user_id
        WHERE m.household_id = $1 AND s.id = $2
          FOR UPDATE OF s
     )
     UPDATE device_sessions d
        SET revoked_at = COALESCE(d.revoked_at, $3)
       FROM target t
      WHERE d.id = t.id
      RETURNING (t.previous IS NULL) AS newly`,
    [sessionId, now],
  );
  const r = rows[0];
  return { found: r !== undefined, newlyRevoked: r?.newly === true };
}

// --- Operator (CLI) queries. Deliberately not household-scoped: run by the operator with host
// access, never reachable from HTTP or an AI tool. They only revoke or relink; none creates a session.

/** Operator/CLI: revoke every live session of the given users. Returns the revoked session ids. */
export async function revokeUserSessions(
  q: Queryable,
  userIds: readonly string[],
  now: Date,
): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `UPDATE device_sessions SET revoked_at = $2
      WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL
      RETURNING id`,
    [userIds, now],
  );
  return rows.map((r) => r.id);
}

/** Operator/CLI: users of the given member ids (or of all members when `memberIds` is null). */
export async function findMemberUserIds(
  q: Queryable,
  memberIds: readonly string[] | null,
): Promise<{ memberId: string; userId: string }[]> {
  const { rows } = await q.query<{ id: string; user_id: string }>(
    memberIds === null
      ? 'SELECT id, user_id FROM household_members'
      : 'SELECT id, user_id FROM household_members WHERE id = ANY($1::uuid[])',
    memberIds === null ? [] : [memberIds],
  );
  return rows.map((r) => ({ memberId: r.id, userId: r.user_id }));
}

/** Operator/CLI: point a member's user at a new OIDC identity. Duplicate identity raises 23505. */
export async function relinkMemberIdentity(
  q: Queryable,
  memberId: string,
  issuer: string,
  subject: string,
): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `UPDATE users u SET oidc_issuer = $2, oidc_subject = $3, updated_at = now()
       FROM household_members m
      WHERE m.id = $1 AND u.id = m.user_id
      RETURNING u.id`,
    [memberId, issuer, subject],
  );
  return rows[0]?.id ?? null;
}
