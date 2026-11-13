// Integration tests for migration 0000/0001 invariants (A04). Real PostgreSQL via DATABASE_URL,
// migrated with `pnpm db:migrate`. Each test runs in a rolled-back transaction.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  contentV1,
  createHousehold,
  createList,
  createRecipe,
  digest,
  expectPgError,
  inRolledBackTx,
  pool,
} from './helpers';

afterAll(() => pool.end());

const CHECK = '23514';
const FK = '23503';
const UNIQUE = '23505';
const NOT_NULL = '23502';
const INTEGRITY = '23000';

describe('household isolation by composite FKs (DB §3, hard rule 2)', () => {
  it('rejects a recipe whose creator belongs to another household', () =>
    inRolledBackTx(async (c) => {
      const a = await createHousehold(c, 'A');
      const b = await createHousehold(c, 'B');
      await expectPgError(
        c,
        'INSERT INTO recipes (household_id, title, created_by_member_id) VALUES ($1, $2, $3)',
        [a.householdId, 'x', b.memberId],
        { constraint: 'recipes_creator_same_household_fk' },
      );
    }));

  it('rejects a shopping item placed in another household’s list', () =>
    inRolledBackTx(async (c) => {
      const a = await createHousehold(c, 'A');
      const b = await createHousehold(c, 'B');
      const listB = await createList(c, b);
      await expectPgError(
        c,
        `INSERT INTO shopping_items (household_id, shopping_list_id, origin, name) VALUES ($1, $2, 'user', 'Maito')`,
        [a.householdId, listB],
        { constraint: 'shopping_items_list_same_household_fk' },
      );
    }));

  it('rejects a checkoff attributed to a member of another household', () =>
    inRolledBackTx(async (c) => {
      const a = await createHousehold(c, 'A');
      const b = await createHousehold(c, 'B');
      const listA = await createList(c, a);
      await expectPgError(
        c,
        `INSERT INTO shopping_items (household_id, shopping_list_id, origin, name, picked, picked_at, picked_by_member_id)
         VALUES ($1, $2, 'user', 'Maito', true, now(), $3)`,
        [a.householdId, listA, b.memberId],
        { constraint: 'shopping_items_picker_same_household_fk' },
      );
    }));

  it.each([
    [
      'shopping list creator',
      'INSERT INTO shopping_lists (household_id, name, created_by_member_id) VALUES ($1, $3, $2)',
      'shopping_lists_creator_same_household_fk',
    ],
    [
      'audit actor',
      `INSERT INTO audit_events (household_id, actor_member_id, action, entity_type, entity_id) VALUES ($1, $2, $3, 'recipe', 'x')`,
      'audit_events_actor_same_household_fk',
    ],
    [
      'idempotency actor',
      `INSERT INTO idempotency_keys (household_id, actor_member_id, operation, request_key, request_hash, result_ref, expires_at) VALUES ($1, $2, 'recipes.create', $3 || '-0123456789abcdef', decode(repeat('00', 32), 'hex'), '{}', now() + interval '1 day')`,
      'idempotency_keys_actor_same_household_fk',
    ],
  ])('rejects a cross-household %s', (_name, sqlText, constraint) =>
    inRolledBackTx(async (c) => {
      const a = await createHousehold(c, 'A');
      const b = await createHousehold(c, 'B');
      await expectPgError(c, sqlText, [a.householdId, b.memberId, 'x'], { constraint });
    }),
  );
});

