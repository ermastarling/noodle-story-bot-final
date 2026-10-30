# Change Plan Template (Required)

Use this template for every planned change in this repository.

Goal: track implementation live while preserving behavior, security gates, idempotency, and rollout safety.

Operating rules:
- This tracked document is the source of truth for this rollout.
- Do not invent behavior.
- Keep patches focused; no unrelated refactors.
- Reuse existing helpers/constants before adding new logic.
- Preserve scope, auth, and compatibility gates.
- Update this file live as work progresses.
- Use this template execution style.

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
4. Do not start dependent work until its prerequisite track exit criteria are [x]. Independent tracks may proceed in parallel when file ownership and dependencies are clear; each track must pass its own targeted checks before the shared integration gate.

## Plan Metadata

- Title: Official-server automation and player game improvements
- Branch: Not set
- PR: Not set
- Owner: Not set
- Start date: 2026-10-21 (rollout implementation started)
- Target merge date: Not set
- Scope summary: Implement official-server telemetry routing, giveaways, work pings, scheduled/editable game updates, season-boundary updates, counting rewards and broken-count recovery, daily order-board menus, achievements and customizable badges, tutorial-only reset safety, latest-schema migrations, fair shared-order contribution limits, and final performance/risk reviews. Track every implementation change as player-visible or internal-only, review all player-facing wording with the user before committing that copy, and prepare the comprehensive player update as the first post for these changes after completion.
- Non-goals summary: No unrelated refactors, no unrequested gameplay rebalance, no automated VALOR fulfillment, no per-player bot code versions, and no feature-related player announcements before the comprehensive release update.

## Pre-Implementation Checklist

- [ ] Security/auth gates preserved.
- [ ] Idempotency keys and retry semantics remain valid.
- [ ] Routing/state invariants preserved, including snapshot-driven flows.
- [ ] Fallback paths preserve severity/signal and valid scope.
- [ ] Docs/runtime parity maintained for changed defaults/contracts.

## Phase 0 - Baseline Safety and Inventory

Status: in progress; the user-approved copy is recorded, while backup/recovery readiness, deployment prerequisites, live canary checks, and a representative telemetry baseline remain open.

- [x] Capture baseline test/quality snapshot:
  - lint status
  - targeted tests for touched systems
- [x] Generate current risk inventory for the initial safety slice: tutorial reset currently clears order-board state; shared-order contribution currently checks ingredient slots but not per-member total units; profile persistence has schema-version and global-profile repair paths requiring separate audit before migration changes.
- [x] Freeze banned patterns for this change, if applicable; baseline `npm run review:guard` passed.
- [x] Confirm migration/fix order and highest-risk areas first: tutorial-only reset and profile/schema safety first, then shared-order fairness, then server automation and player menu/achievement features.
- [!] Establish baseline telemetry windows and verify which latency, error, and scheduler signals are actually emitted; record sample counts and data-quality limitations. The expected `noodle-logs/telemetry.log` is absent in this workspace, so no measured baseline can be reported yet.
- [ ] Establish data backup and recovery approach before profile migration rollout.
- [x] Define a durable change ledger with explicit player-visible/internal-only classification so no user-facing change is missed or mixed with internal work.
- [x] Inventory every player-facing message or text change, including pings, errors, reward notices, achievement notices, update posts, and counting-channel reactions/messages; capture exact proposed wording, context, audience, and approval status in `docs/PLAYER_COPY_REVIEW.md`.
- [x] Record approved shared-order, counting, work-ping, giveaway, daily-menu, achievement, and season/update copy in `docs/PLAYER_COPY_REVIEW.md`; the user explicitly reviewed and approved the edited packet. The copy may be committed, but automation remains disabled pending operational release gates.
- [x] Include gardening and broth-simmering achievements, production role mentions in work pings and season changes, event timestamps and both event descriptions, and Giveaway/Season scene banners as titles.
- [x] Assemble one batched copy-review packet, grouped by feature, with exact wording/reactions, audience, trigger/context, and comparison to existing bot messaging. The approved packet is the source of truth for player-facing copy; continue to gate production activation on canary and release checks.
- [ ] Confirm operational prerequisites before integration work: official guild/channel/role identifiers, bot permissions and intents, required environment settings, and who supplies each value. Keep identifiers configurable; do not hardcode deployment-specific values.
- [ ] Define disabled-by-default rollout flags, canary order, success/stop criteria, and rollback steps for player-facing automation and profile-data changes before enabling them in production.
- [ ] Route first messages from each new player-facing feature to the existing bot join/leave alert channel as the private canary destination. Verify only the user and bot can view it; if it is not private, stop and resolve access before sending canary messages.
- [ ] Keep normal production feature-channel routing disabled throughout the canary. Promote each feature to its normal configured destination only after canary review and explicit user approval. Ensure test messages do not grant rewards, trigger public mentions, or create irreversible player-visible side effects.
- [x] Maintain a decision register for unresolved behavior/content choices, recording the question, options, owner, needed-by phase, decision, and status.
- [x] Add a shared production announcements-role gate for giveaways and game updates, move Achievements to the social stats menu, align its container controls/footer/banner slot, add the order-board Menu entry point, and document the visible menu/message layouts. The achievement image asset remains pending user upload.

### Decision Register

- [x] Game-update editing and scheduling; owner: user; needed before implementation. Decision: edit a content/config file and use an admin command to preview and schedule updates.
- [x] Counting reaction style; owner: user; needed before implementation. Decision: use existing server custom-emoji conventions and emoji assets already used by the bot; show the exact appearance in the copy-review packet.
- [x] Malformed, non-integer, and bot-authored counting submissions; owner: user; needed before implementation. Decision: delete malformed human submissions and other bot/webhook submissions in the counting channel; serialize count handling in Discord event order; never delete this bot's own reactions, reset notices, or reward messages.
- [x] Wrong integer in counting channel; owner: user; needed before implementation. Decision: reset expected count to 1, post a reset notice, and use the distinct broken-sequence reaction. Do not treat it as malformed-message deletion.
- [x] Consecutive turn by the same user; owner: user; needed before implementation. Decision: do not advance or reset the sequence; use a distinct repeat-user reaction.
- [x] Counting milestone measurement and repeat policy; owner: user/maintainer; needed before reward implementation. Decision: the milestone is the consecutive sequence number; reward the user who submits it once per milestone per channel, even if the sequence later resets. This pragmatic default was applied because the user was unavailable to answer the clarification.
- [x] Reward and achievement configuration approach; owner: user/maintainer; needed before content is finalized. Decision: keep values editable/config-driven, propose conservative defaults for review, and require user approval before enabling or publishing. Exact values remain for content review.
- [x] Achievement and badge menu refinements; owner: user; needed before implementation. Decision: highlight both Stats and Achievements entry buttons in green whenever achievement rewards are claimable, using the existing green-button availability convention; replace the Night Owl secret achievement with one hidden achievement for unlocking each hidden specialization; change blessing-achievement copy from "visitor(s)" to "another chef"/"other chefs". Add a Customize-only Badges menu with no slash-command entry, placeholder art for every collection and achievement badge, and three display rows (badges, achievements, collections), each equipping at most seven. Players can choose which earned badges to display and see each row's seven-badge capacity. Show collection and achievement badge art to the left of the corresponding items in their own menus. Split achievements into Claimed and In Progress views selected by buttons on their own row above the page-navigation buttons. Document the Badges menu layout in `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md` when implementation is ready.
- [~] Giveaway entry mechanism; owner: user/maintainer; needed before giveaway implementation. User was unavailable to answer; pragmatic choice: use an Enter button on the giveaway post because it avoids privileged reaction intents and keeps entry attached to the scheduled contest. Revisit if the user prefers another flow.
- [~] Daily-menu picker visibility; owner: user; needed before production activation. The existing component-response helper delivers the picker publicly even when the command marks it ephemeral; pragmatic default is to preserve the takeout-menu pattern requested, but explicitly verify and obtain approval for public visibility before activation.
- [x] Production channel/role identifiers and permissions; owner: user/maintainer; needed before deployment. Decision: use environment-configured identifiers and verify permissions; user will provide deployment-specific IDs during setup.
- [x] Canary routing and promotion; owner: user; needed before deployment. Decision: route first messages from each new feature to the channel currently configured for bot join/leave alerts; verify visibility is restricted to the user and bot; keep normal feature channels disabled until the user reviews and explicitly approves promotion.
- [x] Feature flags and rollback; owner: user/maintainer; needed before deployment. Decision: keep automations disabled by default, promote only after a successful private canary and user approval, and retain documented disable/rollback steps. Record exact operational thresholds before deployment.
- [x] Copy approval and internal commits; owner: user; needed before implementation. Decision: internal-only implementation commits may precede copy approval, but no unapproved player-facing copy may be committed and no player-facing behavior may be enabled. User approval is required before committing player-facing copy and before production activation after canary.

## Phase 1 - Core Implementation

Independent tracks may run in parallel after Phase 0, subject to non-overlapping file ownership and shared-helper coordination. Each track must meet its own exit criteria; the phase integration gate requires all tracks and combined regression checks to pass.

- Track 1 - Tutorial and profile safety:
  - [x] Fix `/noodle-dev reset_tutorial` to reset only tutorial state to step one; preserve all other player state and add a regression test for the reported rollback case.
  - [~] Audit profile loading and canonicalization; migrate only profiles with an older schema using ordered, idempotent transactional migrations, preserve newer data, and prevent stale snapshots from overwriting stronger progress. Schema writes are monotonic; malformed stored JSON now fails closed instead of appearing as a missing profile.
  - [ ] Back up before migration rollout and test legacy profile migration plus recovery/rollback behavior.
- Track 2 - Shared-order fairness:
  - [x] Enforce shared-order contribution caps: `floor(total required ingredient units / active party member count)` per active member across ingredient types; return a private cozy explanation when the cap is exceeded.

Verification for this phase:
- [ ] Lint and run targeted tests for each track before merging their changes.
- [ ] Run at least one regression suite tied to the changed contract.
- [ ] Confirm reset preserves non-tutorial fields and migrations preserve legacy and latest profile data.
- [ ] Run combined regression checks after both tracks are integrated.

## Phase 2 - Secondary Modules / Callsite Sweep

Independent tracks may run in parallel after their prerequisites and copy approvals are complete. Each track must meet its own exit criteria; the shared integration gate requires routing, permissions, restart, and cross-feature checks.

- Track 1 - Giveaway and work-ping automation:
  - [x] Configure dedicated official-server channels/roles through environment settings for telemetry alerts, giveaways, work pings, game updates, and counting. V2 telemetry report routing now requires its dedicated channel ID and refuses to fall back to the dev alert channel.
  - [~] Implement weekly giveaways: Wednesday 21:00 UTC, uniformly select 1–3 contests, keep each open seven days, make prize pools richer with fewer contests, and prevent a user from winning more than once in that week. Scheduler, persistent entry/win records, approved tiered prizes, and locking are wired; live setup remains.
  - [~] Support editable giveaway pools: coin prizes from 5,000c to 50,000c in 5,000c increments; the three existing coin packs; seven-day Take-Out Counter Premium and/or 24/7 House perks; and VALOR-only prizes of 100–500 in 50-point increments. Approved tiered pools exist; scheduling, entries, and fulfillment remain gated by operational setup.
  - [~] Automatically grant eligible in-game giveaway rewards and post a winner-tagged confirmation for every giveaway using the existing dev-only giveaway winner wording/banner. For VALOR, tag the winner and Erma and state that Erma will fulfill it within 48 hours; after Erma sends it, the configured fulfiller can post a second one-time winner-tagged "reward sent" confirmation. User-approved copy is wired; live validation remains.
  - [x] Implement restart-safe work ping at exactly 00:00, 02:00, 04:00, 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, and 22:00 UTC, with no startup/catch-up post. It updates/replaces the prior ping and tags the configured role. The scheduler uses a UTC cron expression, recurring stale-delivery recovery, atomic claims, and explicit admin reconciliation for uncertain delivery. Discord permissions and recovery need canary validation.
