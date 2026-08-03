---
name: Noodle Repo Standards
description: "Use when generating or editing Noodle Story bot code, tests, scripts, webhook handlers, environment config docs, or Discord command flows. Focus on consistency, low repetition, performance, and security."
applyTo: "src/**/*.js, test/**/*.js, scripts/**/*.js, README.md, docs/**/*.md, .github/workflows/**/*.yml, package.json"
---
# Noodle Story Engineering Standards

## Purpose
- Prefer existing helpers/constants over new parallel logic.
- Keep code paths short and explicit; avoid hidden side effects.
- Make retry-prone flows idempotent.
- Keep security gates and scope checks obvious in command/webhook entry points.

## Core Principles
- Search for existing implementations in src/game, src/commands, src/infra, and src/util before adding new modules.
- Reuse shared formatters, effect calculators, and content loaders.
- Avoid repeated expensive operations in hot command paths; cache or precompute where practical.
- Keep component custom IDs compact and parseable; use token mapping when IDs would become long or brittle.

## Components V2 Payload Contracts
- Never spread a `buildComponentsV2*` payload and then overwrite `components` in the same object; compose action rows into `mainComponents` before building the V2 payload.
- In payload conversion helpers, short-circuit when the incoming payload is already Components V2 to avoid re-wrapping or shape corruption.
- Preserve native `mainComponents` and `notices` contracts when normalizing non-embed payloads.
- For long content conversion, preserve all split body chunks when appending footer text; do not trim to only the first chunk.

## Security and correctness
- Validate webhook auth before state writes.
- Do not log secrets, auth tokens, or sensitive payload fields.
- Keep /noodle-dev operations gated by admin checks and official-guild checks when configured.
- Handle cross-server user state intentionally; do not assume current guild is the authoritative profile context.
- Preserve discord.js v13-safe fallback behavior in interaction/message paths.
- Design idempotency keys to distinguish legitimate lifecycle updates and renewals (avoid over-deduping by broad event-type keys).
- Keep profile mutation lock keys consistent across related command paths to prevent concurrent lost updates.

## Risk Families
- Add/update tests for all behavior changes, especially command routing, webhooks, cooldowns, reward dedupe, and progression gating.
- Favor focused regression tests for bugs fixed.
- Keep business rules in one place when possible so tests can assert shared behavior.
- Preserve snapshot invariants: if a flow builds a shift/order snapshot, avoid mid-cycle mutations that desync UI, routing, or serve eligibility.
- Treat optional recipe ingredients consistently in cost, coverage, and serveability calculations.
- Add regression tests for payload-contract changes, including V2 conversion short-circuit behavior and long-body/footer chunk transforms.

## Cross-System Matrix
Apply these checks to all future game changes and rollouts:
1. Command/component flows: route ownership, stale selections, custom-id compatibility, fallback parity.
2. Economy/rewards: bounds, caps/floors, rounding, non-negative outcomes, optional-vs-required consistency.
3. Progression/tutorial/unlocks: default/gate parity across code/tests/docs; snapshot invalidation risk.
4. Webhooks/entitlements/providers: replay-safe idempotency and safe payload classification.
5. Jobs/schedulers/catch-up: monotonic windows, bounded loops, no double-processing.
6. Persistence/migrations/concurrency: consistent lock keys and backward-compatible state evolution.
7. Content/config/live-ops rollout: schema compatibility and synchronized feature flags/docs/checklists.
8. Observability/incident response: preserve severity signal and coherent telemetry issue emission.

## Runtime Compatibility
- For Discord channel type checks, support both numeric and string forms where runtime/version differences are possible (for example, voice channel type detection).

## Efficient Coder Review Discipline
- Before editing shared helpers, review helper contracts and all known callsites.
- After return-shape changes in shared helpers, perform a full callsite sweep for overwrite or mismatch anti-patterns.
- Run duplicate anti-pattern scans before finalizing high-risk payload/routing edits.
- Add targeted regression tests alongside changed contracts in the same PR.

## PR Auditor Review Discipline
- Verify helper and callsite contract invariants for any shared helper touched.
- Validate runtime compatibility assumptions (version/coercion-sensitive checks).
- Check for dead or unused code in hot paths touched by the change.
- Map each high-risk behavior change to concrete test or guard evidence in review notes.

## Repo Anchors
- If new NOODLE_ env vars are added in code, update docs/ENVIRONMENT.md and README.md in the same PR.

## Validation
- Before final handoff, run the strongest practical validation set:
  - npm run lint
  - npm test
  - npm run review:guard
- For broad/release changes, prefer npm run review:all.
- If any checks are skipped, explain exactly why and identify residual risk.