describe('membership and recipe keys (DB §3, A04 owner decisions)', () => {
  it('allows a user in only one household (P0)', () =>
    inRolledBackTx(async (c) => {
      const a = await createHousehold(c, 'A');
      const b = await createHousehold(c, 'B');
      await expectPgError(
        c,
        `INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')`,
        [b.householdId, a.userId],
        { constraint: 'household_members_user_uq' },
      );
    }));

  it('exposes (household_id, id) on recipes as a composite FK target', () =>
    inRolledBackTx(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'recipes_household_id_uq'`,
      );
      expect(rows[0]?.def).toBe('UNIQUE (household_id, id)');
    }));
});

describe('recipes and immutable versions (FR-03, DB §5.1, §10.1)', () => {
  it('creates recipe + version 1 + pointer and fills the search projection', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const { recipeId } = await createRecipe(c, h, 'Kesäkurpitsakeitto');
      const { rows } = await c.query<{ fold: string; hit: boolean }>(
        `SELECT search_fold AS fold, search_document @@ plainto_tsquery('finnish', 'kesäkurpitsakeitto') AS hit FROM recipes WHERE id = $1`,
        [recipeId],
      );
      expect(rows[0]).toEqual({ fold: 'kesakurpitsakeitto  ', hit: true });
    }));

  it('rejects a current-version pointer to another recipe’s version', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const one = await createRecipe(c, h, 'Yksi');
      const two = await createRecipe(c, h, 'Kaksi');
      await expectPgError(
        c,
        'UPDATE recipes SET current_version_id = $1 WHERE id = $2',
        [two.versionId, one.recipeId],
        {
          constraint: 'recipes_current_version_same_recipe_fk',
        },
      );
    }));

  it.each([
    ['UPDATE', 'UPDATE recipe_versions SET change_reason = $2 WHERE id = $1', ['x']],
    ['DELETE', 'DELETE FROM recipe_versions WHERE id = $1', []],
  ])('blocks %s of a version', (_op, sqlText, extra) =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const { versionId } = await createRecipe(c, h);
      await expectPgError(c, sqlText, [versionId, ...extra], { code: INTEGRITY });
    }),
  );

  it('blocks TRUNCATE of versions', () =>
    inRolledBackTx(async (c) => {
      await expectPgError(c, 'TRUNCATE recipe_versions CASCADE', [], { code: INTEGRITY });
    }));

  it.each([
    ['duplicate version_no', 1, 1, contentV1(), UNIQUE],
    ['content schema_version differs from column', 2, 2, contentV1(), CHECK],
    ['content without schema_version', 2, 1, { yield: {} }, CHECK],
    ['content not an object', 2, 1, [1], CHECK],
    ['version_no 0', 0, 1, contentV1(), CHECK],
  ])('rejects a version with %s', (_name, versionNo, schemaVersion, content, code) =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const { recipeId } = await createRecipe(c, h);
      await expectPgError(
        c,
        'INSERT INTO recipe_versions (recipe_id, version_no, schema_version, content, created_by_member_id) VALUES ($1, $2, $3, $4, $5)',
        [recipeId, versionNo, schemaVersion, JSON.stringify(content), h.memberId],
        { code },
      );
    }),
  );

  it('restricts deleting a recipe that has versions (no cascade into history)', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const { recipeId } = await createRecipe(c, h);
      await c.query('UPDATE recipes SET current_version_id = NULL WHERE id = $1', [recipeId]);
      await expectPgError(c, 'DELETE FROM recipes WHERE id = $1', [recipeId], { code: FK });
    }));
});

describe('device sessions (ADR-003, security rules)', () => {
  const insert = `INSERT INTO device_sessions (user_id, token_hash, authenticated_at, idle_expires_at, absolute_expires_at)
                  VALUES ($1, $2, $3, now() + interval '90 days', now() + interval '180 days')`;

  it('stores a 32-byte digest and verified authenticated_at', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      await c.query(insert, [h.userId, digest(), new Date()]);
    }));

  it('has no column that could hold a plaintext token', () =>
    inRolledBackTx(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'device_sessions' ORDER BY 1`,
      );
      expect(rows.map((r) => r.column_name)).toEqual([
        'absolute_expires_at',
        'authenticated_at',
        'created_at',
        'device_label',
        'id',
        'idle_expires_at',
        'last_seen_at',
        'revoked_at',
        'token_hash',
        'user_id',
      ]);
    }));

  it.each([
    ['missing authenticated_at', () => [digest(), null], NOT_NULL],
    ['digest of wrong length', () => [Buffer.alloc(16), new Date()], CHECK],
  ])('rejects %s', (_name, args, code) =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      await expectPgError(c, insert, [h.userId, ...args()], { code });
    }),
  );

  it('rejects a duplicate token digest', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const d = digest();
      await c.query(insert, [h.userId, d, new Date()]);
      await expectPgError(c, insert, [h.userId, d, new Date()], {
        constraint: 'device_sessions_token_hash_uq',
      });
    }));

  it('rejects idle expiry beyond absolute expiry', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      await expectPgError(
        c,
        `INSERT INTO device_sessions (user_id, token_hash, authenticated_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, now(), now() + interval '2 days', now() + interval '1 day')`,
        [h.userId, digest()],
        { constraint: 'device_sessions_expiry_order_ck' },
      );
    }));
});

describe('shopping items (FR-35, FR-37, FR-38, DB §8, §10.1)', () => {
  const insertItem = `INSERT INTO shopping_items (household_id, shopping_list_id, origin, name, amount_min, amount_max, picked, picked_at, picked_by_member_id)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING amount_min, amount_max, revision, user_modified`;

  it('round-trips numeric amounts exactly and defaults revision/user_modified', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const list = await createList(c, h);
      const { rows } = await c.query(insertItem, [
        h.householdId,
        list,
        'user',
        'Maito',
        '0.333333333333333333',
        '1.5',
        false,
        null,
        null,
      ]);
      expect(rows[0]).toEqual({
        amount_min: '0.333333333333333333',
        amount_max: '1.5',
        revision: 1,
        user_modified: false,
      });
    }));

  it.each([
    ['unknown origin', ['manual', 'x', null, null, false, null, null], 'shopping_items_origin_ck'],
    ['negative amount', ['user', 'x', '-1', null, false, null, null], 'shopping_items_amounts_ck'],
    ['max below min', ['user', 'x', '2', '1', false, null, null], 'shopping_items_amounts_ck'],
    ['max without min', ['user', 'x', null, '1', false, null, null], 'shopping_items_amounts_ck'],
    [
      'picked without attribution',
      ['user', 'x', null, null, true, null, null],
      'shopping_items_picked_ck',
    ],
    [
      'blank name',
      ['user', '  ', null, null, false, null, null],
      'shopping_items_name_nonempty_ck',
    ],
  ])('rejects %s', (_name, args, constraint) =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const list = await createList(c, h);
      await expectPgError(c, insertItem, [h.householdId, list, ...args], { constraint });
    }),
  );

  it('rejects unpicked rows that keep stale attribution', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const list = await createList(c, h);
      await expectPgError(
        c,
        insertItem,
        [h.householdId, list, 'user', 'x', null, null, false, new Date(), h.memberId],
        {
          constraint: 'shopping_items_picked_ck',
        },
      );
    }));

  it('rejects a negative change_seq and revision 0', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const list = await createList(c, h);
      await expectPgError(c, 'UPDATE shopping_lists SET change_seq = -1 WHERE id = $1', [list], {
        constraint: 'shopping_lists_change_seq_ck',
      });
      await expectPgError(c, 'UPDATE shopping_lists SET revision = 0 WHERE id = $1', [list], {
        constraint: 'shopping_lists_revision_ck',
      });
    }));
});

