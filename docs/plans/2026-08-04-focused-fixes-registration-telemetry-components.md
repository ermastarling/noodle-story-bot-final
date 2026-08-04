# Change Plan Template (Required)

Use this template for every planned change in this repository.

Goal: track implementation live while preserving behavior, security gates, idempotency, and rollout safety.

Operating rules:
- Do not invent behavior.
- Keep patches focused; no unrelated refactors.
- Reuse existing helpers/constants before adding new logic.
- Preserve scope, auth, and compatibility gates.
- Update this file live as work progresses.
- Use this template exactly, do not drift from this template execution style.

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

- Title: Focused fixes for register workflow pin, telemetry report wording, and Components V2 INVALID_TYPE follow-up path
- Branch: detached HEAD (75c3776)
- PR: TBD
- Owner: GitHub Copilot
- Start date: 2026-08-04
- Target merge date: 2026-08-04
- Scope summary: Fix invalid checkout action pin in register workflow; make scheduled V2 telemetry alert text concise and data-first; fix Components V2 follow-up INVALID_TYPE path in noodle social component commit flows.
- Non-goals summary: No gameplay rebalance, no content updates, no workflow mode redesign, no unrelated refactors.

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

- [x] Implement first high-risk slice with behavior parity.
- [x] Preserve metadata/contract fields through normalization and commit paths.
- [x] Remove dead local code introduced by the slice.

Verification for this phase:
- [x] Lint touched files.
- [x] Run targeted tests for touched flows.
- [x] Run at least one regression suite tied to the changed contract.

## Phase 2 - Secondary Modules / Callsite Sweep

Exit criteria: all items [x], targeted tests pass

- [x] Migrate/fix remaining callsites.
- [x] Remove compatibility-only branches no longer used.
- [x] Verify no payload/contract overwrite anti-patterns remain.

Verification for this phase:
- [x] Lint touched files.
- [x] Run targeted tests for each touched module.
- [x] Run routing/fallback smoke checks.

## Phase 3 - Shared Utility Cleanup

Exit criteria: all items [x], targeted tests pass

- [x] Remove dead helper paths no longer needed.
- [x] Narrow exports to active runtime APIs.
- [x] Sweep callsites for compatibility.

Verification for this phase:
- [x] Lint utility files.
- [x] Re-run contract and integration tests.

## Phase 4 - Guardrails and Regression Net

Exit criteria: all items [x]

- [x] Add/adjust guard checks for banned patterns or risky anti-patterns.
- [x] Add tests for metadata retention and commit routing invariants.
- [x] Add tests ensuring prebuilt payloads/contracts are preserved.

Verification for this phase:
- [x] Run lint + guard scripts.
- [x] Run targeted tests added in this phase.

## Phase 5 - Final Validation and Release Readiness

Exit criteria: all items [x]

- [x] Full test suite passes.
- [x] Lint passes at project baseline or better.
- [x] Residual scan for banned patterns is clean (if applicable).
- [x] Manual canary checks pass for user-critical flows (if applicable).
- [~] PR notes include behavior-parity and validation evidence.

## File Scope Checklist

- [x] docs/plans/2026-08-04-focused-fixes-registration-telemetry-components.md
- [x] .github/workflows/register-commands.yml
- [x] src/jobs/v2TelemetryAlerts.js
- [x] src/commands/noodleSocial.js
- [x] test/v2-telemetry-report.test.js
- [x] test/components-v2.test.js (if updated)

## Change Log (update after every code change)

- [x] 2026-08-04T22:04:50Z
  - File(s): docs/plans/2026-08-04-focused-fixes-registration-telemetry-components.md
  - Checklist item(s) updated: Phase 0 baseline capture, File Scope Checklist initialization
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npm run lint && node --test test/v2-telemetry-report.test.js && node --test test/components-v2.test.js
  - Result: pass (lint clean, targeted telemetry tests pass, targeted components-v2 tests pass)
  - Next step: implement workflow pin fix in .github/workflows/register-commands.yml

