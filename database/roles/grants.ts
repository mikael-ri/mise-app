// Privileges of the application role (ADR-018). The migrator role owns every schema object; the app role
// gets only what the application needs. Idempotent: running it again converges to the same state.
// Must run connected AS THE MIGRATOR (the owner), because `ALTER DEFAULT PRIVILEGES` without FOR ROLE
// applies to objects the current role creates later, and only an owner can grant on its objects.

/**
 * Tables where the domain hard-deletes rows, and therefore the only tables the app role may DELETE from.
 * Everything else is insert/update only. Adding a table here is a security-relevant change (ADR-018).
 */
export const APP_DELETE_TABLES = ['idempotency_keys', 'shopping_items'] as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface Queryable {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Role names come from configuration, never from request input; still validated before quoting. */
export function quoteRole(role: string): string {
  if (!IDENTIFIER.test(role)) throw new Error('role name must match [a-z_][a-z0-9_]*');
  return `"${role}"`;
}

export function appGrantStatements(appRole: string): string[] {
  const app = quoteRole(appRole);
  return [
    // No DDL for the app: CREATE on the schema is withheld from everyone but the owner.
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    `REVOKE CREATE ON SCHEMA public FROM ${app}`,
    `GRANT USAGE ON SCHEMA public TO ${app}`,
    // Future objects created by the migrator need no individual grants.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ${app}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${app}`,
    // Existing objects. The REVOKE first makes a removed DELETE grant disappear on the next run.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${app}`,
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${app}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${app}`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${app}`,
    `GRANT DELETE ON ${APP_DELETE_TABLES.map((t) => `"${t}"`).join(', ')} TO ${app}`,
  ];
}

/**
 * Refuses to run as anything but the migrator: grants only take effect when issued by the owner, a
 * non-owner would silently change nothing, and a superuser would attach the default privileges to
 * itself instead of the role that creates the tables.
 */
async function assertRunningAsOwner(q: Queryable, appRole: string): Promise<void> {
  const { rows } = await q.query(
    `SELECT current_user AS who,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
            (SELECT count(*)::int FROM pg_tables
              WHERE schemaname = 'public' AND tableowner <> current_user) AS foreign_tables`,
  );
  const r = rows[0];
  if (!r || r['superuser'] === true) {
    throw new Error('grants must run as the migrator role, not as a superuser');
  }
  if (r['who'] === appRole) throw new Error('grants must not run as the app role itself');
  if (Number(r['foreign_tables']) > 0) {
    throw new Error('some tables in public are not owned by the connected role (the migrator)');
  }
}

/** All statements in one transaction: the app role is never left half-stripped of privileges. */
export async function applyAppGrants(q: Queryable, appRole: string): Promise<void> {
  const statements = appGrantStatements(appRole); // validates the role name first
  await assertRunningAsOwner(q, appRole);
  await q.query('BEGIN');
  try {
    for (const statement of statements) await q.query(statement);
    await q.query('COMMIT');
  } catch (err) {
    await q.query('ROLLBACK');
    throw err;
  }
}
