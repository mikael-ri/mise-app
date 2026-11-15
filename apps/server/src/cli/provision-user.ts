// Admin CLI: link a household member to an OIDC subject (e.g. after an Authelia username change).
// Revokes the member's existing sessions. Never mints a session (ADR-003).
// Usage: pnpm --filter @mise/server cli:provision-user --member <memberId> \
//   --issuer https://auth.example.com --subject <sub>
import { runProvisionUser } from './operator-run.js';

const code = await runProvisionUser(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(code);
