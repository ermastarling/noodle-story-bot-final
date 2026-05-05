## Summary

Describe what this release changes and why.

## Release Type

- [ ] Promotion PR (develop -> main)
- [ ] Hotfix PR (direct to main)

## Linked Work

- Resolves #
- Related issues:

## Staging Verification (Required)

- [ ] Staging deploy completed successfully
- [ ] Slash commands registered in staging guild
- [ ] Smoke test checklist completed
- [ ] Smoke test evidence attached (screenshots/logs/notes)

Evidence links:
- 

## Production Readiness (Required)

- [ ] CI checks passed
- [ ] Rollback runbook reviewed for this release
- [ ] DB/data migration impact reviewed (or N/A)
- [ ] Webhook/store impact reviewed (or N/A)

## Rollback Plan (Required)

Use this default plan unless a release needs a custom variant:

1. Freeze changes and announce incident
	- Stop additional deploys and post incident note in team channel.
2. Revert code on main
	- Revert the release PR (or bad commit range) on a hotfix branch.
	- Open and merge the rollback PR to main with expedited review.
3. Redeploy production from reverted main
	- Run the production deploy workflow using reverted main.
	- Re-run production command registration if command schema changed.
4. Validate recovery
	- Confirm bot login and heartbeat are healthy.
	- Run core command smoke checks in production server.
	- Confirm telemetry and error logs return to baseline.
5. Data handling
	- If issue is code-only, do not modify DB.
	- If issue includes harmful writes, restore from latest known good backup and document data-loss window.
6. Close incident
	- Add timeline, impact, root cause summary, and follow-up actions to issue/retro.

Release-specific command references (fill before merge):

- Release PR number:
- Revert strategy: Revert PR / Revert commits
- Production deploy workflow runbook link:
- Latest backup identifier/path:
- Owner on call:

## Post-Deploy Checks (Required)

- [ ] Bot process healthy
- [ ] Core command flow verified
- [ ] No critical error spike in logs/telemetry

## Sign-off

- [ ] QA sign-off
- [ ] Release owner sign-off

## Notes

Anything else reviewers should know.
