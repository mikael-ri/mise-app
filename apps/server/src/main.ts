import { buildApp } from './app.js';
import {
  createAuthService,
  createIdpClient,
  createRevocationHub,
  loginStateKey,
} from './auth/index.js';
import { createHouseholdsService } from './households/index.js';
import { createRecipesService } from './recipes/index.js';
import { createListEventHub, createShoppingService } from './shopping/index.js';
import {
  ConfigError,
  checkDatabaseReady,
  createPool,
  databaseRoleProblems,
  loadConfig,
  loadSpaAssets,
  readDatabaseRoleFacts,
  startPeriodicSweep,
  sweepExpiredKeys,
  trustProxyWarning,
} from './platform/index.js';

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

// ADR-018: in production the server must run as the least-privilege app role. A DATABASE_URL that
// points at the migrator or a superuser would let the app disable the recipe_versions trigger.
if (config.nodeEnv === 'production') {
  const problems = databaseRoleProblems(await readDatabaseRoleFacts(pool));
  if (problems.length > 0) {
    console.error(
      `refusing to start: DATABASE_URL must use the app role (ADR-018): ${problems.join('; ')}`,
    );
    await pool.end();
    process.exit(1);
  }
}
// SSE streams subscribe to this hub to close on revocation (A14).
const revocations = createRevocationHub();
const households = createHouseholdsService(pool);
const authService = createAuthService({
  pool,
  households,
  idp: createIdpClient(config.oidc),
  revocations,
  oidc: config.oidc,
  publicOrigin: config.publicOrigin,
  csrfSecret: config.csrfSecret,
});
const app = buildApp({
  checkReady: () => checkDatabaseReady(pool),
  config,
  households,
  recipes: createRecipesService(pool),
  shopping: {
    service: createShoppingService(pool, createListEventHub()),
    streams: {
      sessions: {
        onRevoked: (sessionId, listener) => revocations.subscribe(sessionId, listener),
        isLive: (actor) => authService.isSessionLive(actor),
      },
    },
  },
  auth: {
    service: authService,
    publicOrigin: config.publicOrigin,
    postLoginLogoutUrl: config.oidc.postLoginLogoutUrl,
    loginStateKey: loginStateKey(config.sessionSecret),
  },
  ...(config.webDistDir === null ? {} : { spa: loadSpaAssets(config.webDistDir) }),
});
const proxyWarning = trustProxyWarning(config);
if (proxyWarning !== null) app.log.warn(proxyWarning);
// Idempotency-key expiry sweep (ADR-013): housekeeping, expired keys already count as absent.
const stopSweep = startPeriodicSweep({
  sweep: () => sweepExpiredKeys(pool),
  intervalMs: 60 * 60 * 1000,
  onSwept: (deleted) => {
    if (deleted > 0) app.log.info({ deleted }, 'expired idempotency keys removed');
  },
  onError: (err) => app.log.warn({ err }, 'idempotency key sweep failed'),
});
app.addHook('onClose', async () => {
  stopSweep();
  await pool.end();
});

await app.listen({ port: config.port, host: config.host });
