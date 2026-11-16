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
  loadConfig,
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
});
const proxyWarning = trustProxyWarning(config);
if (proxyWarning !== null) app.log.warn(proxyWarning);
app.addHook('onClose', async () => {
  await pool.end();
});

await app.listen({ port: config.port, host: config.host });