- Track 2 - Game and season updates:
  - [~] Implement game updates using an editable content/config file and an admin command to preview and schedule them. `content/game-updates.md` is the editable source; `/noodle-dev admin game_update_preview` and `/noodle-dev admin game_update_schedule` validate route approval and store an immutable content snapshot. Each manual update still requires authoring, private preview, and scheduling.
  - [~] Implement automatic season-boundary and event-change container updates with new-season information and special-event recipes. The user-approved format includes the event tagline, timestamp range, event description, rewards, recipes, and production role mention; transitions are persisted while delivery is gated.
  - [x] Hold scheduled feature-related updates and automated season/event notices until a comprehensive first player update is sent to production. Mark the configured first update with `rollout_summary: true`; private canary previews remain queued for production and do not release queued notices. Public release-state persistence is atomic with delivery completion. Independent existing notices are unchanged.
- Track 3 - Counting and milestone rewards:
  - [x] Implement counting-channel validation for the next consecutive integer and require a different user per successful turn. React to every valid number using existing server custom-emoji conventions; reject a consecutive turn by the same user without resetting the count and use its distinct reaction; when an incorrect integer breaks the sequence, reset the expected count to 1, post a reset notice, and use a separate broken-sequence reaction. Delete malformed human submissions and other bots'/webhooks' submissions; never delete this bot's own output. Serialize count handling in Discord event order. Runtime and copy are implemented and user-approved; production canary remains a rollout gate.
  - [~] Implement configurable counting milestone rewards including eligible recipe clues; make reward notices consistent with the approved player-facing copy. Runtime code supports coins, REP, SXP, eligible recipe clues, an idempotent persisted ledger, pending-grant recovery, and durable notice retries; user-approved values/copy are recorded, while production activation awaits release approval.
- Shared integration:
  - [~] Sweep interaction routing, Discord permissions, channel/role targeting, retries, and restart behavior for each new flow. Work pings, giveaway posts/previews/confirmations, and scheduled updates use durable send-intent states, recurring stale-state recovery, and `/noodle-dev admin delivery_reconcile`; uncertain sends still require an operator to verify Discord before marking delivered or requeueing. Live Discord checks remain.

Verification for this phase:
- [x] Lint and run targeted tests for each track before integration; current full review is recorded below.
- [x] Run routing/fallback configuration tests for canary and production validation paths; live Discord smoke checks remain.
- [ ] Verify every giveaway type sends the correct public winner confirmation and VALOR notice.
- [ ] Verify valid counts advance with the success reaction, same-user turns do not advance or reset the sequence and use the repeat-user reaction, and incorrect integers reset the sequence to 1 with the reset message and broken-sequence reaction.
- [ ] Verify malformed/non-integer posts and other bot/webhook posts are deleted as decided; this bot's own messages remain; concurrent submissions serialize correctly; restart/replay handling cannot advance the count incorrectly.
- [ ] Verify announcement gates suppress feature-related updates during implementation without suppressing independent existing notices.
- [ ] Verify configured production permissions and rollback behavior.
- [ ] Verify the first messages from each new feature are visible only in the private join/leave-alert canary channel, normal destinations remain disabled until explicit user approval, and promotion/rollback routing behaves as documented.

## Phase 3 - Shared Utility Cleanup

The daily menu and achievements are independent tracks and may be implemented in parallel when file ownership permits. Shared cleanup and integration checks follow both tracks.

- Track 1 - Daily order-board menu:
  - [x] Implement a daily order-board menu picker reusing takeout-menu patterns. Menu selections are exclusive; users may change the menu once per day; a successful change immediately refreshes unaccepted board orders and preserves accepted orders. Cross-page selections stay in a temporary draft until explicit Save; Cancel clears the draft without using the daily change. The picker uses a Components V2 container with a dedicated future banner key.
- Track 2 - Achievements:
  - [x] Implement achievements beside Collections for NPCs, money, recipes, bowls served, secret achievements, fishing/foraging, market, shared orders, blessings, tipped coins, first tip received/given, quest types, daily streaks, gardening, and broth simmering. Definitions and forward progression metrics are present; copy is user-approved and live validation remains.
  - [x] Paginate the achievements menu at 10 entries per page, with page navigation and a page count; keep reward claims scoped to the displayed page.
  - [x] Keep achievement definitions, thresholds, and rewards in editable content; keep secret achievements hidden until unlocked.
  - [x] Add individual achievement reward claiming in the achievements container menu and notice cards for newly unlocked achievements. Command/menu, guarded one-time claims, and evaluation on command persistence are wired.
  - [x] Perform one-time retroactive evaluation of existing players; leave earned rewards claimable and send one shortened notice pointing to the achievements menu. Lazy first-evaluation detection and one-summary notice are wired; only existing persisted evidence is used, not fabricated history.
- Track 3 - Achievement views and badge customization:
  - [x] Turn both Stats and Achievements entry buttons green whenever the player has achievement rewards available to claim, following the existing green-button state pattern; return them to their normal state when no current unclaimed reward is available.
  - [x] Remove the Night Owl secret achievement and add a hidden achievement for unlocking each hidden specialization. Keep each unlock achievement hidden until that specialization is unlocked.
  - [x] Reword blessing achievements to use "another chef" or "other chefs" in place of "visitor(s)" while preserving their existing meaning and progression requirements.
  - [x] Add placeholder badge art for every collection and every achievement. Display the corresponding badge on the left of each collection item in Collections and each achievement item in Achievements.
  - [x] Add a Badges menu reachable only from Customize; do not add a slash command or another entry point. Let players choose which eligible badges appear on their profile across three rows—Badges, Achievements, and Collections—with a maximum of seven equipped per row and a visible capacity/count so players know how many they can equip.
  - [x] Add Claimed and In Progress category controls to the Achievements menu. Place the category buttons together in their own row above the existing page-navigation buttons, and show the matching achievements for the selected category.
  - [x] Add the complete Badges and revised Achievements layouts to `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, including entry paths, placeholder artwork, row capacity, selection controls, and navigation.
- Shared cleanup and integration:
  - [ ] Remove dead helper paths introduced by implementation and narrow exports to active runtime APIs.
  - [ ] Sweep callsites for compatibility and stale-state risks.

Verification for this phase:
- [x] Lint utility files (full repository lint passed with 0 errors and 3 existing unused-argument warnings).
- [x] Re-run contract and integration tests.
- [x] Verify daily menu edits preserve accepted order snapshots and enforce the daily limit.
- [x] Verify achievements are deduplicated, secret achievements stay hidden until unlocked, retroactive claims are safe, and reward claims cannot duplicate.
- [x] Verify the combined menu/achievement changes pass cross-feature and persistence regressions.

## Phase 4 - Guardrails and Regression Net

Status: in progress; focused regression coverage and user copy approval are recorded, while release documentation, final change-ledger review, and operational gates remain open.

- [x] Add/adjust guard checks for banned patterns or risky anti-patterns; existing pre-review guard passes.
- [ ] Add tests for metadata retention and commit routing invariants.
- [ ] Add tests ensuring prebuilt payloads/contracts are preserved.
- [x] Add focused tests for migration recovery fixtures, stale-profile protection, tutorial-only reset, shared-order contribution caps, giveaway draw/payout idempotency, work-ping restart safety, announcement gating, counting milestones, daily menu refresh, and achievement retroactive claims.
- [~] Maintain the change ledger after every code change with file(s), classification, behavior impact, verification command/result, and next step.
- [x] Maintain a player-facing copy inventory with exact wording, context, audience, and user approval status; approval is recorded, while production activation remains a release gate.
- [x] Use one batched review packet to collect copy feedback early and avoid serial approval delays; the user-edited final inventory is approved and may be committed.
- [x] Update `docs/ENVIRONMENT.md`, `README.md`, and relevant configuration/content documentation while keeping internal-only changes out of player-facing copy; release notes remain pending.

Verification for this phase:
- [x] Run lint + guard scripts.
- [x] Run targeted tests added in this phase.
- [ ] Review the change ledger against the final diff to ensure every player-visible change is captured and internal changes are not presented as player features.

## Phase 5 - Final Validation and Release Readiness

Operator references: [rollout environment variables](FEATURE_ROLLOUT_ENVIRONMENT.md) and [changed menu layouts](FEATURE_ROLLOUT_MENU_LAYOUTS.md).

Status: not release-ready; user copy approval and repository validation are recorded, but operational and measured-health gates below remain open.

- [x] Full test suite passes for the current implementation (`npm run review:all`: 545 passed, 0 failed).
- [x] Lint passes at project baseline or better (0 errors; 3 existing unused-argument warnings).
- [x] Residual scan for banned patterns is clean, if applicable (`npm run review:guard` passed).
- [ ] Manual canary checks pass for user-critical flows, if applicable.
- [ ] PR notes include behavior-parity and validation evidence.
- [ ] Compare before/after latency and errors using measured p50/p95, sample counts, comparable time windows, scheduler/job failures, and data-quality caveats.
- [ ] Validate telemetry report calculations against raw observed events and explain metrics in operator-friendly language; do not claim bot health beyond what collected data supports.
- [x] Complete an interim risk assessment for every planned change covering performance/load, data integrity and migration recovery, idempotency/restarts, abuse/fairness, Discord permissions/routing, announcement timing/content, rollback mitigations, and residual risks. Production readiness remains unassessed until live evidence is available.
- [x] Record the user's explicit approval of the edited player-copy packet, including gardening/broth achievements, work-ping and season roles, season timestamps and both event descriptions, and Giveaway/Season banner titles. This does not waive canary or production-release gates.
- [ ] Prepare the comprehensive player-facing update in existing news content from verified player-visible changes only; make this the first bot update for these changes after implementation is complete.
- [x] Make work pings and bot-authored counting reset/reward notices use Components V2 containers; count entries written by players remain plain numeric messages.
- [x] Send scheduled game updates and season/event notices as Components V2 containers and reject non-container payloads in the shared send path.
- [x] Improve telemetry report interpretation, data-quality disclosures, and measured recommendations; explicitly scope reports to instrumented V2 interactions rather than overall bot health.
- [~] Expand reports to measured bot-wide interaction outcomes, instrumented scheduled-job outcomes, gateway lifecycle events, and observed process starts. Never infer continuous uptime, downtime, or Discord availability from application telemetry; disclose incomplete coverage and alert on observed failures.

## File Scope Checklist

- [x] Add this tracked plan at `docs/FEATURE_ROLLOUT_PLAN.md` as the source of truth; update it as work progresses.
- [x] Record actual implementation file scope and mark implementation complete; operational release gates remain separate below.
- [x] Initial implemented scope: `src/game/tutorial.js`, `src/db/index.js`, `src/game/social.js`, `src/commands/noodleSocial.js`, `src/index.js`, `test/tutorial-reset.test.js`, `test/db-player-schema.test.js`, and `test/social.test.js`.
- [x] Counting implementation scope: `src/game/counting.js`, `src/db/schema.sql`, `src/index.js`, `test/counting.test.js`, `docs/ENVIRONMENT.md`.
- [x] Additional actual scope: `README.md`, `docs/ENVIRONMENT.md`, `docs/PLAYER_COPY_REVIEW.md`, `src/commands/noodle.js`, `src/commands/noodleDev.js`, `src/commands/noodleSocial.js`, `src/content/index.js`, `src/db/index.js`, `src/db/migrations.js`, `src/db/schema.sql`, `src/game/achievements.js`, `src/game/counting.js`, `src/game/countingRewards.js`, `src/game/dailyMenu.js`, `src/game/events.js`, `src/game/giveaways.js`, `src/game/orders.js`, `src/game/player.js`, `src/game/quests.js`, `src/game/social.js`, `src/game/storeCoinPacks.js`, `src/index.js`, `src/jobs/eventSync.js`, `src/jobs/gameUpdates.js`, `src/jobs/scheduledDelivery.js`, `src/jobs/v2TelemetryAlerts.js`, `src/jobs/weeklyGiveaways.js`, `src/jobs/workPings.js`, `content/achievements.json`, `content/counting.rewards.json`, `content/game-updates.md`, `content/giveaways.json`, `content/work-ping.json`, `test/achievements.test.js`, `test/counting-rewards.test.js`, `test/counting.test.js`, `test/daily-menu.test.js`, `test/db-backup-recovery.test.js`, `test/db-migrations.test.js`, `test/db-player-schema.test.js`, `test/game-updates.test.js`, `test/giveaways.test.js`, `test/noodle-dev-admin.test.js`, `test/scheduled-delivery.test.js`, `test/social.test.js`, `test/v2-telemetry-report.test.js`, `test/tutorial-reset.test.js`, and `test/work-pings.test.js`.
- [x] Confirmed actual implementation scope against the worktree; no unrelated file changes were added by the final documentation audit.
- [x] Latest continuation also touches `src/infra/telemetry.js`, `src/infra/v2TelemetryReport.js`, `src/jobs/v2TelemetryAlerts.js`, `src/jobs/workPings.js`, `src/game/counting.js`, `src/ui/countingNotices.js`, `src/index.js`, and focused counting/work-ping/telemetry tests.

## Change Log (update after every code change)

- [ ] Entry template:
  - Timestamp:
  - File(s):
  - Checklist item(s) updated:
  - Behavior impact statement: "No gameplay behavior change" or explicit exception.
  - Player-facing or internal-only classification:
  - Player-facing copy approval status, if applicable:
  - Verification run:
  - Result:
  - Next step:
- [x] 2026-10-21
  - File(s): `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Created tracked source-of-truth plan and recorded agreed feature scope, sequencing, decision register, copy-approval requirements, private canary routing, risk controls, and validation gates.
  - Behavior impact statement: No gameplay behavior change; documentation only.
  - Player-facing or internal-only classification: Internal planning documentation; no player-facing copy added.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: Compared the tracked document against the active plan and confirmed it contains the latest canary and decision updates; documentation-only change, no test suite run.
  - Result: Plan is tracked in the repository and ready for live progress updates.
  - Next step: Update this document after each implementation change; obtain user approval before committing player-facing copy and before production promotion from private canary to normal channels.
