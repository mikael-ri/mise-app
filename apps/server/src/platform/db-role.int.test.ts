// ADR-018 startup check against real PostgreSQL: the migrated test database has the production
// layout (owner role owns every object, app role has grants only).
import { afterAll, describe, expect, it } from 'vitest';
import { createPool, databaseRoleProblems, readDatabaseRoleFacts } from './db.js';
import { loadTestDatabaseConfig } from './test-support.js';

const config = loadTestDatabaseConfig();
const appPool = createPool(config.appUrl, 1);
const ownerPool = createPool(config.ownerUrl, 1);

afterAll(async () => {
  await Promise.all([appPool.end(), ownerPool.end()]);
});

describe('database role startup check (ADR-018)', () => {
  it('lets the least-privilege app role start', async () => {
    const facts = await readDatabaseRoleFacts(appPool);
    expect(facts).toEqual({
      superuser: false,
      ownedRelations: 0,
      ownedFunctions: 0,
      elevated: false,
      ownsPublicSchema: false,
      ownsDatabase: false,
    });
    expect(databaseRoleProblems(facts)).toEqual([]);
  });

  it('refuses the migrator/owner role that owns the tables', async () => {
    const facts = await readDatabaseRoleFacts(ownerPool);
    expect(facts.ownedRelations).toBeGreaterThan(0);
    expect(databaseRoleProblems(facts).join('; ')).toMatch(/owns \d+ relations/);
  });
});
