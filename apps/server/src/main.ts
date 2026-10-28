import pg from 'pg';
import { buildApp } from './app.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 2 }) : undefined;

const app = buildApp({
  checkReady: async () => {
    if (!pool) throw new Error('database not configured');
    await pool.query('select 1');
  },
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

app.addHook('onClose', async () => {
  await pool?.end();
});

await app.listen({ port, host });
