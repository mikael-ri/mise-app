import { MEMBER_ROLES } from '@mise/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { bytea, createdAt, isIn, updatedAt } from './columns';

// DB §3. Provisioned OIDC identities only; Mise stores no password hash.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    oidcIssuer: text('oidc_issuer').notNull(),
    oidcSubject: text('oidc_subject').notNull(),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('users_oidc_identity_uq').on(t.oidcIssuer, t.oidcSubject),
    check('users_oidc_nonempty_ck', sql`${t.oidcIssuer} <> '' AND ${t.oidcSubject} <> ''`),
  ],
);

export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // IANA name; validated in the application (DB §3).
    timezone: text('timezone').notNull().default('Europe/Helsinki'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('households_timezone_nonempty_ck', sql`${t.timezone} <> ''`)],
);

export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role', { enum: MEMBER_ROLES }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('household_members_household_user_uq').on(t.householdId, t.userId),
    // P0: one household per user, so the session's user resolves to exactly one membership (A04 owner decision).
    unique('household_members_user_uq').on(t.userId),
    // Target for composite FKs (household_id, member_id) so a row can never reference a member
    // of another household (DB §3 authorization invariant).
    unique('household_members_household_id_uq').on(t.householdId, t.id),
    check('household_members_role_ck', isIn(t.role, MEMBER_ROLES)),
  ],
);

// One row per device login. Only a SHA-256 digest of the opaque bearer token is stored.
export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: bytea('token_hash').notNull(),
    deviceLabel: text('device_label'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Verified fresh OIDC auth_time from the ID token at creation (ADR-003 addendum). No default:
    // the caller must supply verified evidence.
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('device_sessions_token_hash_uq').on(t.tokenHash),
    index('device_sessions_user_idx').on(t.userId),
    check('device_sessions_token_hash_len_ck', sql`octet_length(${t.tokenHash}) = 32`),
    check('device_sessions_expiry_order_ck', sql`${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`),
    check(
      'device_sessions_absolute_after_created_ck',
      sql`${t.absoluteExpiresAt} > ${t.createdAt}`,
    ),
  ],
);