- [x] Internal-only tutorial reset fix completed; player-facing copy was not changed.
- [x] Internal-only profile persistence schema-version monotonicity fix completed; broader stale-snapshot migration audit remains open.
- [x] Profile loads reject malformed or empty persisted JSON instead of allowing `ensurePlayer` to treat a corrupt row as a new player; focused regression tests passed.
- [x] Shared-order fair-cap enforcement and atomic contribution/inventory persistence are complete; player-facing error wording is draft pending user review before any commit. A regression assertion confirms rejected over-cap contributions roll back inventory deduction.
- [x] 2026-10-21
  - File(s): `src/game/tutorial.js`, `test/tutorial-reset.test.js`
  - Checklist item(s) updated: Tutorial reset now initializes only the first tutorial step; regression test compares the entire non-tutorial profile before and after reset.
  - Behavior impact statement: Explicit behavior correction: reset tutorial no longer clears order-board or accepted-order data; all other profile fields are preserved.
  - Player-facing or internal-only classification: Internal-only logic and regression test; no player-facing wording changed.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: `node --test test/tutorial-reset.test.js` passed (2/2); `npx eslint src/game/tutorial.js test/tutorial-reset.test.js` passed; `git -c core.whitespace=cr-at-eol diff --check` passed.
  - Result: Reset starts at `intro_order`; regression test confirms every non-tutorial profile field, including accepted orders and order-board state, is unchanged.
  - Next step: Continue the profile/schema safety audit; back up/recovery design and broader player-facing feature copy review remain pending before those dependent changes.
- [x] 2026-10-21
  - File(s): `src/db/index.js`, `test/db-player-schema.test.js`
  - Checklist item(s) updated: Existing profile writes now keep the stored and serialized schema version monotonic, preventing a stale caller-provided version from downgrading a newer profile version.
  - Behavior impact statement: Internal persistence safeguard; no player-facing wording or gameplay behavior changed.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: `node --test test/db-player-schema.test.js test/tutorial-reset.test.js` passed (3/3); `npx eslint src/db/index.js src/game/tutorial.js test/db-player-schema.test.js test/tutorial-reset.test.js` passed; `git -c core.whitespace=cr-at-eol diff --check` passed.
  - Result: A stored schema version of 5 remains 5 after an older version-1 snapshot is saved; serialized JSON and the row metadata stay aligned.
  - Next step: Continue auditing stale-snapshot protection and migration backup/recovery before any migration rollout.
- [~] 2026-10-21
  - File(s): `src/db/index.js`, `test/db-player-schema.test.js`
  - Checklist item(s) updated: Strict profile reads now fail with a typed error on malformed, empty, or missing stored JSON, preventing invalid data from being interpreted as an absent profile and overwritten by a fresh profile.
  - Behavior impact statement: Internal data-integrity safeguard; malformed or empty existing profiles now produce an explicit failure rather than silently resetting.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: `node --test test/db-player-schema.test.js test/tutorial-reset.test.js` passed (4/4); `npx eslint src/db/index.js test/db-player-schema.test.js` passed.
  - Result: Regression test simulates pre-existing corrupt rows by dropping JSON-expression indexes that otherwise reject malformed data at insert time; canonical reads now fail explicitly and leave the persisted row unchanged.
  - Next step: Continue migration safety and profile snapshot audit.
- [x] 2026-10-21
  - File(s): `src/game/social.js`, `src/commands/noodleSocial.js`, `test/social.test.js`
  - Checklist item(s) updated: Enforced the per-member total-unit cap across ingredient types, computed as the floor of total required order units divided by active party members; wrapped contribution accounting and inventory persistence in one SQLite transaction.
  - Behavior impact statement: Gameplay fairness correction; contributions above the equal per-member cap are rejected without persisting the inventory deduction.
  - Player-facing or internal-only classification: Player-facing behavior; the private error copy is a draft and requires user approval before commit.
  - Player-facing copy approval status, if applicable: Pending user review; exact proposed wording is in the Phase 0 copy inventory.
  - Verification run: `node --test test/social.test.js test/db-player-schema.test.js test/tutorial-reset.test.js` passed (27/27), including the SQLite transaction rollback assertion; focused ESLint passed with one pre-existing unused-argument warning in `src/commands/noodleSocial.js`; `git -c core.whitespace=cr-at-eol diff --check` passed.
  - Result: Per-member cap applies across ingredient types; rejected over-cap contributions do not persist the ingredient deduction or contribution row.
  - Next step: Keep this change uncommitted until the full player-copy review is complete; continue remaining rollout work.
- [x] 2026-10-21
  - File(s): `src/index.js`, `docs/ENVIRONMENT.md`, `README.md`
  - Checklist item(s) updated: V2 telemetry alerts use a dedicated configured channel distinct from the general dev alert channel; missing or duplicate channel configuration prevents the telemetry scheduler from starting and reports the issue to logs.
  - Behavior impact statement: Internal operator-alert routing change; no player-facing behavior or copy changed.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: `node --test test/v2-telemetry-report.test.js test/social.test.js test/db-player-schema.test.js test/tutorial-reset.test.js` passed; syntax check and focused ESLint passed with two pre-existing unused-argument warnings; CRLF-aware diff check passed.
  - Result: Dedicated telemetry routing is validated for missing, shared, and separate alert channel IDs; no fallback can route telemetry back to the general dev alert channel.
  - Next step: Proceed with server automation tracks; production channel IDs and access checks remain deployment prerequisites.
- [x] 2026-10-21
  - File(s): `src/jobs/v2TelemetryAlerts.js`, `src/index.js`, `test/v2-telemetry-report.test.js`
  - Checklist item(s) updated: Added tested validation for the dedicated telemetry channel setting and wired the scheduler to the validated separate target.
  - Behavior impact statement: Internal operator-alert routing only; no player-facing behavior or copy changed.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: `node --test test/v2-telemetry-report.test.js test/social.test.js test/db-player-schema.test.js test/tutorial-reset.test.js` passed (34/34); `node --check src/index.js` and focused ESLint passed with two pre-existing unused-argument warnings; CRLF-aware diff check passed.
  - Result: Missing or shared channel IDs fail closed; a distinct configured telemetry channel is the only scheduled report destination.
  - Next step: Configure and verify the real channel ID during deployment; complete telemetry health/latency review only after telemetry data is available.
- [x] 2026-10-21
  - File(s): Current changed scope.
  - Checklist item(s) updated: Broad validation after the first implementation slices.
  - Behavior impact statement: No additional behavior change; verification only.
  - Player-facing or internal-only classification: Internal-only validation.
  - Player-facing copy approval status, if applicable: Shared-order error wording remains pending; no commit was created.
  - Verification run: `npm run review:all` passed; 483 tests passed, 0 failed; lint reported 3 existing warnings and 0 errors; review guard passed.
  - Result: Current implementation changes pass the repository's full standard validation suite.
  - Next step: Continue rollout; keep commits containing player-facing copy blocked until the consolidated copy packet is approved.
- [~] 2026-10-21
  - File(s): `src/game/counting.js`, `src/db/schema.sql`, `test/counting.test.js`
  - Checklist item(s) updated: Added persisted counting state, strict positive integer parsing, duplicate-message protection, same-user rejection without reset, wrong-integer reset behavior, and deletion of malformed/other-bot posts while ignoring this bot's own messages.
  - Behavior impact statement: New feature implementation, disabled until explicit channel, intent, and canary configuration are provided.
  - Player-facing or internal-only classification: Player-facing feature behavior; exact reset wording is draft and must be approved before commit/activation.
  - Player-facing copy approval status, if applicable: Pending; draft reset copy is in the copy inventory.
  - Verification run: `node --test test/counting.test.js test/v2-telemetry-report.test.js test/social.test.js test/db-player-schema.test.js test/tutorial-reset.test.js` passed (39/39); `node --check src/index.js` and focused ESLint passed with two pre-existing warnings; CRLF-aware diff check passed.
  - Result: Counting is wired behind disabled-by-default settings, requires message-content intent, routes the canary to the designated dev alert channel only after private-channel attestation, serializes processing, persists state, ignores duplicate events, and uses existing custom icons for the three outcomes.
  - Next step: Add counting rewards and user-reviewed copy; perform an integrated runtime canary only after environment values, bot permissions, custom emoji accessibility, and private-channel access are verified.
