// Admin CLI: create the household and its two members. Never mints sessions (ADR-003).
// Usage: pnpm --filter @mise/server cli:provision-household --name "Home" \
//   --issuer https://auth.example.com --owner-subject <sub> --owner-name <name> \
//   --member-subject <sub> --member-name <name> [--timezone Europe/Helsinki]
import { runProvisionHousehold } from './provision-household-run.js';

const code = await runProvisionHousehold(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(code);
