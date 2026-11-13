import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt } from './columns';
import { householdMembers, households } from './identity';

// DB §9. One row per (household, actor, operation, key). The service inserts it in the SAME transaction
// as the effect, so a concurrent duplicate blocks on the unique index and then replays the committed
// outcome (ADR-013 addendum). Same key with a different request_hash -> 422.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id').notNull(),
    actorMemberId: uuid('actor_member_id').notNull(),
    operation: text('operation').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: bytea('request_hash').notNull(), // SHA-256 of the canonical request
    resultRef: jsonb('result_ref').notNull(), // e.g. {status, resourceType, resourceId}; no payload copies
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_keys_scope_uq').on(
      t.householdId,
      t.actorMemberId,
      t.operation,
      t.requestKey,
    ),
    foreignKey({
      name: 'idempotency_keys_actor_same_household_fk',
      columns: [t.householdId, t.actorMemberId],
      foreignColumns: [householdMembers.householdId, householdMembers.id],
    }).onDelete('restrict'),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
    check('idempotency_keys_operation_ck', sql`${t.operation} ~ '^[a-z][a-z0-9_.]{0,63}$'`),
    check('idempotency_keys_request_key_ck', sql`${t.requestKey} ~ '^[A-Za-z0-9_-]{16,128}$'`),
    check('idempotency_keys_request_hash_len_ck', sql`octet_length(${t.requestHash}) = 32`),
    check('idempotency_keys_expiry_ck', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

// Minimal structured attribution. `summary` must never hold tokens, profile data, chat content or images.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
    actorMemberId: uuid('actor_member_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    summary: jsonb('summary')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'audit_events_actor_same_household_fk',
      columns: [t.householdId, t.actorMemberId],
      foreignColumns: [householdMembers.householdId, householdMembers.id],
    }).onDelete('restrict'),
    index('audit_events_household_created_idx').on(t.householdId, t.createdAt),
    check('audit_events_summary_object_ck', sql`jsonb_typeof(${t.summary}) = 'object'`),
  ],
);
