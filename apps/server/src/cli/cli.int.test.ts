// Runs the real CLI logic against PostgreSQL (DATABASE_URL, migrations applied).
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../platform/index.js';
import { runProvisionHousehold } from './provision-household-run.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required for integration tests');
const pool = createPool(url, 2);
const issuer = `https://cli-${randomUUID()}.test`;

afterAll(async () => {
  await pool.query(
    `DELETE FROM household_members WHERE user_id IN (SELECT id FROM users WHERE oidc_issuer = $1)`,
    [issuer],
  );
  await pool.query(`DELETE FROM households WHERE name = $1`, [issuer]);
  await pool.query('DELETE FROM users WHERE oidc_issuer = $1', [issuer]);
  await pool.end();
});

describe('provision-household CLI against PostgreSQL (FR-30)', () => {
  const args = (owner: string, member: string) => [
    '--name',
    issuer,
    '--issuer',
    issuer,
    '--owner-subject',
    owner,
    '--owner-name',
    'Ann',
    '--member-subject',
    member,
    '--member-name',
    'Bob',
  ];
  const [s1, s2] = [randomUUID(), randomUUID()];

  it('creates one household with an owner and a member, then refuses the same identities', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };
    expect(await runProvisionHousehold(args(s1, s2), { DATABASE_URL: url }, io)).toBe(0);
    expect(out[0]).toMatch(/^created household [0-9a-f-]{36} \(Europe\/Helsinki\)$/);
    const roles = await pool.query<{ role: string }>(
      `SELECT m.role FROM household_members m JOIN households h ON h.id = m.household_id
        WHERE h.name = $1 ORDER BY m.role`,
      [issuer],
    );
    expect(roles.rows.map((r) => r.role)).toEqual(['member', 'owner']);

    expect(await runProvisionHousehold(args(s1, randomUUID()), { DATABASE_URL: url }, io)).toBe(1);
    expect(err).toEqual(['an OIDC identity is already provisioned']);
    const count = await pool.query(`SELECT 1 FROM households WHERE name = $1`, [issuer]);
    expect(count.rowCount).toBe(1);
  });
});