- [~] 2026-10-21
  - File(s): `src/game/counting.js`, `src/index.js`, `test/counting.test.js`
  - Checklist item(s) updated: Consolidated counting configuration parsing; the feature remains disabled unless explicitly enabled, and runtime routing now requires guild, channel, message-content intent, and private-canary attestation or an explicitly selected production channel.
  - Behavior impact statement: Internal runtime safety fix for new counting feature wiring; no channel processing occurs with missing/invalid settings.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Counting reset draft remains pending user review and cannot be activated without a verified canary configuration.
  - Verification run: `node --test test/counting.test.js` passed (6/6); `node --check src/index.js` passed; focused ESLint passed with one pre-existing unused-argument warning; CRLF-aware diff check passed.
  - Result: Added pure configuration resolver and tests; previous inline references had no declarations and could fail at runtime when the message event path evaluated them. Counting stays disabled unless explicitly enabled with the required content intent and approved channel route.
  - Next step: Implement idempotent counting milestone rewards with unapproved notices gated off.
- [~] 2026-10-21
  - File(s): `src/game/counting.js`, `src/game/countingRewards.js`, `src/db/schema.sql`, `src/content/index.js`, `content/counting.rewards.json`
  - Checklist item(s) updated: Added proposed editable milestone rewards for coins, rep, SXP, and eligible unknown-recipe clues; count transitions record eligible rewards in an idempotent pending ledger. Reward values are proposals pending user review and the reward switch defaults off.
  - Behavior impact statement: Internal reward persistence foundation; no reward is granted unless counting is enabled, copy is explicitly approved, and the separate reward flag is enabled. The matching winner notice will still be a user-facing draft.
  - Player-facing or internal-only classification: Mixed: persistence logic is internal; the milestone-earned notice is player-facing draft.
  - Player-facing copy approval status, if applicable: Pending; notice text must be included in consolidated review and cannot be activated before approval.
  - Verification run: `node --test test/counting.test.js test/counting-rewards.test.js` passed (12/12); `node --check src/index.js` passed; focused ESLint passed with one pre-existing unused-argument warning; CRLF-aware diff check passed.
  - Result: Reward application uses an idempotent SQLite ledger and updates player profiles transactionally; pending grants and unsent notices persist for restart recovery. Duplicate/invalid milestone config is rejected, and a clue milestone falls back to coins when no unknown recipe remains.
  - Next step: Keep reward amounts and generated notices behind explicit copy/reward approval, then continue with daily menu and achievement features.
- [~] 2026-10-21
  - File(s): `src/game/dailyMenu.js`, `src/game/orders.js`, `src/game/player.js`, `test/daily-menu.test.js`
  - Checklist item(s) updated: Added the daily-menu profile fields and mutation helper with one-change-per-UTC-day, 1–10 recipe selection, and immediate seed/pool refresh without changing accepted orders or consumed indices; order generation now uses the selected menu when configured.
  - Behavior impact statement: Player-facing gameplay logic is implemented but has no interaction path yet; menu data defaults empty and existing players keep the existing all-learned-recipes order pool until they opt into a menu.
  - Player-facing or internal-only classification: Player-facing gameplay feature; UI wording and menu prompts remain drafts pending review.
  - Player-facing copy approval status, if applicable: Pending; picker labels, selection errors, and confirmation text to be included in the batch copy packet.
  - Verification run: Pending targeted daily menu tests and lint.
  - Result: Core menu state and generation behavior added; Discord slash command, picker, and once-daily user flow are not yet wired.
  - Next step: Verify the model/order tests, then wire the picker into `/noodle`.
- [~] 2026-10-21
  - File(s): `src/commands/noodle.js`
  - Checklist item(s) updated: Reused the existing takeout-menu draft selection cache while namespacing state by menu type so daily-menu picker drafts cannot collide with counter-menu drafts.
  - Behavior impact statement: Internal picker-state change only; existing takeout draft keys now have an explicit default namespace with unchanged behavior.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: Pending focused tests and lint.
  - Result: Cache helper supports a separate daily-menu draft namespace; component and slash-command flow remains to be wired.
  - Next step: Integrate shared picker rendering and the daily-menu subcommand, then run command and model tests.
- [~] 2026-10-21
  - File(s): `src/commands/noodle.js`
  - Checklist item(s) updated: Added `/noodle daily_menu` with a paginated recipe select picker, direct optional recipe-ID input, once-per-UTC-day validation, menu confirmation, and namespaced picker state. On a successful change, daily order generation updates its seed/pool while accepted orders and consumed order indices remain unchanged.
  - Behavior impact statement: New player-facing menu flow; existing players continue using their existing recipe pool until they set a menu. Confirmation, picker, and limit-error wording is draft pending approval.
  - Player-facing or internal-only classification: Player-facing.
  - Player-facing copy approval status, if applicable: Pending consolidated review.
  - Verification run: `node --check src/commands/noodle.js` passed; `node --test test/daily-menu.test.js test/takeout.test.js test/orders.test.js` passed (22/22); focused ESLint passed with one pre-existing unused-argument warning.
  - Result: Slash command, picker routing, and selection enforcement are wired; existing takeout/order regression tests pass.
  - Next step: Implement achievement data model and retroactive evaluation while preserving unclaimed-reward invariants.
- [~] 2026-10-21
  - File(s): `src/game/achievements.js`, `src/content/index.js`, `content/achievements.json`, `test/achievements.test.js`
  - Checklist item(s) updated: Added editable proposed achievements for all requested categories, secret filtering, one-time reward claims, first-use retroactive evaluation, and single shortened retroactive notice.
  - Behavior impact statement: New achievement core logic is not yet wired to player commands; all content labels, thresholds, reward values, and notices are drafts and must be reviewed before production activation.
  - Player-facing or internal-only classification: Player-facing feature; copy and reward values pending review.
  - Player-facing copy approval status, if applicable: Pending.
  - Verification run: `node --test test/achievements.test.js` (4/4 passed); `npx eslint src/game/achievements.js test/achievements.test.js src/content/index.js` (passed); editable JSON parse check (passed).
  - Result: Core achievement definitions/evaluation/claim helpers and tests pass; runtime tracking hooks and user interface remain.
  - Next step: Wire the evaluator into persisted gameplay paths and add missing lifetime counters.
- [~] 2026-10-21
  - File(s): `src/commands/noodle.js`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Added achievements to the Collections navigation, a status/reward menu, per-player claim selection with lock-protected persistence, and achievement evaluation before command state saves.
  - Behavior impact statement: Existing tracked metrics can unlock and show achievements on player command persistence; unseen event metrics still need their mutation hooks. All labels, descriptions, and proposed reward values remain draft copy/content.
  - Player-facing or internal-only classification: Player-facing feature.
  - Player-facing copy approval status, if applicable: Pending user wording/reward review; no commit or production activation.
  - Verification run: Pending command syntax, lint, and focused achievement regression tests.
  - Result: UI and claim route connected; runtime event counter coverage and final validation remain.
  - Next step: Verify routes and implement remaining metric updates at authoritative mutation paths.
- [~] 2026-10-21
  - File(s): `src/game/player.js`, `src/game/achievements.js`, `src/game/quests.js`, `src/game/social.js`, `src/commands/noodle.js`, `src/commands/noodleSocial.js`, `content/achievements.json`, `test/achievements.test.js`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Added default lifetime metrics and forward tracking for forage quantities accepted, successful single and multi market transactions, unique shared-order contributions, quest completion cadence, and blessings given/received; simplified content validation.
  - Behavior impact statement: Achievement metrics are updated only after successful gameplay mutations. Unique shared orders are counted once per player/order. Historical forage, market, blessing, and quest events without stored evidence are not fabricated.
  - Player-facing or internal-only classification: Internal achievement-tracking changes, with existing achievement copy/reward proposals still pending review.
  - Player-facing copy approval status, if applicable: No copy approval for proposed achievements; content remains disabled/unapproved.
  - Verification run: `node --test test/achievements.test.js test/social.test.js test/quests.test.js` (31/31 passed); `node --check` on all touched runtime modules (passed); focused ESLint (0 errors, 2 pre-existing unused-argument warnings); achievement JSON parse and CRLF-aware `git diff --check` (passed).
  - Result: Core counters wired at authoritative mutation paths and focused tests pass; command runner `runTests` did not recognize Node's built-in test files, so direct `node --test` was used.
  - Next step: Continue remaining rollout features and complete cross-feature/full-suite validation.
- [~] 2026-10-21
  - File(s): `src/jobs/workPings.js`, `src/index.js`, `src/db/schema.sql`, `src/content/index.js`, `content/work-ping.json`, `test/work-pings.test.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Added restart-persisted work-ping replacement, immediate startup post plus every-two-hour UTC schedule, private-canary routing without role mentions, and separate production/copy-approval gates.
  - Behavior impact statement: Scheduler remains disabled unless explicitly enabled and copy-approved. First posts default to the attested private dev-alert channel; production requires separate opt-in, destination, role, and work channel configuration. Both configured channels are verified against the configured official guild before sending.
  - Player-facing or internal-only classification: Player-facing automation; the message in `content/work-ping.json` is an unapproved draft.
  - Player-facing copy approval status, if applicable: Pending.
  - Verification run: `node --test test/work-pings.test.js test/achievements.test.js test/social.test.js test/quests.test.js` (34/34 passed); syntax checks (passed); focused ESLint (0 errors, 3 pre-existing warnings); `git -c core.whitespace=cr-at-eol diff --check` (passed).
  - Result: Scheduling, route gates, and official-guild channel checks pass pure/unit validation; live Discord permissions and private-channel canary checks remain.
  - Next step: Add focused scheduler tests, verify runtime wiring, then proceed to other automations.
- [~] 2026-10-21
  - File(s): `src/game/giveaways.js`, `src/jobs/weeklyGiveaways.js`, `src/content/index.js`, `src/commands/noodle.js`, `src/index.js`, `src/db/schema.sql`, `content/giveaways.json`, `test/giveaways.test.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Recorded the pragmatic button-entry decision; added validated prize pools, Wednesday UTC week windows, uniform one-to-three contest selection, durable contest/entry/win tables, entry button routing, automated coin/pack/perk grants, manual VALOR confirmation, and canary/production gates.
  - Behavior impact statement: Prize and announcement content remains draft. Live lifecycle remains disabled until explicit copy approval and production flags; canary preview is private, non-interactive, and has no reward side effects. Entry recording validates the source post and close time, deduplicates, and enforces one win per user per week. Batch creation, winner selection, and fulfillment are serialized with database locks; retry behavior needs validation.
  - Player-facing or internal-only classification: Player-facing feature and copy drafts.
  - Player-facing copy approval status, if applicable: Pending.
  - Verification run: `node --test test/giveaways.test.js test/work-pings.test.js test/achievements.test.js` (14/14 passed); syntax checks (passed); focused ESLint (0 errors, 2 pre-existing unused-argument warnings); JSON parse and CRLF-aware diff check (passed).
  - Result: Rule/configuration, canary suppression, and entry/duplicate/week-win database paths pass focused tests. Live Discord delivery, payout recovery, and multi-process failure injection remain untested.
  - Next step: Add payout/announcement idempotency validation, then continue remaining automation and risk work.
