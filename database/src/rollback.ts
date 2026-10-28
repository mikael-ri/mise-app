// Runs hand-written down migrations (Drizzle Kit has no down). Usage: node src/rollback.ts [count=1]
// Also clears the drizzle journal rows so `db:migrate` re-applies them.
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (process.env['NODE_ENV'] === 'production') throw new Error('rollback is dev/scratch only');
const count = Number(process.argv[2] ?? '1');
const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
await client.connect();
try {
  const downs = readdirSync(new URL('../migrations/down/', import.meta.url))
    .filter((f) => f.endsWith('.down.sql'))
    .sort()
    .reverse()
    .slice(0, count);
  for (const f of downs) {
    await client.query('BEGIN');
    await client.query(readFileSync(new URL(`../migrations/down/${f}`, import.meta.url), 'utf8'));
    await client.query(
      'DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)',
    );
    await client.query('COMMIT');
    console.log(`rolled back ${f}`);
  }
} finally {
  await client.end();
}