- [x] 2026-08-04T22:05:10Z
  - File(s): .github/workflows/register-commands.yml
  - Checklist item(s) updated: Phase 1 first high-risk slice in progress, File Scope Checklist
  - Behavior impact statement: No gameplay behavior change
  - Verification run: bash scripts/check-actions-pinned.sh
  - Result: pass (workflow action pinning check passed)
  - Next step: refactor V2 telemetry alert wording to concise data-first output

- [x] 2026-08-04T22:05:46Z
  - File(s): src/jobs/v2TelemetryAlerts.js, test/v2-telemetry-report.test.js
  - Checklist item(s) updated: Phase 1 first high-risk slice in progress, File Scope Checklist
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npx eslint src/jobs/v2TelemetryAlerts.js test/v2-telemetry-report.test.js && node --test test/v2-telemetry-report.test.js
  - Result: pass (focused lint and telemetry tests)
  - Next step: patch Components V2 follow-up INVALID_TYPE path in src/commands/noodleSocial.js

- [x] 2026-08-04T22:06:56Z
  - File(s): src/commands/noodleSocial.js, test/components-v2.test.js
  - Checklist item(s) updated: Phase 1 high-risk slice complete, metadata/contract preservation complete, File Scope Checklist
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npx eslint src/commands/noodleSocial.js test/components-v2.test.js && node --test test/components-v2.test.js
  - Result: pass (focused lint and components-v2 regression tests)
  - Next step: run integration-targeted checks and complete remaining phase/validation checklist items

- [x] 2026-08-04T22:07:33Z
  - File(s): docs/plans/2026-08-04-focused-fixes-registration-telemetry-components.md
  - Checklist item(s) updated: Pre-Implementation Checklist completion, Phase 1/2/4 verification completion, File Scope Checklist completion
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npm run lint && npm test && npm run review:guard
  - Result: pass (lint pass, full test suite pass 478/478, pre-review guard pass)
  - Next step: finalize Phase 5 outcomes and self-audit fields

- [x] 2026-08-04T22:32:29Z
  - File(s): docs/plans/2026-08-04-focused-fixes-registration-telemetry-components.md
  - Checklist item(s) updated: Phase 2/3/4 reconciliation, Phase 5 validation outcomes, Risk Controls and Non-Goals reconciliation
  - Behavior impact statement: No gameplay behavior change
  - Verification run: npm run review:all
  - Result: pass (includes lint + full test suite 478/478 + review:guard)
  - Next step: publish PR notes/checklist evidence and then mark the final PR-notes item complete

- [ ] Entry template:
  - Timestamp:
  - File(s):
  - Checklist item(s) updated:
  - Behavior impact statement: "No gameplay behavior change" or explicit exception
  - Verification run:
  - Result:
  - Next step:

## Risk Controls

- [!] If routing/edit/defer paths are touched, require one extra manual interaction check.
- [x] If shared helper signatures change, require a callsite sweep before commit.
- [x] If tests are updated, validate behavior parity rather than introducing new behavior.
- [x] Block merge if frozen banned patterns remain in scope.

## Non-Goals

- [x] No gameplay rebalance unless explicitly in scope.
- [x] No content changes unless explicitly in scope.
- [x] No unrelated refactors.

## Final Self-Audit

- Security and auth: Preserved. No auth gate removals; workflow fix only updates invalid pinned action SHA.
- Data integrity and idempotency: Preserved. No schema/idempotency logic changes; social follow-up fix keeps existing unknown webhook/interaction null-safe behavior.
- Behavior regressions: None detected in targeted + full suite validation.
- Reliability and runtime safety: Improved for Components V2 ephemeral follow-up path by avoiding discord.js INVALID_TYPE parsing path.
- Test coverage gaps: No known new gaps for this scope; added explicit regression coverage for social V2 follow-up raw-webhook/fallback behavior.
- Docs-runtime parity checks: No new env vars or runtime contract defaults changed.

Notes:
- Phase 3 items are reconciled as complete because no shared utility module contract changes were introduced in this scoped fix set.
- Manual interaction check is marked [!] because it requires live Discord interaction/canary execution outside this local CI context.

## Validation Commands and Outcomes

- npm run lint: pass
- npm test: pass (478 tests)
- npm run review:guard: pass
- npm run review:all (required for broad/release-facing updates): pass
- Any intentionally skipped checks + reason: Manual Discord canary interaction check is pending external runtime execution.