- [x] 2026-10-21
  - File(s): Current changed scope.
  - Checklist item(s) updated: Full post-counting and profile-corruption regression validation.
  - Behavior impact statement: Verification only; no new runtime behavior.
  - Player-facing or internal-only classification: Internal-only validation.
  - Player-facing copy approval status, if applicable: Shared-order cap and counting reset wording remain drafts; no commit or production activation.
  - Verification run: `npm run review:all` passed; 489 tests passed, 0 failed; lint reported 3 pre-existing warnings and 0 errors; pre-review guard passed. `git -c core.whitespace=cr-at-eol diff --check` passed.
  - Result: Current uncommitted implementation scope passes repository lint, full tests, and review guard.
  - Next step: Continue feature implementation; do not commit or activate player-facing copy until the batched review and canary approvals are complete.
- [x] 2026-10-21
  - File(s): `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Added all giveaway-entry responses omitted from the earlier copy packet, corrected the daily-menu visibility description, recorded current validation, and marked completed code-level checks while preserving outstanding release gates.
  - Behavior impact statement: No gameplay behavior change; documentation and review-status updates only.
  - Player-facing or internal-only classification: Internal review documentation; it catalogs player-facing drafts but does not approve or activate them.
  - Player-facing copy approval status, if applicable: Pending user review; no player-facing copy may be committed or enabled.
  - Verification run: `npm run review:all` (524 passed, 0 failed; lint 0 errors and 3 existing warnings; pre-review guard passed); `npm run check:syntax` passed; all five rollout content JSON files parsed successfully; `git -c core.whitespace=cr-at-eol diff --check` passed. The standalone `git diff --check` reports CRLF as trailing whitespace in the existing tutorial-reset file; the CRLF-aware repository check passes.
  - Result: Automated repository checks pass; Discord delivery/visibility, permissions, production recovery, and measured telemetry health remain unverified. No changes have been committed or deployed.
  - Next step: Await explicit user review/edits of the consolidated copy packet (the review request received no approval or edits); then finish copy approval, private-canary/live operational checks, recovery verification, latency assessment with real telemetry, and the first comprehensive player update before production release.
- [x] 2026-10-21
  - File(s): `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`
  - Checklist item(s) updated: Audited giveaway payout icon copy, daily-menu picker and command text, achievement reward selector labels, documented that the current daily-menu picker is publicly delivered by the shared component response helper, and reconciled the completed implementation file scope.
  - Behavior impact statement: No gameplay behavior change; review documentation only.
  - Player-facing or internal-only classification: Internal review documentation.
  - Player-facing copy approval status, if applicable: All reviewed copy remains a draft; no user approval or edits have been received.
  - Verification run: `node --test test/daily-menu.test.js test/achievements.test.js test/social.test.js` (32 passed, 0 failed); rollout JSON parsing passed; `git -c core.whitespace=cr-at-eol diff --check` passed.
  - Result: Review packet reflects runtime wording/visibility and the tracked plan lists the actual changed scope.
  - Next step: Keep all release gates closed pending explicit copy and daily-menu visibility approval, private-canary/live operational evidence, recovery drill, representative telemetry, and the first comprehensive player update.
- [x] 2026-10-24
  - File(s): Current worktree and `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Re-ran the full pending-change risk audit; rechecked all previously reported issues and added current findings, evidence, release gates, and validation outcomes below.
  - Behavior impact statement: Review and plan documentation only; no implementation changes or production actions.
  - Player-facing or internal-only classification: Internal-only review.
  - Player-facing copy approval status, if applicable: Existing approval does not match the counting reset runtime string; production copy remains blocked until parity is restored.
  - Verification run: `npm test` passed (552/552); `npm run lint` passed with 0 errors and 3 unused-argument warnings; `git diff --check` reported trailing whitespace in `src/game/tutorial.js:117–121`.
  - Result: Re-audit covered 76 current worktree paths. Three medium and one low finding remain; the canary release-gate defect from the previous audit is fixed in code, but lacks a direct regression test. The exact delta since the previous audit cannot be proven because no prior audit commit/tag was supplied.
  - Next step: Resolve the current findings and missing tests; preserve operational release gates for live canary, permissions, production recovery, telemetry, and multi-process profile writes.
- [x] 2026-10-24
  - File(s): `src/commands/noodle.js`, `src/commands/noodleDev.js`, `src/commands/noodleSocial.js`, `src/game/counting.js`, `src/index.js`, `src/jobs/gameUpdates.js`, `src/jobs/scheduledDelivery.js`, `src/jobs/weeklyGiveaways.js`, `src/jobs/workPings.js`, `src/ui/dailyMenuV2.js`, `test/daily-menu.test.js`, `test/noodle-dev-admin.test.js`, `test/player-copy-parity.test.js`, `test/scheduled-delivery.test.js`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Fixed daily-menu early commit with explicit Save/Cancel draft flow; added recurring stale-delivery recovery and admin reconciliation; kept rollout summaries queued after canary preview and made public release-state completion atomic; aligned counting reset copy; removed all three unused-argument lint warnings.
  - Behavior impact statement: Daily-menu changes now apply only after explicit Save; uncertain jobs remain fail-closed until an administrator verifies delivery or absence. Canary previews no longer consume production rollout updates.
  - Player-facing or internal-only classification: Daily-menu controls and exact reset copy are player-facing; recovery, reconciliation, and lint cleanup are internal-only.
  - Player-facing copy approval status, if applicable: Counting reset runtime matches the approved copy packet; new Save/Cancel labels are interaction controls.
  - Verification run: Targeted tests passed (48/48); `npm run lint` passed with 0 warnings and 0 errors; changed-file syntax checks passed. Full `npm run review:all` is recorded under Validation Commands and Outcomes.
  - Result: Previously reported code-level risks are resolved in code and covered by focused tests. No live Discord operation or production recovery drill was performed.
  - Next step: Keep production activation gated on private-canary/privacy and permissions checks, a production backup/restore drill, representative telemetry, copy review, and the first comprehensive player update.

- [x] 2026-10-30
  - File(s): `src/index.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_CHECKLIST.md`, `docs/README.md`, `docs/PLAYER_COPY_REVIEW.md`, `content/news.json`, `content/game-updates.json`, `src/commands/noodle.js.bak`, `test/counting-rewards.test.js`, `test/game-updates.test.js`.
  - Checklist item(s) updated: Resolved the 2026-10-30 audit findings (Medium: counting milestone grants now run under `lock:user:<id>` with a bounded lock-busy retry; Low: tracked `.bak` edit reverted; Low: README lists the rollout flags and `NOODLE_BACKUP_*` variables are documented in ENVIRONMENT.md). Moved the PebbleHost/Discord rollout steps into `docs/FEATURE_ROLLOUT_CHECKLIST.md`. Added news v0.6.0 and the first game update `v0-6-0-first-update` (`rollout_summary: true`).
  - Behavior impact statement: Counting rewards are serialized with player commands for the same user. News shows v0.6.0 as Latest Update and drops Daily Menu Customization and Achievements from Upcoming. The first game update is content only; delivery remains gated by canary and production approvals.
  - Player-facing or internal-only classification: Player-facing (news and update copy); the lock change is internal.
  - Player-facing copy approval status, if applicable: New v0.6.0 news/update copy is pending user review; the release date `2026-10-30` should be confirmed.
  - Verification run: `npm run review:all` passed (566 tests, 0 failed; lint clean; review guard passed); CRLF-aware `git diff --check` passed.
  - Result: All three audit findings are resolved. Operational gates (live canary, restore drill, telemetry baseline, multi-process write behavior) remain open and are tracked in the checklist.
  - Next step: Review the news/update copy, then work through `docs/FEATURE_ROLLOUT_CHECKLIST.md`.

## Risk Controls

- [ ] If routing/edit/defer paths are touched, require one extra manual interaction check.
- [ ] If shared helper signatures change, require a callsite sweep before commit.
- [ ] If tests are updated, validate behavior parity rather than introducing new behavior.
- [ ] Block merge if frozen banned patterns remain in scope.
- [ ] Back up persistent data before migration rollout; migrate older profiles only and preserve newer data.
- [ ] Keep new automations disabled by default until configuration and permissions are verified; enable by a documented canary sequence with explicit success/stop signals.
- [ ] Before normal-channel promotion, send and review each feature's first canary messages in the existing bot join/leave alert channel; confirm access is restricted to the user and bot and obtain explicit user approval to switch that feature to its normal channel.
- [ ] For data migrations and player-facing scheduled jobs, document rollback/disable steps and verify they do not lose player data, duplicate rewards, or emit unintended announcements.
- [ ] Ensure scheduled jobs are bounded, non-overlapping, and safe across restarts; avoid expensive per-message or per-interaction scans.
- [ ] Hold feature-related player announcements until the release update is complete; retain independent existing notices.
- [ ] Internal-only implementation commits may proceed before copy approval, but must not include unapproved player-facing wording or enable player-facing behavior. Do not commit player-facing copy until the user has reviewed and approved it; preserve approval status in the change ledger.
- [ ] Record mitigation and residual risk for every high-risk finding before release.

## Non-Goals

- [ ] No gameplay rebalance unless explicitly in scope.
- [ ] No unrelated refactors.
- [ ] No automated VALOR fulfillment; Erma fulfills server XP manually after the bot notice.
- [ ] No per-user bot binary versions; deployed bot code is shared globally.

## Final Self-Audit

