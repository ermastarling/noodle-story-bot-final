# Change Plan: Preventing Tutorial Orders from Being Lost

## Plan Metadata

- Title: Preventing tutorial orders from expiring or being cleared
- Branch: `fix/tutorial-order-loss-node24`
- PR: Pending creation against `main`
- Owner: Copilot SDK assistant
- Start date: 2026-10-21 (plan recorded after implementation began)
- Target merge date: TBD
- Scope summary: Retrospectively document the tutorial order-loss fix already applied: disable timed orders during an active tutorial, protect accepted tutorial orders from expiry cleanup and day rollover, and ensure serving an order from a previous day does not consume an index on the current board.
- Non-goals summary: No changes to regular timed-order rules, tutorial progression steps, reward balance, recipes, or unrelated order handling.

This plan is recorded after the code changes were made. Validation and change-log entries below distinguish verified results from checks that remain blocked or were not run.

## Pre-Implementation Checklist

- [x] security/auth gates preserved
- [x] idempotency key and retry semantics still valid
- [x] routing/state invariants preserved (including snapshot-driven flows)
- [x] fallback paths preserve severity/signal and valid scope
- [x] docs/runtime parity maintained for changed defaults/contracts

## Phase 0 - Baseline Safety and Inventory

Exit criteria: all items [x]

- [!] Capture baseline test/quality snapshot:
  - [x] lint status captured after the fix
  - [x] focused tests for touched systems captured
  - [!] pre-change baseline is unavailable because this plan was requested after implementation
- [x] Generate current risk inventory for touched paths.
- [x] Freeze banned patterns for this change: no new environment variables, persistence schema, or component payload contract.
- [x] Confirm migration/fix order and highest-risk areas first: daily rollover and expiry deletion paths; then serve eligibility/display and consumed-index handling.

## Phase 1 - Core Implementation

Exit criteria: all items [x], targeted tests pass

- [x] Make tutorial-generated orders untimed while leaving regular order generation unchanged.
- [x] Preserve an accepted tutorial order across daily order-board rollover.
- [x] Remove the tutorial-only limit on first acceptance; every order accepted while the tutorial is active is untimed.
- [x] Prevent the accepted tutorial order from being deleted by expiry cleanup or serve-time expiry validation.
- [x] Normalize legacy accepted tutorial entries so `expires_at` is `null` and their order snapshot is not limited-time.
- [x] Avoid marking a previous-day order index as consumed on the newly generated daily board.

Verification for this phase:
- [x] Lint touched files. Targeted lint completed with no errors; one existing unused-parameter warning was reported in `src/commands/noodle.js`.
- [x] Run focused tests for tutorial/order/serve flows: 28 tests passed.
- [x] Run at least one regression suite tied to the changed contract: `node --test test/orders-board.test.js` passed all 8 tests.

## Phase 2 - Secondary Modules / Callsite Sweep

Exit criteria: all items [x], targeted tests pass

- [x] Protect persistence cleanup from deleting expired accepted orders while the tutorial is active.
- [x] Update serve-picker expiry classification and serve-all eligibility to ignore expiry for active tutorial orders.
- [x] Update accepted-order display so it does not show a tutorial order as expired or timed.
- [x] Keep normal expiry handling active outside the tutorial.
- [x] Verify no payload/contract overwrite anti-patterns remain: no payload contracts or component custom IDs changed.

Verification for this phase:
- [x] Lint touched files: `npm run lint` completed with no errors; three existing unused-parameter warnings were reported across the repository.
- [x] Run targeted tests for each touched module: order-board, tutorial-major-action, and serve-flow tests passed.
- [x] Run routing/fallback smoke checks: tutorial routing tests passed as part of the focused test run.

## Phase 3 - Shared Utility Cleanup

Exit criteria: all items [x], targeted tests pass

- [x] Remove dead helper paths no longer needed: none introduced.
- [x] Narrow exports to active runtime APIs: no exports changed.
- [x] Sweep callsites for compatibility: expiry and accepted-order cleanup callsites in the touched runtime paths were checked.

Verification for this phase:
- [x] Lint utility files: `src/game/orders.js` and `src/db/index.js` linted without errors.
- [x] Re-run contract and integration tests: focused tests passed.

## Phase 4 - Guardrails and Regression Net

Exit criteria: all items [x]

- [x] Add/adjust guard checks for banned patterns or risky anti-patterns: no new guard rule was needed.
- [x] Add tests for tutorial boards with a 100% limited-time chance; assert generated orders are never limited-time and have no expiry.
- [x] Add a control assertion that regular players still receive limited-time orders when configured.
- [x] Add a test proving daily rollover preserves accepted tutorial orders while resetting the current board's consumed indices.
- [x] Add tests ensuring prebuilt payloads/contracts are preserved: no payload contracts changed; existing serve-flow tests remain passing.

Verification for this phase:
- [x] Run lint + guard scripts: `npm run lint` had 0 errors; `npm run review:guard` passed.
- [x] Run targeted tests added in this phase: `node --test test/orders-board.test.js` passed all 8 tests.

## Phase 5 - Final Validation and Release Readiness

Exit criteria: all items [x]

- [!] Full test suite passes: `npm test` ran 475 tests; 474 passed and `test/social.test.js` crashed during native `better-sqlite3` teardown.
- [x] Lint passes at project baseline or better: no errors; three unused-parameter warnings were reported.
- [x] Residual scan for banned patterns is clean: `npm run review:guard` passed.
- [!] Manual canary checks pass for user-critical flows: not run; requires an interactive game environment.
- [~] PR notes include behavior-parity and validation evidence: prepared for the clean branch; PR pending creation.
- [x] GitHub Actions validates the fix on Node 24.x: the full workflow passed on the prior branch at the same source commit; the clean-branch workflow will run after PR creation.

