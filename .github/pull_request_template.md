## Summary
- 

## Target Branch (Required)
- [ ] Target is develop (feature/integration testing)
- [ ] Target is main (release/hotfix only)

Only one box should be checked.

## Scope
- [ ] This PR contains one focused change only (no unrelated refactors/files).
- [ ] Branch was started/synced from the correct upstream target (`cleanstart` / `syncmain`).

## Core Hygiene Checklist (Required For All PRs)
- [ ] I reviewed staged changes before commit (review).
- [ ] Each commit is a logical unit with a clear conventional message.
- [ ] I checked branch divergence (ready) and confirmed no accidental extra commits.
- [ ] I cleaned up commit history (cleanup / squash) before requesting review.

## Conditional Checklist: If Target Is develop
- [ ] I rebased this branch on latest origin/develop.
- [ ] This PR is intended for integration/QA testing, not direct production release.
- [ ] Any release notes or rollout impact are captured for later promotion to main.

## Conditional Checklist: If Target Is main
- [ ] I rebased this branch on latest origin/main.
- [ ] This change is release-ready and already validated at appropriate level.
- [ ] Merge plan keeps main history clean (prefer squash merge unless intentionally preserving a small curated commit set).

## Validation
- [ ] Tests were run locally and pass.
- [ ] Lint/type checks pass (if applicable).

Commands run:
```bash
# paste commands and short results
```

## Risk & Rollback
- [ ] I assessed risk for this change.
- [ ] Rollback is straightforward (revert PR commit/squash commit).

## Reviewer Notes
- Areas to focus on:
- Known limitations:
- Follow-up work (if any):

---

### Review Gate
Do not request review until all required checkboxes are complete.
If any box is intentionally unchecked, explain why in this PR description.