describe('shopping categories and ingredient settings (FR-36, ADR-015)', () => {
  it('ships the system defaults with an `other` fallback', () =>
    inRolledBackTx(async (c) => {
      const { rows } = await c.query<{ system_code: string }>(
        'SELECT system_code FROM shopping_categories WHERE is_system_default ORDER BY sort_order',
      );
      expect(rows.map((r) => r.system_code)).toEqual([
        'vegetables',
        'fruit',
        'dairy',
        'meat',
        'dry_goods',
        'household_supplies',
        'other',
      ]);
    }));

  it.each([
    ['household row claiming a system code', true, `'dairy'`, false],
    ['system row owned by a household', true, 'NULL', true],
    ['household row without household', false, 'NULL', false],
  ])('rejects %s', (_name, withHousehold, code, isSystem) =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      await expectPgError(
        c,
        `INSERT INTO shopping_categories (household_id, system_code, name, sort_order, is_system_default) VALUES ($1, ${code}, 'Oma', 5, $2)`,
        [withHousehold ? h.householdId : null, isSystem],
        { code: CHECK },
      );
    }),
  );

  it('keys settings by (household, normalized_key) and rejects untrimmed keys', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const insert =
        'INSERT INTO household_ingredient_settings (household_id, normalized_key, is_staple) VALUES ($1, $2, true)';
      await c.query(insert, [h.householdId, 'suola']);
      await expectPgError(c, insert, [h.householdId, 'suola'], { code: UNIQUE });
      await expectPgError(c, insert, [h.householdId, ' pippuri '], {
        constraint: 'household_ingredient_settings_key_ck',
      });
    }));
});

describe('idempotency keys (ADR-013 addendum, hard rule 8)', () => {
  const insertKey = `INSERT INTO idempotency_keys (household_id, actor_member_id, operation, request_key, request_hash, result_ref, expires_at)
                     VALUES ($1, $2, $3, $4, $5, '{"status":201}', now() + interval '24 hours')`;

  it('scopes keys per actor and operation', () =>
    inRolledBackTx(async (c) => {
      const h = await createHousehold(c);
      const key = randomUUID();
      await c.query(insertKey, [h.householdId, h.memberId, 'recipes.create', key, digest()]);
      await c.query(insertKey, [h.householdId, h.memberId, 'shopping_lists.create', key, digest()]);
      await expectPgError(
        c,
        insertKey,
        [h.householdId, h.memberId, 'recipes.create', key, digest()],
        {
          constraint: 'idempotency_keys_scope_uq',
        },
      );
      await expectPgError(
        c,
        insertKey,
        [h.householdId, h.memberId, 'recipes.create', 'short', digest()],
        {
          constraint: 'idempotency_keys_request_key_ck',
        },
      );
    }));

  it('serialises a concurrent retry: the second insert waits, then conflicts after the first commits', async () => {
    const setup = await pool.connect();
    const first = await pool.connect();
    const second = await pool.connect();
    const h = await createHousehold(setup, 'Race');
    const key = randomUUID();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(insertKey, [h.householdId, h.memberId, 'recipes.create', key, digest()]);
      // Blocks on the unique index until `first` finishes.
      const racing = second
        .query(insertKey, [h.householdId, h.memberId, 'recipes.create', key, digest()])
        .then(
          () => 'inserted',
          (e: { constraint?: string }) => e.constraint,
        );
      const early = await Promise.race([
        racing,
        new Promise((r) => setTimeout(() => r('blocked'), 200)),
      ]);
      expect(early).toBe('blocked');
      await first.query('COMMIT');
      expect(await racing).toBe('idempotency_keys_scope_uq');
      await second.query('ROLLBACK');
    } finally {
      await setup.query('DELETE FROM idempotency_keys WHERE household_id = $1', [h.householdId]);
      await setup.query('DELETE FROM household_members WHERE household_id = $1', [h.householdId]);
      await setup.query('DELETE FROM users WHERE id = $1', [h.userId]);
      await setup.query('DELETE FROM households WHERE id = $1', [h.householdId]);
      for (const c of [setup, first, second]) c.release();
    }
  });
});
