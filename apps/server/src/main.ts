import { buildApp } from './app.js';
import { ConfigError, checkDatabaseReady, createPool, loadConfig } from './platform/index.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message); // names variables only, never values
    process.exit(1);
  }
  throw err;
}

const pool = createPool(config.databaseUrl, config.databasePoolMax);
const app = buildApp({ checkReady: () => checkDatabaseReady(pool), config });
app.addHook('onClose', async () => {
  await pool.end();
});

await app.listen({ port: config.port, host: config.host });
