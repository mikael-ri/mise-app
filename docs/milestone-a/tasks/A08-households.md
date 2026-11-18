# A08 — Households and actor context

**Depends on:** A04, A06 · **Size:** S · **Model tier:** Regular
**Covers:** FR-30, FR-31
**Read only:** DB §3, §10.1; tech §4, §5, §12 (Authorization)

## Goal
Household-scoped access that every later module reuses.

## Do
- Household and member repositories and services; actor context derived from the session only.
- A repository helper that enforces `household_id` scoping; composite-FK helpers.
- An isolation test harness with a second household fixture, reused by later modules.
- CLI step to create your household and the two members.

## Not in scope
- Roles beyond the two members, invitations.

## Done when
- Tests prove cross-household reads and writes are denied for a sample entity.
- Module convention (`routes/service/repository/index`) demonstrated and documented in the PR.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