## File Scope Checklist

- [x] `src/game/orders.js` — suppress limited-time generation for active tutorial players; preserve accepted tutorial orders across day rollover.
- [x] `src/commands/noodle.js` — keep tutorial orders valid through expiry cleanup, serve eligibility, picker display, serving, and rollover index bookkeeping.
- [x] `src/db/index.js` — keep persistence pruning from deleting timed accepted orders during the tutorial and normalize legacy timer metadata.
- [x] `test/orders-board.test.js` — cover untimed tutorial boards, regular-order control behavior, and tutorial order retention across rollover.
- [x] `.github/workflows/node.js.yml` — include Node 24.x in the existing CI version matrix; full CI passed on 18.x, 20.x, 22.x, and 24.x on the prior branch.
- [x] `docs/plans/2026-10-21-tutorial-order-loss.md` — record the fix and its verification status.

## Change Log (update after every code change)

- [x] Entry:
  - Timestamp: 2026-10-21 (plan documentation; implementation predates this plan)
  - File(s): `src/game/orders.js`, `src/commands/noodle.js`, `src/db/index.js`, `test/orders-board.test.js`
  - Checklist item(s) updated: Phase 1 core implementation; Phase 2 expiry callsites; Phase 4 regression tests; Phase 5 validation results.
  - Behavior impact statement: Intentional tutorial-only behavior change. Active tutorial orders do not expire, are preserved across daily rollover, and are not treated as timed; regular players retain existing timed-order behavior.
  - Verification run: focused tutorial/order/serve tests (28 passed); `node --test test/orders-board.test.js` (8 passed); `npm run test:no-sqlite` (459 passed); `npm run lint` (0 errors, 3 warnings); `npm run review:guard` (passed); `npm test` (474 passed, one native teardown crash in `test/social.test.js`).
  - Result: The relevant tutorial paths and regression cases pass. Full-suite confidence is limited by the `better-sqlite3` teardown crash and the absence of an interactive canary.
  - Next step: Re-run `npm test` in a stable SQLite/native environment and manually verify accept → buy → forage → cook → serve, including a delayed serve and day rollover.
- [~] Entry:
  - Timestamp: 2026-10-21
  - File(s): `.github/workflows/node.js.yml`, `docs/plans/2026-10-21-tutorial-order-loss.md`
  - Checklist item(s) updated: Phase 5 Node 24.x CI validation; file scope.
  - Behavior impact statement: No gameplay behavior change; CI now includes the Node 24.x release line.
  - Verification run: `npm run review:guard` passed before this workflow edit; GitHub Actions result pending push.
  - Result: Workflow matrix updated to test 18.x, 20.x, 22.x, and 24.x.
  - Next step: Push `develop` and open a draft PR to `main` so CI can run; review the Node 24.x job result before merging.
- [x] Entry:
  - Timestamp: 2026-10-21
  - File(s): `docs/plans/2026-10-21-tutorial-order-loss.md`
  - Checklist item(s) updated: Phase 5 CI and PR status; branch metadata.
  - Behavior impact statement: No gameplay behavior change; documentation now reflects the clean PR branch and prior green CI.
  - Verification run: Targeted tutorial/order/serve tests (28 passed); `npm run lint` (0 errors, 3 warnings); `npm run review:guard` (passed).
  - Result: Plan now identifies `fix/tutorial-order-loss-node24`; Node 24.x passed on the same source snapshot in the prior CI run.
  - Next step: Push this clean branch, open the replacement PR, then confirm its fresh CI run before marking ready.

## Risk Controls

- [x] If routing/edit/defer paths are touched, require one extra manual interaction check: manual canary remains pending; no routing handlers or interaction custom IDs were changed.
- [x] If shared helper signatures change, require a callsite sweep before commit: no shared helper signatures changed.
- [x] If tests are updated, validate behavior parity rather than introducing new behavior: regular-player timed-order control assertion added and passes.
- [x] Block merge if frozen banned patterns remain in scope: `npm run review:guard` passed.

## Non-Goals

- [x] No gameplay rebalance unless explicitly in scope.
- [x] No content changes unless explicitly in scope.
- [x] No unrelated refactors.

## Final Self-Audit

- Security and auth: No auth, authorization, or security-sensitive boundaries changed.
- Data integrity and idempotency: Accepted tutorial entries survive rollover and persistence pruning; serving older accepted entries does not consume a new day's order index. No idempotency keys changed.
- Behavior regressions: Timed-order generation/expiry remains enabled for non-tutorial players; a regular-player control test verifies generation.
- Reliability and runtime safety: Persistence and command cleanup paths both protect tutorial orders. Full SQLite-backed validation remains incomplete due the native teardown crash.
- Test coverage gaps: No direct integration test exercises `prunePlayerBeforePersist` or the end-to-end Discord accept-to-serve flow; manual canary and repeat full-suite run remain recommended.
- Docs-runtime parity checks: This plan records the tutorial-only timer and rollover behavior change and all known verification outcomes.

## Validation Commands and Outcomes

- `npm run lint`: passed with 0 errors and 3 existing unused-parameter warnings.
- `npm test`: 474 passed; `test/social.test.js` failed at process teardown in native `better-sqlite3`.
- `npm run review:guard`: passed.
- `npm run review:all` (required for broad/release-facing updates): not run; includes the full suite that hit the native teardown failure.
- GitHub Actions full CI: passed on 18.x, 20.x, 22.x, and 24.x for the same source snapshot on the prior branch; fresh clean-branch PR run pending.
- Any intentionally skipped checks + reason: Manual canary not run because an interactive game environment is unavailable. The complete SQLite-backed suite should be repeated in a stable native environment.
