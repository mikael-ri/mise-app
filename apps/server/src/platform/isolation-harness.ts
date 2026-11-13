// Isolation test harness (A08): two households with one user and member each, for integration tests
// in every module. Usage: `const h = await createTwoHouseholds(pool)`, seed an entity in `h.a`,
// try to read/update/delete it as `h.b`, expect denial, then `await h.cleanup()`.
// Test-only; later modules import it from the platform folder in their *.int.test.ts files.
import { randomUUID } from 'node:crypto';
import type { Pool } from './db.js';

export interface HouseholdFixture {
  householdId: string;
  userId: string;
  memberId: string;
}

export interface TwoHouseholds {
  a: HouseholdFixture;
  b: HouseholdFixture;
  /** Removes both fixtures and everything the given tables hold for them. */
  cleanup: (tablesWithHouseholdId?: readonly string[]) => Promise<void>;
}

async function createHousehold(pool: Pool, label: string): Promise<HouseholdFixture> {
  const householdId = (
    await pool.query<{ id: string }>('INSERT INTO households (name) VALUES ($1) RETURNING id', [
      `isolation-${label}`,
    ])
  ).rows[0]!.id;
  const userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://auth.test', $1, $2) RETURNING id`,
      [randomUUID(), `User ${label}`],
    )
  ).rows[0]!.id;
  const memberId = (
    await pool.query<{ id: string }>(
      `INSERT INTO household_members (household_id, user_id, role)
       VALUES ($1, $2, 'owner') RETURNING id`,
      [householdId, userId],
    )
  ).rows[0]!.id;
  return { householdId, userId, memberId };
}

export async function createTwoHouseholds(pool: Pool): Promise<TwoHouseholds> {
  const a = await createHousehold(pool, 'a');
  const b = await createHousehold(pool, 'b');
  return {
    a,
    b,
    cleanup: async (tablesWithHouseholdId = []) => {
      for (const f of [a, b]) {
        // Table names come from test code only, never from input.
        for (const table of tablesWithHouseholdId) {
          await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [f.householdId]);
        }
        await pool.query('DELETE FROM household_members WHERE household_id = $1', [f.householdId]);
        await pool.query('DELETE FROM households WHERE id = $1', [f.householdId]);
        await pool.query('DELETE FROM users WHERE id = $1', [f.userId]);
      }
    },
  };
}