- Security and auth: `/noodle-dev admin delivery_reconcile` is a new privileged operation guarded by the existing dev-admin and official-guild checks. It accepts only allowlisted record types, updates only `delivery_unknown` rows, requires a valid message ID for delivered outcomes, and requires explicit absence verification before requeueing. Counting remains disabled by default, requires message-content intent, and is gated on private-canary attestation. Real channel permissions and canary visibility have not been verified.
- Data integrity and idempotency: Tutorial reset preserves unrelated profile fields; schema versions cannot decrease; malformed canonical player JSON now fails closed; shared-order inventory and contribution changes are transactional; counting deduplicates message IDs. Stale profile snapshots still commonly use `expectedRev = null`; no ordered profile migrations or backup/recovery rollout has been implemented.
- Behavior regressions: Focused regression tests cover tutorial reset preservation, shared-order cap and rollback, telemetry routing, counting transitions/replay/deletion, monotonic schema versions, and corrupt-profile protection. The current repository suite passes.
- Reliability and runtime safety: Counting processing is serialized in-process and persistent state is restart-safe; work-ping, giveaway, daily-menu, achievement, and game-update/season foundations remain behind approval/configuration gates. Recurring recovery moves stale in-flight sends to `delivery_unknown`; admin reconciliation never retries without verified absence. Canary rollout and season previews remain queued for production. No live Discord canary, permission, multi-process deployment, or production delivery-restart drill has run.
- Test coverage gaps: Focused tests cover counting transitions/replay and approved-copy parity, daily-menu draft/confirmation controls, reward primitives, giveaway and work-ping rules, stale in-flight state recovery, delivery reconciliation for every supported job type, canary-to-production rollout state, and scheduled-message metadata restoration. End-to-end Discord delivery, operator reconciliation in production, and migration backup/rollback remain untested.
- Docs-runtime parity checks: Telemetry, counting, work-ping, giveaway, game-update, season/event, and feature gates are documented.
- Performance and telemetry accuracy: Reports use `interaction_latency` records for measured handler p50/p95 and failed-interaction rate; V2 scene transitions/errors, bypasses, completed-flow summaries, minigame outcomes, slow-interaction signals, and telemetry-drop summaries remain separate diagnostics. Completed-flow elapsed time includes delays between player clicks and is not server latency. V2 route-error signals per recorded scene transition are diagnostic, not a command failure rate. `slow` mode and sampling reduce coverage; invalid-duration, dropped, malformed, and unrecognized records are disclosed. No representative telemetry log is present, so there is no measured baseline or empirical health conclusion for this environment.
- Risk mitigations and residual risks: No database migration or production activation occurred. Keep all player-facing features disabled; back up before any future profile migration; resolve stale-snapshot writes; complete migration recovery tests; review the newly added daily-menu Save/Cancel UI in canary; verify the private canary; and define rollback thresholds before release.
- Player-visible vs. internal-only change ledger: Tutorial/profile persistence and telemetry routing are internal-only. Shared-order error text, counting text, work-ping, giveaway notices/fulfillment confirmations, achievement content, generated/scheduled updates, and daily-menu draft controls are player-facing and inventoried in `docs/PLAYER_COPY_REVIEW.md`. The counting reset string matches approved copy; the new draft-control labels still require canary review. No commit or deployment has occurred. Operational release gates remain blockers.

## Interim Risk Assessment

This assessment covers the current implementation and its known gaps; it is not a production readiness sign-off.

| Change area | Data/economy risk | Performance/reliability risk | Abuse, routing, and rollback considerations |
|---|---|---|---|
| Tutorial reset and profile/schema safety | Low for the tutorial-only reset: it preserves other fields; schema version writes are monotonic and invalid JSON fails closed. Medium residual risk: there is no ordered player-profile migration framework, no migration-specific automatic backup/rollback, and many existing profile writes use `expectedRev = null`, so stale snapshots can still overwrite newer state. No profile schema bump or bulk migration is part of this rollout. | No new hot loop. Profile load/save remains in normal command paths. | Bot code is shared globally; profiles do not run different bot versions. Deploying new code updates all users served by that process, but rolling deployment consistency is not verified here. Restore requires operator action. |
| Shared-order contribution caps | Low-medium: ingredient contributions are capped by equal per-member total units and inventory/contribution changes roll back together. | Small transaction-level arithmetic/query work; no latency sample is available. | Private error prevents public exposure; active party membership/snapshot changes still need live canary coverage. |
| Counting and milestone rewards | Medium: message IDs deduplicate sequence processing; milestone row and reward ledger prevent repeat grants; the reward grant is transactional. Existing profiles receive fields lazily; no mass profile migration is made. | Message-content processing and database writes occur only in the configured channel. Counts/reward backlog are durable. Production throughput is unmeasured. | Disabled by default; requires message-content intent, copy approval, verified private canary, and configured route. Wrong integers reset sequence as decided; malformed messages and other bots/webhooks are deleted. Rollback disables flags but cannot reverse already granted rewards. |
| Giveaways | Medium economy risk: prize configuration is validated and in-game reward fulfillment is idempotent in a database transaction; unique weekly wins constrain fairness. A DB restore after a grant but before corresponding external state is reconciled could repeat an economic effect. | Five-minute scheduler and bounded weekly contests; result delivery statuses suppress blind retries. `delivery_unknown` requires checking Discord and manual reconciliation; a missed confirmation is possible. VALOR confirmation is claim-once and requires Erma's configured account. | Entry is bound to the giveaway post and duplicate entries/wins are blocked. Production channel and live rewards require separate approvals. Already granted prizes cannot be undone automatically. |
| Work pings | No player-profile/economy mutation. | Two-hour job replaces the persisted prior message. A send accepted by Discord but not acknowledged in SQLite becomes `delivery_unknown`; automatic retry is suppressed, so a ping may be missing until an operator verifies and clears state. | Canary suppresses role mentions; production explicitly requires configured role, channel, and approval. Disable flag stops future runs; existing posted message may need manual deletion. |
| Scheduled game updates and season/event notices | No player-profile/economy mutation. Scheduled bodies are snapshotted at schedule time; season state is persisted. | One-minute scheduler checks only the configured official guild; event transitions are observed after existing season/event state updates, nominally within about a minute. Discord send uncertainty blocks automatic retry and may require manual reconciliation. | Disabled by default; content approval, private canary, production approval, and official-guild check gate delivery. Non-rollout posts remain held until the first comprehensive update is delivered to production. Disable flags and scheduled row status provide rollback controls; already published posts require manual deletion. |
| Daily menu and achievements | Medium: menu changes preserve accepted orders and only refresh unaccepted orders; achievement claims are locked and one-time. Historical unlocks are only inferred where persisted metrics provide evidence; missing historical event evidence is not fabricated. | Menu selection adds no recurring work; achievement evaluation occurs on command saves/menu access. | Menu changes are once per UTC day. Reward grants cannot be automatically reclaimed after rollback; achievement definitions and reward values are user-approved. |
| Telemetry routing and operator health | No player data mutation. Reports can be misleading if event coverage/drop rates are incomplete; no representative log was available, so latency/health is unknown. | Telemetry buffers are bounded and sampling can drop high-volume events; full production overhead and p50/p95 are not measured. | Dedicated telemetry channel is required; no fallback to dev alerts. Disable telemetry reports if the route is incorrect; do not treat a passing test suite as evidence of production health. |

Backups are scheduled daily (default 03:00 UTC), with a startup backup unless `NOODLE_BACKUP_ON_START=0`; the default retention is 14 dated backups. A SQLite backup/restore fixture passes `PRAGMA integrity_check`, and additive giveaway delivery-column migration is idempotently tested. Neither validates the live production database, its filesystem, retention, restore permissions, or a complete operator recovery drill. Take and verify a fresh backup before any production schema or profile migration.

### Initial review findings and actions (2026-10-24; superseded by the re-audit below)

The review covered all 69 changed paths in the current worktree, including untracked files. No critical or high-severity findings were identified. The four findings below are release blockers until fixed and verified; this assessment is not a production readiness sign-off.

| # | Severity / confidence | Finding and impact | Required action and verification |
|---|---|---|---|
| 1 | Medium / high | Daily order-menu selection persists on the first page selection instead of retaining a draft until the player finishes navigating. This consumes the once-per-day change and prevents completing a multi-page menu. Evidence: `src/commands/noodle.js` (9879–9904, 17193–17199); `test/daily-menu.test.js` (8–100). | Keep cross-page selections as draft state; commit only on an explicit confirmation/save action. Add an interaction regression test that selects items on one page, navigates to another, and confirms the combined selection; verify cancel/stale interactions do not consume the daily change. Do not enable the picker in production until this passes. |
| 2 | Medium / high | A process restart can leave scheduled deliveries in `sending`/`posting` indefinitely: recovery runs only once at startup and skips records younger than ten minutes, with no later reconciliation. Season-update `sending` state is not included in the recovery sweep. Evidence: `src/jobs/gameUpdates.js` (377–400, 482–485), `src/jobs/weeklyGiveaways.js` (411–426), `src/jobs/workPings.js` (97–100). | Add recurring, bounded stale-state reconciliation for every in-flight record, including season updates. Preserve the no-blind-retry rule: move uncertain sends to an operator-reconcilable state rather than resending automatically. Add restart/timeout tests for before and after the age threshold, covering all delivery types and season state; document the operator check/clear procedure before enabling jobs. |
| 3 | Medium / high | A due rollout-summary update may be sent to the canary and marked `sent` without setting the production-release state. On promotion, the summary is no longer pending and the production announcement gate remains closed; a crash between marking sent and writing release state can produce the same outcome. Evidence: `src/jobs/gameUpdates.js` (285–323); `test/game-updates.test.js`. | Separate canary-preview state from production scheduling and atomically persist production send completion with the release-gate state. Add tests for canary preview followed by production promotion and interruption during release-state persistence. Verify rollback/retry handling without duplicate public posts; do not promote until these tests pass. |
| 4 | Low / high | The approved copy packet does not exactly match runtime output: counting reset wording differs, and giveaway copy promises both full and relative closing timestamps while runtime emits only the full timestamp. Evidence: `docs/PLAYER_COPY_REVIEW.md` (23, 85), `src/index.js` (977, 982), `src/jobs/weeklyGiveaways.js` (84). | Reconcile the runtime text and packet so approved wording describes actual output. Add or update exact-rendered-copy assertions and verify rendered messages in the private canary before production activation. |

**Initial release disposition:** This is retained as the initial audit record. Current statuses and release blockers are superseded by the re-audit below.

### Latest re-audit findings and actions (2026-10-24)

The fresh audit reviewed 76 changed worktree paths relative to `HEAD` (37 modified tracked files and 39 untracked files). No prior audit commit or tag was available, so the exact set of changes made since the last audit cannot be proven. No critical or high findings were reported. The previous canary release-gate finding is fixed in the current code; the previous giveaway timestamp discrepancy was not reproduced in this pass.

| # | Severity / confidence | Audit finding and current status | Corrective action and verification |
|---|---|---|---|
| 1 | Medium / high | **Resolved.** Daily-menu page selections are cached as a draft; `setDailyOrderMenu` and profile persistence run only after Save. Cancel clears the draft; empty cached selections no longer fall back to the saved menu. | UI regression covers draft state and Save/Cancel controls; command routing handles owner mismatch and only explicit Save reaches the setter. Live Discord interaction verification remains a release gate. |
| 2 | Medium / high | **Resolved in code; operational recovery still requires an operator.** Recurring bounded sweeps move stale in-flight records to `delivery_unknown`, including season updates and giveaway confirmation states. `/noodle-dev admin delivery_reconcile` can record a verified message ID or requeue only after `verified_absent=true`; compare-and-set transitions store scheduled-message metadata. | SQLite tests cover stale rows, each delivery category, evidence requirements, requeue states, and release-state persistence. Use the command only after checking the channel and ensuring no active sender can still complete. Live Discord recovery drill remains outstanding. |
| 3 | Medium / high | **Resolved.** Runtime uses the shared `COUNTING_RESET_NOTICE` constant; the approved copy packet contains the exact same text. | `test/player-copy-parity.test.js` asserts that the approved packet matches the runtime constant. Inspect rendered text during canary before production activation. |
| 4 | Low / high | **Resolved for identified stateful edges.** Focused coverage includes draft controls, stale in-flight recovery, giveaway/season/update reconciliation, canary preview followed by production promotion, and atomic first-public-update release state. | Targeted regression suite passed (48/48). End-to-end Discord execution is not simulated by these tests and remains an operational canary check. |

**Current release disposition:** No active code-level blocker remains from the latest audit. Production activation is still blocked on independent operational gates: private-canary visibility and Discord permissions, a production backup-and-restore drill, representative telemetry baseline, multi-process stale-profile-write validation, copy/canary review, and delivery of the comprehensive first player update.

## Validation Commands and Outcomes

