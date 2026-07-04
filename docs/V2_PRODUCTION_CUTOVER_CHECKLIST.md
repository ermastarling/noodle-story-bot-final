# Components V2 Production Cutover Checklist

This checklist is used to execute NSB-V2-33 safely and to preserve rollback readiness.

## 1) Pre-Cutover Gates

- `npm run lint` passes on the release branch.
- `npm test` passes on the release branch.
- `npm run review:guard` passes on the release branch.
- Tutorial-focused suites pass:
  - `test/tutorial-major-actions.test.js`
  - `test/tutorial-nav-dispatch-regression.test.js`
  - `test/tutorial-reset.test.js`
  - `test/forage-tutorial-routing.test.js`
- V2 routing suites pass:
  - `test/scene-routing-v2.test.js`
  - `test/scene-state-v2.test.js`

## 2) Staged Enablement

- Stage A: tester guild only, non-tutorial users.
- Stage B: tester guild, tutorial allowlist users.
- Stage C: production canary guild allowlist.
- Stage D: production rollout by guild allowlist expansion.

Suggested environment switches:

- `NOODLE_COMPONENTS_V2_ENABLED=1`
- `NOODLE_COMPONENTS_V2_GUILD_ALLOWLIST=<guild_ids>`
- `NOODLE_COMPONENTS_V2_USER_ALLOWLIST=<optional_user_ids>`
- `NOODLE_COMPONENTS_V2_TUTORIAL_USER_ALLOWLIST=<tutorial_canary_users>`

## 3) Runtime Monitoring

- Validate telemetry events exist in `noodle-logs/telemetry.log`:
  - `v2_scene_transition`
  - `v2_scene_error`
  - `v2_loop_summary`
  - `v2_minigame_outcome`
- Run V2 efficiency report script for go/no-go recommendation.
- Confirm no tutorial regression in live canary sessions.

## 4) Rollback Drill

- Simulate rollback in test environment by setting `NOODLE_COMPONENTS_V2_ENABLED=0`.
- Verify command and component flows continue in legacy V1 paths.
- Verify tutorial replay still works after rollback.
- Record rollback execution time and any manual steps.

## 5) Legacy Cleanup Rules

- Do not remove legacy UI code until acceptance period completes.
- Freeze legacy paths that remain as fallback and document why.
- Remove dead routes only after:
  - one full release cycle with no rollback,
  - telemetry indicates stable V2 loops,
  - owner-approved cleanup review.

## 6) Release Evidence

Attach the following to final migration summary:

- CI links for lint/test/review guard.
- Telemetry efficiency comparison output.
- Tutorial parity test output.
- Rollback drill notes and timestamp.
- Issue links for NSB-V2-01 through NSB-V2-33.
