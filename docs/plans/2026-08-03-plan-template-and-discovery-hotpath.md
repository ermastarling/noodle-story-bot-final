# Change Plan: Plan Template Rollout + Discovery Hot Path Cleanup

Goal: establish a repeatable live-tracking template/workflow for all planned changes and remove one dead O(n) discovery allocation on serve attempts without behavior changes.

Operating rules:
- Do not invent behavior.
- Keep patches focused; no unrelated refactors.
- Reuse existing helpers/constants before adding new logic.
- Preserve scope, auth, and compatibility gates.
- Update this file live as work progresses.

Progress legend:
- [ ] not started
- [~] in progress
- [x] complete
- [!] blocked

Execution protocol (run after every code change):
1. Update this plan immediately:
- Mark touched checklist items.
- Add one entry in Change Log.
- Add verification results for that step.
2. Run targeted checks for touched area before moving to next area.
3. If any regression appears, stop, revert only the faulty local change, and record blocker details.
4. Do not start the next phase until current phase exit criteria are marked [x].

## Plan Metadata

- Title: Plan template rollout and discovery hot-path cleanup
- Branch: hotfix/recover-pr141-ux-20260726
- PR: https://github.com/ermastarling/noodle-story-bot-final/pull/169
- Owner: Copilot pair session
- Start date: 2026-08-03
- Target merge date: 2026-08-03
- Scope summary: docs template/workflow and one runtime dead-work removal in discovery serve flow
- Non-goals summary: no gameplay/economy/progression changes

## Pre-Implementation Checklist

- [x] security/auth gates preserved
- [x] idempotency key and retry semantics still valid
- [x] routing/state invariants preserved (including snapshot-driven flows)
- [x] fallback paths preserve severity/signal and valid scope
- [x] docs/runtime parity maintained for changed defaults/contracts

## Phase 0 - Baseline Safety and Inventory

Exit criteria: all items [x]

- [x] Capture baseline test/quality snapshot:
  - lint status
  - targeted tests for touched systems
- [x] Generate current risk inventory for touched paths.
- [x] Freeze banned patterns for this change (if applicable).
- [x] Confirm migration/fix order and highest-risk areas first.

## Phase 1 - Core Implementation

Exit criteria: all items [x], targeted tests pass

- [x] Add repeatable plan template doc.
- [x] Add required workflow rule references.
- [x] Remove dead O(n) discovery pre-check allocation in serve hot path.

Verification for this phase:
- [x] Lint touched files.
- [x] Run targeted tests for touched flows.
- [x] Run regression suite tied to serve/discovery behavior.

## Phase 2 - Final Validation and Handoff

Exit criteria: all items [x]

- [x] review:guard passes.
- [x] docs index updated.
- [x] live plan for this change recorded in docs/plans.

## File Scope Checklist

- [x] docs/CHANGE_PLAN_TEMPLATE.md
- [x] docs/GIT_WORKFLOW.md
- [x] docs/README.md
- [x] docs/plans/README.md
- [x] docs/plans/2026-08-03-plan-template-and-discovery-hotpath.md
- [x] src/game/discovery.js

## Change Log

- [x] 2026-08-03T00:00Z - Added repository-wide repeatable change-plan template and workflow references
  - File(s): docs/CHANGE_PLAN_TEMPLATE.md, docs/GIT_WORKFLOW.md, docs/README.md, docs/plans/README.md
  - Checklist item(s) updated: Phase 1 docs rollout items complete
  - Behavior impact statement: No gameplay behavior change
  - Verification run: review:guard after edits
  - Result: guard passed; docs links and process requirements in place
  - Next step: remove discovery dead hot-path allocation and run targeted validation

- [x] 2026-08-03T00:10Z - Removed unused discoverable-recipes pre-check in serve discovery roll
  - File(s): src/game/discovery.js
  - Checklist item(s) updated: Phase 1 runtime cleanup and tests complete
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npx eslint src/game/discovery.js && node --test test/discovery.test.js test/major-actions-regression.test.js && npm run review:guard
  - Result: lint clean; 36/36 targeted tests pass; guard passed
  - Next step: handoff with risk/self-audit summary

## Risk Controls

- [x] If routing/edit/defer paths are touched, require one extra manual interaction check.
- [x] If shared helper signatures change, require a callsite sweep before commit.
- [x] If tests are updated, validate behavior parity rather than introducing new behavior.
- [x] Block merge if frozen banned patterns remain in scope.

## Non-Goals

- [x] No gameplay rebalance.
- [x] No content changes.
- [x] No unrelated refactors.

## Final Self-Audit

- Security and auth: No issues found.
- Data integrity and idempotency: No issues found.
- Behavior regressions: No issues found in targeted suites.
- Reliability and runtime safety: No issues found; one serve hot-path allocation removed.
- Test coverage gaps: manual canary not run in this change.
- Docs-runtime parity checks: No issues found.

## Validation Commands and Outcomes

- npm run lint: skipped (targeted lint used for touched runtime file)
- npm test: skipped (targeted suites used for touched behavior)
- npm run review:guard: pass
- npm run review:all: skipped (change scope is narrow)
- Any intentionally skipped checks + reason: full-suite checks skipped for speed; targeted tests cover discovery and major-action regressions.