- Prior audit checks: `npm run review:all` passed (545 tests, 0 failed; 3 unused-argument warnings before cleanup); the subsequent re-audit `npm test` passed (552/552), with the same three warnings.
- Corrective-change checks: `npm run review:all` passed: 561 tests, 0 failures; lint had 0 warnings and 0 errors; pre-review guard passed. `npm run check:syntax` passed; focused tests passed (48/48); CRLF-aware `git diff --check` passed.
- Focused tests: `node --test test/achievements.test.js test/garden-kitchen-achievement-metrics.test.js test/game-updates.test.js test/giveaways.test.js test/work-pings.test.js test/counting-rewards.test.js test/daily-menu.test.js test/social.test.js` (60 passed, 0 failed).
- `npm run check:syntax`: Passed across `src`, `test`, and `scripts`.
- Latest full pending-change review before corrective changes: 76 current worktree paths reviewed, including untracked files; 0 critical, 0 high, 3 medium, and 1 low finding. All four findings now have corrective code/tests and their status is recorded above. Local review cannot establish live Discord delivery/permissions, a production recovery drill, or runtime performance.
- Rollout JSON parse check: Passed for `content/achievements.json`, `content/counting.rewards.json`, `content/giveaways.json`, and `content/work-ping.json`.
- `git -c core.whitespace=cr-at-eol diff --check`: Passed. Plain `git diff --check` still flags CRLF line endings in the existing tutorial reset change; no other whitespace issue was reported by the CRLF-aware check.
- `npm run telemetry:v2-report`: Failed because `noodle-logs/telemetry.log` is absent; no measured latency baseline, sample count, or bot-health conclusion can be reported.
- Any intentionally skipped checks + reason:
- 2026-10-21
  - File(s): Current uncommitted scope and this plan.
  - Checklist item(s) updated: Interim repository-wide verification and implementation status.
  - Behavior impact statement: Verification and documentation only; no runtime behavior change.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Pending; no copy approved, committed, or activated.
  - Verification run: `npm run review:all` (passed: 513 tests, 0 failed; lint 0 errors with 3 existing unused-argument warnings; pre-review guard passed).
  - Result: Broad repository checks pass for the current worktree; this does not validate runtime Discord delivery, latency, or outstanding rollout tracks.
  - Next step: Implement scheduled/editable game updates and season-turn posts; finish migration/recovery and delivery reliability reviews; batch copy review; then final validation.
- 2026-10-21
  - File(s): `src/jobs/gameUpdates.js`, `src/jobs/scheduledDelivery.js`, `src/jobs/workPings.js`, `src/jobs/weeklyGiveaways.js`, `src/commands/noodle.js`, `src/commands/noodleDev.js`, `src/content/index.js`, `src/db/index.js`, `src/db/schema.sql`, `src/index.js`, `content/game-updates.json`, `test/game-updates.test.js`, `test/scheduled-delivery.test.js`, `docs/ENVIRONMENT.md`, `README.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Added editable/previewable/schedulable game updates, season/event-change posts, first-announcement release gate, strict ISO schedule validation, and durable announcement delivery state; hardened work-ping and giveaway post/preview/winner-confirmation retry semantics.
  - Behavior impact statement: New announcement delivery remains gated by disabled-by-default settings, copy approval, private-canary attestation, and separate production approval. Uncertain Discord delivery is marked `delivery_unknown` and not automatically retried to avoid duplicate messages. No feature was activated.
  - Player-facing or internal-only classification: New announcement templates and generated season/event wording are player-facing drafts; send-state persistence and recovery behavior are internal-only.
  - Player-facing copy approval status, if applicable: Pending user review; no copy approved or committed.
  - Verification run: `node --test test/game-updates.test.js test/scheduled-delivery.test.js test/work-pings.test.js test/giveaways.test.js test/db-player-schema.test.js` (17/17 passed); focused ESLint (0 errors, 1 pre-existing unused-argument warning); modified-file syntax checks (passed).
  - Result: Game-update content/config validation, routing gates, strict timezone parsing, schedule snapshot persistence, season payload construction, and atomic send claim transitions pass focused tests. Live Discord delivery and manual reconciliation remain unverified.
  - Next step: Run full repository validation, audit open risk/backup controls, and assemble the complete player-facing copy review packet before any commit or production activation.
- [x] 2026-10-21
  - File(s): `content/achievements.json`, `src/game/achievements.js`, `src/jobs/gameUpdates.js`, `src/jobs/weeklyGiveaways.js`, `src/commands/noodle.js`, `test/achievements.test.js`, `test/counting-rewards.test.js`, `test/game-updates.test.js`, `test/giveaways.test.js`, `test/work-pings.test.js`, `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`, `docs/ENVIRONMENT.md`, `README.md`.
  - Checklist item(s) updated: Applied the user-approved wording; included gardening and broth-simmering achievements; used Giveaway and Season banners as titles; included season timestamps, both event descriptions, and configured role mentions; clarified that game-update role configuration only gates season posts, not unrelated manual updates.
  - Behavior impact statement: First-time blessing/tip achievements now have valid threshold 1; production season posts stay held until their role is configured; giveaway confirmations report the Take-Out Counter's 50,000-coin grant along with the seven-day perk. All features remain disabled/gated; no deployment or commit occurred.
  - Player-facing or internal-only classification: Mixed; player-facing copy and reward confirmation changes are user-approved, while season routing behavior and approval documentation are internal operational details.
  - Player-facing copy approval status, if applicable: Explicitly approved by the user; see `docs/PLAYER_COPY_REVIEW.md`.
  - Verification run: `npm run review:all` (529 passed, 0 failed; 0 lint errors, 3 pre-existing warnings; review guard passed); focused tests (60 passed, 0 failed); `npm run check:syntax` (passed); rollout JSON parse check (passed); CRLF-aware `git diff --check` (passed).
  - Result: Local automated checks pass. Telemetry report remains unavailable because its log file is absent; no live Discord delivery or production readiness is claimed.
  - Next step: Complete backup/recovery and canary/permission checks, acquire representative telemetry, review daily-menu visibility, and deliver the comprehensive player update as the first production announcement. Keep production delivery disabled until those gates are satisfied.
- [x] 2026-10-22
  - File(s): `src/infra/telemetry.js`, `src/infra/v2TelemetryReport.js`, `src/jobs/v2TelemetryAlerts.js`, `src/jobs/workPings.js`, `src/game/counting.js`, `src/ui/countingNotices.js`, `src/index.js`, `test/v2-telemetry-report.test.js`, `test/work-pings.test.js`, `test/counting.test.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Aligned the work-ping cron to fixed even-hour UTC slots without a startup send; verified bot-authored counting notices and work pings use Components V2; corrected telemetry metrics and added per-route actionable guidance.
  - Behavior impact statement: Work pings no longer shift with restarts. Counting reset/reward notices use V2 containers. Telemetry reports now distinguish measured interaction-handler duration and failures from V2 flow elapsed time and route-error diagnostics; alert thresholds align with those measures.
  - Player-facing or internal-only classification: Work-ping schedule/container and counting container behavior are player-visible; telemetry calculations, report routing, and drop-counter accounting are internal-only. No player-facing wording was changed.
  - Player-facing copy approval status, if applicable: Existing player copy remains approved; no new copy was introduced.
  - Verification run: `npm run review:all` passed (537 tests, 0 failed; lint 0 errors and 3 unused-argument warnings; pre-review guard passed); `npm run check:syntax` passed; the CRLF-aware scoped `git diff --check` passed for the continuation files. Focused scheduling/counting/telemetry tests passed (23/23) before the final regression-recommendation test was added; the full suite includes that test.
  - Result: Automated checks pass. The telemetry log is absent from this workspace, so measured latency and bot-health conclusions remain unavailable. No production activation, deployment, or commit occurred.
  - Next step: Keep live activation gated on canary/permissions and acquire a representative telemetry window before making empirical performance claims.
- [x] 2026-10-22
  - File(s): `src/game/achievements.js`, `src/commands/noodle.js`, `src/jobs/gameUpdates.js`, `test/achievements.test.js`, `test/game-updates.test.js`, `docs/PLAYER_COPY_REVIEW.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Paginated achievements at 10 visible items per page; added explicit V2 container enforcement for game/season delivery; strengthened payload tests.
  - Behavior impact statement: The Achievements list no longer attempts to render all 88 definitions in one message. Players page through the catalog and claim rewards for items on the displayed page. Scheduled and seasonal game updates are required to be Components V2 containers, with no plain-text fallback in the shared send path.
  - Player-facing or internal-only classification: Achievement pagination and announcement payload behavior are player-visible; validation guard and docs are internal.
  - Player-facing copy approval status, if applicable: Existing approved copy unchanged; pagination labels are new navigation UI and use standard Previous/Next wording.
  - Verification run: `node --test test/achievements.test.js test/game-updates.test.js test/work-pings.test.js test/counting.test.js test/giveaways.test.js` passed (35/35); `npm run review:all` passed (538 tests, 0 failed; lint 0 errors and 3 unused-argument warnings; pre-review guard passed); `npm run check:syntax` passed; scoped CRLF-aware diff check passed.
  - Result: Each achievement page has at most 10 entries; all visible achievements appear exactly once across pages, current page text stays under Discord's 4,096-character embed-description limit, and page bounds clamp safely. Game and season payloads assert Components V2 container type 17 with no plain `content`; scheduler send path rejects non-container payloads. Pings/counting/giveaway container tests also pass.
  - Next step: Continue holding production activation behind canary/permission checks and release gates. No deployment or commit occurred.
- [x] 2026-10-24
  - File(s): `src/infra/telemetry.js`, `src/infra/v2TelemetryReport.js`, `src/jobs/v2TelemetryAlerts.js`, `src/jobs/dailyReset.js`, `src/jobs/eventSync.js`, `src/jobs/backupDb.js`, `src/jobs/dbMaintenance.js`, `src/jobs/dailyRewardReminders.js`, `src/jobs/workPings.js`, `src/jobs/gameUpdates.js`, `src/jobs/weeklyGiveaways.js`, `src/index.js`, `test/v2-telemetry-report.test.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, `docs/README.md`.
  - Checklist item(s) updated: Added bot-start, Discord gateway lifecycle, scheduled-job run, hard-operation/delivery-failure, and bot-list heartbeat telemetry, including nested game-update and giveaway delivery failures. Report summaries identify affected operations, include measured bot interaction outcomes, scheduled-job outcomes, gateway disruptions, failure alerts, and explicit uptime/coverage limitations. Added references for rollout environment variables and changed menu layouts.
  - Behavior impact statement: Internal-only observability changes; cron schedules, user-facing behavior, and rollout gates are unchanged. Database backup now reports a failed run and always clears its in-progress guard if backup path setup fails.
  - Player-facing or internal-only classification: Internal-only.
  - Player-facing copy approval status, if applicable: Not applicable.
  - Verification run: Focused regression tests passed (72/72); `npm run review:all` passed (541 tests, 0 failed; lint reported 0 errors and 3 unused-argument warnings; pre-review guard passed); modified-file `node --check` passed; `git -c core.whitespace=cr-at-eol diff --check` passed. Plain `git diff --check` flags pre-existing CRLF lines in `src/game/tutorial.js`.
  - Result: Telemetry implementation, regression coverage, rollout environment-variable guide, changed-menu layout guide, and documentation index are complete; no production activation, deployment, or commit occurred. Live telemetry has not yet been observed, so this work does not establish production health or uptime.
  - Next step: Keep production activation behind canary/release gates; validate report contents against live telemetry after an approved deployment.
