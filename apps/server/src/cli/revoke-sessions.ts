// Admin CLI: revoke Mise device sessions (lost-device runbook, sections A, C and D).
// Never mints a session. Open SSE streams in the running server close on their next session
// check, not instantly (the in-process revocation signal does not reach another process).
// Usage: pnpm --filter @mise/server cli:revoke-sessions --member <memberId> [--member <id>] | --all
import { runRevokeSessions } from './operator-run.js';

const code = await runRevokeSessions(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(code);
