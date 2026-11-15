import { describe, expect, it } from 'vitest';
import { APP_DELETE_TABLES, appGrantStatements, applyAppGrants } from './grants';
import type { Queryable } from './grants';

describe('ADR-018 app role grants', () => {
  const statements = appGrantStatements('mise_app');
  const all = statements.join('\n');

  it('grants DELETE only on the listed tables and never TRUNCATE/TRIGGER/REFERENCES/CREATE', () => {
    const deletes = statements.filter((s) => /\bDELETE\b/.test(s) && s.startsWith('GRANT'));
    expect(deletes).toEqual([
      `GRANT DELETE ON ${APP_DELETE_TABLES.map((t) => `"${t}"`).join(', ')} TO "mise_app"`,
    ]);
    expect(all).not.toMatch(/GRANT[^\n]*(TRUNCATE|TRIGGER|REFERENCES|ALL PRIVILEGES)/);
    expect(all).not.toMatch(/GRANT[^\n]*CREATE/);
  });

  it('sets default privileges so new tables need no individual grant', () => {
    expect(all).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO "mise_app"',
    );
    expect(all).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO "mise_app"',
    );
  });

  it.each(['mise_app; DROP TABLE x', 'Mise', '"quoted"', '', 'a b'])(
    'rejects the role name %j',
    (role) => {
      expect(() => appGrantStatements(role)).toThrow(/role name/);
    },
  );
});

describe('applyAppGrants safety', () => {
  const fake = (who: Record<string, unknown>) => {
    const log: string[] = [];
    const q: Queryable = {
      query: async (sql) => {
        log.push(sql);
        return { rows: sql.includes('current_user') ? [who] : [] };
      },
    };
    return { q, log };
  };
  const owner = { who: 'mise_migrator', superuser: false, foreign_tables: 0 };

  it('runs every statement inside one transaction', async () => {
    const { q, log } = fake(owner);
    await applyAppGrants(q, 'mise_app');
    expect(log[1]).toBe('BEGIN');
    expect(log.at(-1)).toBe('COMMIT');
    expect(log).not.toContain('ROLLBACK');
  });

  it('rolls back when a statement fails', async () => {
    const log: string[] = [];
    const q: Queryable = {
      query: async (sql) => {
        log.push(sql);
        if (sql.startsWith('GRANT DELETE')) throw new Error('relation does not exist');
        return { rows: sql.includes('current_user') ? [owner] : [] };
      },
    };
    await expect(applyAppGrants(q, 'mise_app')).rejects.toThrow('does not exist');
    expect(log.at(-1)).toBe('ROLLBACK');
    expect(log).not.toContain('COMMIT');
  });

  it.each([
    ['a superuser', { ...owner, superuser: true }, /superuser/],
    ['the app role itself', { ...owner, who: 'mise_app' }, /app role/],
    ['a role that does not own the tables', { ...owner, foreign_tables: 3 }, /not owned/],
  ])('refuses to run as %s and changes nothing', async (_n, who, message) => {
    const { q, log } = fake(who);
    await expect(applyAppGrants(q, 'mise_app')).rejects.toThrow(message);
    expect(log).toHaveLength(1);
  });
});
