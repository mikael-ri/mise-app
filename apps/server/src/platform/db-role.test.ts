import { describe, expect, it } from 'vitest';
import { databaseRoleProblems } from './db.js';
import type { DatabaseRoleFacts } from './db.js';

const appRole: DatabaseRoleFacts = {
  superuser: false,
  ownedRelations: 0,
  ownedFunctions: 0,
  elevated: false,
  ownsPublicSchema: false,
  ownsDatabase: false,
};

describe('databaseRoleProblems (ADR-018 startup check)', () => {
  it.each<[string, Partial<DatabaseRoleFacts>, RegExp | null]>([
    ['least-privilege app role starts', {}, null],
    ['superuser is refused', { superuser: true }, /superuser/],
    ['table owner (migrator) is refused', { ownedRelations: 12 }, /owns 12 relations/],
    ['function owner is refused', { ownedFunctions: 2 }, /owns 2 functions/],
    ['CREATEROLE/BYPASSRLS is refused', { elevated: true }, /CREATEROLE/],
    ['public schema owner is refused', { ownsPublicSchema: true }, /owns schema public/],
    ['database owner is refused', { ownsDatabase: true }, /owns the database/],
  ])('%s', (_name, overrides, expected) => {
    const problems = databaseRoleProblems({ ...appRole, ...overrides });
    if (expected === null) expect(problems).toEqual([]);
    else expect(problems.join('; ')).toMatch(expected);
  });

  it('reports every problem of a superuser that also owns the schema objects', () => {
    expect(
      databaseRoleProblems({
        superuser: true,
        ownedRelations: 3,
        ownedFunctions: 1,
        elevated: true,
        ownsPublicSchema: true,
        ownsDatabase: true,
      }),
    ).toHaveLength(6);
  });
});