- [x] 2026-10-24
  - File(s): `src/jobs/weeklyGiveaways.js`, `src/jobs/gameUpdates.js`, `src/commands/noodle.js`, `src/commands/noodleSocial.js`, `src/ui/achievementsV2.js`, `src/ui/componentsV2.js`, `test/giveaways.test.js`, `test/game-updates.test.js`, `test/achievements.test.js`, `README.md`, `docs/ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_ENVIRONMENT.md`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`.
  - Checklist item(s) updated: Production giveaway and game-update settings require a valid shared announcements role. Both the shared role and the existing game-updates role are now mentioned on every production game update; season/event posts also place the latter at its configured copy placeholder. Private canaries remain mention-free. Collections no longer links to Achievements; the Achievements entry point is only the button beside Collections on the social Stats screen (the slash-command entry was removed). The achievement screen now renders as a Components V2 container with inline claim buttons and the page/owner footer. The order board now has a Menu button in legacy and V2 layouts, routed to the daily menu picker; after a menu edit, the picker refreshes its displayed selection. The menu reference now records banners, exact button emoji, and no-button announcement layouts.
  - Behavior impact statement: Production giveaways fail closed without `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID`; production game updates additionally require a valid `NOODLE_GAME_UPDATES_EVENTS_ROLE_ID`. Both roles are explicitly mentioned and allowlisted on every production update, with duplicate suppression when the events role already appears at its template placeholder or both settings use the same role ID. Achievement and order-board menu layouts/navigation are player-visible. The V2 helper now recognizes green accessory buttons when deciding whether to show the existing green-button footer tip.
  - Player-facing or internal-only classification: Player-facing role mention and configuration gate.
  - Player-facing copy approval status, if applicable: Role mention behavior requested; rollout remains behind existing production approval gates.
  - Verification run: Focused role/menu/container tests passed (85/85); `npm run review:all` passed (542 tests, 0 failed; lint 0 errors and 3 existing unused-argument warnings; pre-review guard passed); modified-file syntax checks passed; CRLF-aware `git diff --check` passed. Final same-role-ID deduplication change and assertion passed `node --test test/game-updates.test.js` (6/6), targeted ESLint, and CRLF-aware `git diff --check`.
  - Result: Shared and game-update role routing, entry-point changes, daily-menu navigation, inline achievement claiming, footer/banner handling, and detailed menu/message reference are complete. Role IDs must be set in deployment configuration. The achievement banner is ready for the standard `scene_banner_achievements` key but awaits the user's asset upload. No production activation, deployment, or commit occurred.
  - Next step: Add the supplied achievement banner URL to `content/icons.json` when the user uploads it; keep production announcements gated until both role IDs and normal canary/release approvals are configured.
- [x] 2026-10-24
  - File(s): `src/ui/dailyMenuV2.js`, `src/ui/componentsV2.js`, `src/commands/noodle.js`, `src/commands/index.js`, `src/jobs/weeklyGiveaways.js`, `src/jobs/gameUpdates.js`, `src/game/achievements.js`, `test/daily-menu.test.js`, `test/orders-board-v2.test.js`, `test/giveaways.test.js`, `test/game-updates.test.js`, `test/achievements.test.js`, `test/components-v2.test.js`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, `docs/FEATURE_ROLLOUT_PLAN.md`, `docs/PLAYER_COPY_REVIEW.md`.
  - Checklist item(s) updated: Replace the daily order-board picker embed response with a Components V2 container, establish `scene_banner_daily_menu` banner lookup, rename the Orders Board's V2 Main Menu button to Back, and route achievement notice copy to the existing Social Stats button entry.
  - Behavior impact statement: Daily-menu picker appearance and payload change to a V2 container; giveaway copy now has one absolute close timestamp, small-text role mention formatting, and a sparkle entry-button emoji; scheduled game updates use the news banner while season/event updates retain their season banner; achievement unlock notices use the configured achievements banner and direct users to Social Stats.
  - Player-facing or internal-only classification: Player-facing UI/copy changes.
  - Player-facing copy approval status, if applicable: Requested directly by the user.
  - Verification run: `node --test test/daily-menu.test.js test/orders-board-v2.test.js test/giveaways.test.js test/game-updates.test.js test/achievements.test.js test/components-v2.test.js` passed (69/69); targeted ESLint passed with 0 errors and 1 existing unused-argument warning; `node --input-type=module -e 'import { commands } from "./src/commands/index.js"; for (const command of commands) command.data.toJSON(); console.log(`${commands.length} slash commands serialize successfully`);'` passed (7 slash commands); `npm run review:all` passed (545 tests, 0 failed; lint 0 errors and 3 existing unused-argument warnings; pre-review guard passed); changed-source `node --check` and CRLF-aware `git diff --check` passed.
  - Result: All validation passed; the dedicated daily-menu image key is ready for the future asset, while the achievements and news banners are configured.
  - Next step: Keep production rollout gates unchanged; add the daily-menu banner URL when the user supplies the asset.
- [~] 2026-10-24
  - File(s): `docs/FEATURE_ROLLOUT_ENVIRONMENT.md`, `src/commands/index.js`, `src/commands/noodle.js`, `src/game/achievements.js`, `test/components-v2.test.js`, `test/achievements.test.js`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Format rollout settings as a PebbleHost merge-ready copy/paste block. Audit the registered slash-command inventory and verify `/noodle` currently uses all 25 subcommand/group slots. Remove the standalone `/achievements` command; leave its social-menu entry point and discovery instructions.
  - Behavior impact statement: Environment setup is made actionable without replacing existing settings. The audit identified duplicate daily-reward and quest-claim slash routes; their removal and the new achievements subcommand are completed in the follow-up entry below.
  - Player-facing or internal-only classification: Environment/operator documentation and player-facing command discovery.
  - Player-facing copy approval status, if applicable: The achievement-notice entry point is documented and updated in the follow-up entry below.
  - Verification run: `node --test test/components-v2.test.js test/achievements.test.js` passed (44/44); targeted ESLint passed with 0 errors and 1 pre-existing unused-argument warning; command serialization passed for the 6 registered top-level commands and confirmed `/noodle` is at 25/25 options; changed-source `node --check` and CRLF-aware `git diff --check` passed.
  - Result: PebbleHost guide and initial command audit are updated and validated; command consolidation is completed in the follow-up entry below.
  - Next step: None; follow-up implementation and validation are recorded below.
- [x] 2026-10-24
  - File(s): `src/commands/noodle.js`, `src/jobs/dailyRewardReminders.js`, `src/game/achievements.js`, `test/components-v2.test.js`, `test/achievements.test.js`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Remove redundant `/noodle quests_daily` and `/noodle quests_claim` slash aliases; preserve their component handlers and the equivalent `/noodle-quests daily/claim` commands. Add `/noodle achievements` within the freed `/noodle` subcommand capacity and update help, reminder, and achievement notice references.
  - Behavior impact statement: Players use `/noodle-quests daily` and `/noodle-quests claim` in place of the removed `/noodle` aliases. Achievement menu is available from Social Stats and `/noodle achievements`; unlock notices direct players to the latter.
  - Player-facing or internal-only classification: Player-facing command registration and help/copy.
  - Player-facing copy approval status, if applicable: Changes follow the user's request and the pragmatic choice after they were unavailable to answer.
  - Verification run: `node --test test/components-v2.test.js test/achievements.test.js test/daily-reward-reminders.test.js test/noodle-quests.test.js` passed (44/44); `npm run review:all` passed (545/545 tests, lint with 0 errors and 3 warnings, pre-review guard passed); command serialization passed for all 6 registered top-level commands with `/noodle` using 24/25 options and `/noodle achievements` registered; `node --check` and CRLF-aware `git diff --check` passed. Targeted ESLint passed with 0 errors and 1 existing unused-argument warning.
  - Result: The redundant slash aliases are removed without deleting their component handlers; help, reminders, and achievement notices use the retained command paths. Achievement notices include `/noodle achievements`, with the Social Stats button still available.
  - Next step: No further implementation or deployment was requested.
- [x] 2026-10-24
  - File(s): `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Recorded the requested achievement button states, hidden-specialization achievements, blessing terminology, badge art/profile customization menu, in-menu badge indicators, and Claimed/In Progress achievement categories as a new unstarted implementation track.
  - Behavior impact statement: Planning documentation only; no runtime behavior or player-facing output changed.
  - Player-facing or internal-only classification: Internal-only planning.
  - Player-facing copy approval status, if applicable: The requested terminology is recorded; final menu labels and badge presentation will be documented with the implementation.
  - Verification run: Documentation-only change; no tests run.
  - Result: The requested requirements were recorded as a new Phase 3 track; implementation and layout documentation are recorded in the follow-up entry below.
  - Next step: None; implementation and verification are recorded below.
- [x] 2026-10-24
  - File(s): `src/commands/noodle.js`, `src/commands/noodleSocial.js`, `src/game/achievements.js`, `src/game/profileBadges.js`, `src/ui/achievementsV2.js`, `src/ui/profileBadgesV2.js`, `src/ui/profileFlowV2.js`, `content/achievements.json`, `test/achievement-button-state.test.js`, `test/achievements.test.js`, `test/components-v2.test.js`, `test/profile-badges.test.js`, `test/profile-flow-v2.test.js`, `docs/FEATURE_ROLLOUT_MENU_LAYOUTS.md`, `docs/PLAYER_COPY_REVIEW.md`, `docs/FEATURE_ROLLOUT_PLAN.md`.
  - Checklist item(s) updated: Implement claimable-reward button highlighting, hidden-specialization achievements, blessing terminology, three-row profile badge customization, placeholder badge markers in Collections/Achievements, and separate Claimed/In Progress achievement views; document the complete menu layouts.
  - Behavior impact statement: Stats and Achievements entry buttons use the Success style while a current unclaimed achievement reward exists. The Badges menu is only linked from Customize Profile and allows toggling earned badge/achievement/collection marks across independent seven-item rows. Collections and Achievements show the shared badge placeholder; hidden-specialization unlocks award new secret achievements. Achievements now filter into Claimed or In Progress, with ready-to-claim rewards remaining in In Progress.
  - Player-facing or internal-only classification: Player-facing menus, profile display, achievements, and copy.
  - Player-facing copy approval status, if applicable: Implemented according to the user's direct wording and layout requests; custom badge artwork remains placeholder pending user-provided assets.
  - Verification run: `node --test test/achievement-button-state.test.js test/profile-badges.test.js test/achievements.test.js test/profile-flow-v2.test.js test/components-v2.test.js` passed (57/57); `npm run review:all` passed (551/551 tests, lint with 0 errors and 3 existing unused-argument warnings, pre-review guard passed); slash serialization passed for all 6 registered commands with `/noodle` at 24/25 options, `/noodle achievements` registered, and no Badges slash command; `npm run check:syntax` and CRLF-aware `git diff --check` passed.
  - Result: Feature implementation and player-facing menu documentation are complete and locally validated. Individual badge artwork remains a placeholder pending the user's art assets.
  - Next step: No further implementation requested; do not deploy or commit without authorization.
