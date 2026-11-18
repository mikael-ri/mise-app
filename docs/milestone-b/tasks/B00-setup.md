# B00: Setup and approvals

**Depends on:** none · **Size:** S · **Model tier:** n/a · **Autonomy:** human

## Do (you)
1. Confirm or change the owner decisions in `plan.md`.
2. On the main branch install the approved dependencies (`openai` in the server package, `cheerio`, `sharp`, `@fastify/multipart`, `file-type`) with `pnpm add`, commit the lockfile, merge.
3. Add `.autonomy/` to `.gitignore`. Add `Bash(cat docs/:*)` to `.claude/settings.json` allow.
4. Create the VM, token, GitHub rulesets (PR and checks required on main, no force-push, no deletion, restricted `v*` tags) and the Anthropic spend limit, as in `docs/agentic-autonomy.md`.
5. Pilot night: run one small existing-style card with `--max-hours 2` and read the cost.

## Done when
The canary passes on the VM and a pilot lane produced a PR you could merge.
