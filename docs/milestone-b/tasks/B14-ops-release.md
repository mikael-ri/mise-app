# B14: Assets backup, ops and release

**Depends on:** B13 · **Size:** M · **Model tier:** Regular · **Autonomy:** supervised

## Do
- Note: reloading a recipe export creates new version ids and timestamps, so it is not a restore tool. The restore drill uses the real backup, not export and reload.
- Include assets in the backup and run a restore drill with assets.
- Runbooks for budget exhaustion, a stuck import and draft cleanup.
- Release notes and tag (the tag is created by you).

## Done when
Restore drill documented and passing; runbooks reviewed.
