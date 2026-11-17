// Ports and origin of the E2E stack. Deliberately not the dev ports (5173, 3000), so `pnpm e2e` can run
// while `pnpm dev` is running and never talks to a developer's server or database.
export const E2E_ORIGIN = 'http://localhost:5183'; // what the browser uses (connection-proxy)
export const E2E_PROXY_PORT = 5183;
export const E2E_VITE_PORT = 5184;
export const E2E_API_PORT = 3100;
export const E2E_OIDC_PORT = 9099;
export const E2E_PROXY_CONTROL_PORT = 3102;
