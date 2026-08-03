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

- Title:
- Branch:
- PR:
- Owner:
- Start date:
- Target merge date:
- Scope summary:
- Non-goals summary:

## Pre-Implementation Checklist

- [ ] security/auth gates preserved
- [ ] idempotency key and retry semantics still valid
- [ ] routing/state invariants preserved (including snapshot-driven flows)
- [ ] fallback paths preserve severity/signal and valid scope
- [ ] docs/runtime parity maintained for changed defaults/contracts

## Phase 0 - Baseline Safety and Inventory

Exit criteria: all items [x]

- [ ] Capture baseline test/quality snapshot:
  - lint status
  - targeted tests for touched systems
- [ ] Generate current risk inventory for touched paths.
- [ ] Freeze banned patterns for this change (if applicable).
- [ ] Confirm migration/fix order and highest-risk areas first.

## Phase 1 - Core Implementation

Exit criteria: all items [x], targeted tests pass

- [ ] Implement first high-risk slice with behavior parity.
- [ ] Preserve metadata/contract fields through normalization and commit paths.
- [ ] Remove dead local code introduced by the slice.

Verification for this phase:
- [ ] Lint touched files.
- [ ] Run targeted tests for touched flows.
- [ ] Run at least one regression suite tied to the changed contract.

## Phase 2 - Secondary Modules / Callsite Sweep

Exit criteria: all items [x], targeted tests pass

- [ ] Migrate/fix remaining callsites.
- [ ] Remove compatibility-only branches no longer used.
- [ ] Verify no payload/contract overwrite anti-patterns remain.

Verification for this phase:
- [ ] Lint touched files.
- [ ] Run targeted tests for each touched module.
- [ ] Run routing/fallback smoke checks.

## Phase 3 - Shared Utility Cleanup

Exit criteria: all items [x], targeted tests pass

- [ ] Remove dead helper paths no longer needed.
- [ ] Narrow exports to active runtime APIs.
- [ ] Sweep callsites for compatibility.

Verification for this phase:
- [ ] Lint utility files.
- [ ] Re-run contract and integration tests.

## Phase 4 - Guardrails and Regression Net

Exit criteria: all items [x]

- [ ] Add/adjust guard checks for banned patterns or risky anti-patterns.
- [ ] Add tests for metadata retention and commit routing invariants.
- [ ] Add tests ensuring prebuilt payloads/contracts are preserved.

Verification for this phase:
- [ ] Run lint + guard scripts.
- [ ] Run targeted tests added in this phase.

## Phase 5 - Final Validation and Release Readiness

Exit criteria: all items [x]

- [ ] Full test suite passes.
- [ ] Lint passes at project baseline or better.
- [ ] Residual scan for banned patterns is clean (if applicable).
- [ ] Manual canary checks pass for user-critical flows (if applicable).
- [ ] PR notes include behavior-parity and validation evidence.

## File Scope Checklist

- [ ] List each touched file/module as work begins and mark complete when done.

## Change Log (update after every code change)

- [ ] Entry template:
  - Timestamp:
  - File(s):
  - Checklist item(s) updated:
  - Behavior impact statement: "No gameplay behavior change" or explicit exception
  - Verification run:
  - Result:
  - Next step:

## Risk Controls

- [ ] If routing/edit/defer paths are touched, require one extra manual interaction check.
- [ ] If shared helper signatures change, require a callsite sweep before commit.
- [ ] If tests are updated, validate behavior parity rather than introducing new behavior.
- [ ] Block merge if frozen banned patterns remain in scope.

## Non-Goals

- [ ] No gameplay rebalance unless explicitly in scope.
- [ ] No content changes unless explicitly in scope.
- [ ] No unrelated refactors.

## Final Self-Audit

- Security and auth:
- Data integrity and idempotency:
- Behavior regressions:
- Reliability and runtime safety:
- Test coverage gaps:
- Docs-runtime parity checks:

## Validation Commands and Outcomes

- npm run lint:
- npm test:
- npm run review:guard:
- npm run review:all (required for broad/release-facing updates):
- Any intentionally skipped checks + reason: