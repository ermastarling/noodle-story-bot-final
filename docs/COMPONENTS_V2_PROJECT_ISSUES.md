# Components V2 Migration Project Issue List (Comprehensive)

## Audit Summary

The previous issue list covered core loop migration but did not fully enumerate every UI surface currently using embed/message-component patterns.

Missing coverage areas identified during audit:

- Social command surfaces (leaderboards, party lifecycle, tips, blessings, shared orders).
- Staff and upgrades command UIs.
- Standalone quests/decor command module surfaces.
- Help/news/about/season/event informational menus.
- Feature menus outside core order loop (forage/fishing/garden/kitchen/takeout/pantry/market).
- DM reminder card interaction surfaces from scheduled jobs.
- Dev dashboard/status surfaces (`/noodle-dev`) used in test workflows.

This document replaces the prior backlog with full-scope issues intended to migrate every existing menu/embed surface to Components V2 container-first UI.

## Usage

- Create one GitHub issue per section below.
- Keep issue IDs and titles unchanged for traceability.
- Link PRs and test evidence before closing each issue.

## Labels (Recommended)

- `area:ui`
- `area:commands`
- `area:gameplay`
- `area:social`
- `area:devtools`
- `type:architecture`
- `type:feature`
- `type:refactor`
- `type:test`
- `priority:high`

## Coverage Matrix (Every Surface)

- `src/commands/noodle.js`: Core gameplay, profile, discovery, economy, tutorial, feature menus, and most nav components.
- `src/commands/noodleSocial.js`: Social home, leaderboards, party, tips, blessings, shared-order creation/contribution/completion.
- `src/commands/noodleStaff.js`: Staff management and leveling UI.
- `src/commands/noodleUpgrades.js`: Upgrade management and related category screens.
- `src/commands/noodleQuests.js`: Standalone quest rewards/status pages.
- `src/commands/noodleDecor.js`: Decor ownership/equipped/sets/shop embeds.
- `src/commands/noodleDev.js` + dev subcommand handlers in `src/commands/noodle.js`: dev status/dashboard/menu interactions.
- `src/jobs/dailyRewardReminders.js`: DM reminder card with button interaction.

---

## NSB-V2-01 - Components V2 Foundation and SDK Strategy

### Goal

Establish the technical baseline to send Components V2 container-first messages safely on the test bot.

### Scope

- Confirm runtime/library path for Components V2 support.
- Add V2 message send helper with `IS_COMPONENTS_V2` handling.
- Add compatibility behavior for existing message flows.
- Add unicode emoji fallback mode for test bot when custom emojis are unavailable.

### Acceptance Criteria

- At least one test command sends a valid Components V2 container message in test guild.
- Legacy flows remain functional.
- No production behavior changes.
- In test-bot mode, UI remains readable when custom emoji are unavailable.

### Dependencies

- None.

---

## NSB-V2-02 - V2 Scene Registry and Custom ID Parser

### Goal

Implement versioned custom ID parsing and centralized action routing for all V2 scenes.

### Scope

- Implement parser for `noodle:v2:<sceneKey>:<actionKey>:<ownerId>:<token>[:arg1[:arg2]]`.
- Add one authoritative scene/action registry.
- Reject malformed IDs and owner mismatches.

### Acceptance Criteria

- Parser unit tests for valid/invalid IDs.
- Owner mismatch path returns user-friendly ephemeral response.
- No ad-hoc `split(":")` routing in new V2 handlers.

### Dependencies

- NSB-V2-01.

---

## NSB-V2-03 - Scene State Store, TTL, and Stale Recovery

### Goal

Provide deterministic scene-state persistence and stale-message recovery.

### Scope

- Add scene token state store with TTL by scene type.
- Add stale token recovery action back to `orders.board`.
- Add cleanup and memory guardrails.

### Acceptance Criteria

- TTL behavior covered by tests.
- Stale interactions recover cleanly.
- No uncontrolled memory growth in extended sessions.

### Dependencies

- NSB-V2-02.

---

## NSB-V2-04 - Legacy Compatibility and Feature Flag Gate

### Goal

Run V1 and V2 in parallel safely while migrating.

### Scope

- Add guild/user feature flags for V2.
- Keep legacy IDs and routing operational.
- Add instant rollback switch to V1.
- Keep tutorial users on V1 by default until tutorial parity signoff.

### Acceptance Criteria

- V2 can be test-guild-only.
- Rollback switch requires no data migration.
- Production behavior unaffected until explicit enablement.
- Tutorial users can be segmented independently from non-tutorial users for rollout safety.

### Dependencies

- NSB-V2-03.

---

## NSB-V2-05 - Orders Board Container Scene with Inline Serve Ready

### Goal

Migrate the order board to container UI including inline serve actions per accepted order when serveable.

### Scope

- Implement `orders.board` scene and actions (`acc`, `ck`, `sv`, `qs`, `rf`, `nm`).
- Add inline `Serve Ready` next to serveable accepted-order rows.
- Keep messaging concise and non-repetitive.

### Acceptance Criteria

- `/noodle orders` renders in V2 mode.
- Inline `Serve Ready` appears only when recipe bowls are ready.
- Duplicate action buttons are not rendered.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-06 - Accept Flow Scenes (`orders.accept_picker`, `orders.accept_result`)

### Goal

Migrate accept selection and result surfaces to V2 scenes.

### Scope

- Implement picker and result scenes with select/confirm/cancel/back actions.
- Reuse existing order validation and cap logic.

### Acceptance Criteria

- End-to-end accept flow from V2 order board works.
- Errors and success states are container-native.
- Regression tests cover invalid token/cap/duplicate accept.

### Dependencies

- NSB-V2-05.

---

## NSB-V2-07 - Cook Recipe Picker Scene (`cook.recipe_picker`)

### Goal

Migrate cook entry UI to V2 scene before minigame execution.

### Scope

- Implement recipe select and quantity controls.
- Keep existing inventory/capacity/season/event validation behavior.

### Acceptance Criteria

- Picker integrates from order board and accept result.
- Validation messages are concise and actionable.

### Dependencies

- NSB-V2-06.

---

## NSB-V2-08 - Cook Minigame Engine (`cook.minigame`, `cook.result`)

### Goal

Implement the Kitchen Line deterministic minigame and remove random cook failure for V2 path.

### Scope

- Implement turn-based minigame scene actions.
- Map performance to `successBowls`/`failBowls` and quality bias.
- Implement result scene with clear next actions.

### Acceptance Criteria

- Failure is minigame-driven, not random, in V2 cook flow.
- Mobile and desktop interaction pacing is reliable.
- Unit tests cover score boundaries and failure cases.

### Dependencies

- NSB-V2-07.

---

## NSB-V2-09 - Serve Flow Scenes (`serve.order_picker`, `serve.result`)

### Goal

Migrate serve selection and result summary surfaces to V2 scenes.

### Scope

- Implement picker/result actions and transitions.
- Preserve rewards, quest progress, discovery, and level-up behavior.

### Acceptance Criteria

- Serve flow completes from V2 orders board.
- Missing bowl and expired-order cases are handled cleanly.

### Dependencies

- NSB-V2-06, NSB-V2-08.

---

## NSB-V2-09A - Tutorial Safety and Parity Guardrail

### Goal

Guarantee tutorial progression and routing remain safe and equivalent throughout V2 migration.

### Scope

- Lock tutorial source-of-truth to existing tutorial and routing modules.
- Verify parity for tutorial step progression and gate outputs in V1 vs V2 paths.
- Preserve tutorial reset and replay behavior.
- Add tutorial-specific V2 fallback handling for stale scene/token recovery.

### Acceptance Criteria

- Tutorial progression sequence remains `accept -> buy -> forage -> cook -> serve`.
- Tutorial gate outputs for key screens match existing behavior in both V1 and V2 paths.
- Existing tutorial tests remain green and new V2 tutorial parity tests are added.
- `/noodle-dev reset_tutorial` remains valid and tutorial replay works end-to-end in test bot.

### Dependencies

- NSB-V2-04 through NSB-V2-09.

---

## NSB-V2-10 - Buy and Multi-Buy Menu Migration

### Goal

Migrate market buy and multi-buy UIs from legacy embeds to containers.

### Scope

- Convert buy picker, quantity actions, selection caching UX, and result surfaces.
- Maintain tutorial gating behavior.

### Acceptance Criteria

- Buy and multi-buy flows are fully V2 in test mode.
- No duplicate buy action presentation in scenes.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-11 - Sell Menu Migration

### Goal

Migrate sell picker, quantity actions, and result surfaces.

### Scope

- Convert sell select + quick quantity actions.
- Preserve selection token cache behavior and idempotency protections.

### Acceptance Criteria

- End-to-end sell flow runs in V2 scenes.
- Legacy quantity modal deprecation behavior remains clear.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-12 - Pantry and Storage Views Migration

### Goal

Migrate pantry/bowls/storage pages and pagination to V2 containers.

### Scope

- Convert pantry page navigation and linked action controls.
- Preserve storage and capacity messaging.

### Acceptance Criteria

- Pantry scene is V2-complete with pagination.
- Messaging remains concise and non-redundant.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-13 - Forage Menu and Quantity Interaction Migration

### Goal

Migrate forage menu, target selection, and quantity interaction surfaces.

### Scope

- Convert forage menu/pagination/targeted-selection UX to V2 scenes.
- Preserve cooldown/capacity/pity behavior.

### Acceptance Criteria

- Random and targeted forage loops run in V2 scenes.
- Cooldown/full-pantry states are V2-native.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-14 - Fishing Menu and Quantity Interaction Migration

### Goal

Migrate fishing menu and quantity interaction surfaces.

### Scope

- Convert fishing menu/pagination/targeted-selection UI.
- Preserve unlock and cooldown rules.

### Acceptance Criteria

- Fishing loop functions in V2 scenes end-to-end.
- Locked/unavailable/cooldown states are V2-native.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-15 - Garden Menu Migration (Plant/Harvest/Compost)

### Goal

Migrate garden overview and all garden interaction menus.

### Scope

- Convert garden pages, plant picker, harvest picker, compost selection/add actions.
- Preserve compost selection cache behavior.

### Acceptance Criteria

- Garden flow is V2-complete.
- Compost interactions remain stable and non-duplicative in controls.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-16 - Kitchen Menu Migration (Status/Start/Collect)

### Goal

Migrate kitchen status and simmer lifecycle menus to V2 containers.

### Scope

- Convert kitchen status pages, start-select, and collect actions.
- Preserve unlock and timer logic.

### Acceptance Criteria

- Kitchen start/collect/status works in V2 scenes.
- Navigation remains concise and consistent.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-17 - Takeout Counter Menu Migration

### Goal

Migrate takeout status/menu/open/cook/serve/needs/claim surfaces to V2 scenes.

### Scope

- Convert takeout menu draft picker, shift controls, counter cook/serve, claim flows.
- Preserve shift-state and earning behavior.

### Acceptance Criteria

- Full takeout loop operates in V2 scenes.
- Menu draft selection remains reliable across pages.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-18 - Profile Core Menu Migration

### Goal

Migrate profile home and top-level profile navigation menus.

### Scope

- Convert profile summary/home controls to V2 containers.
- Preserve profile visibility and ownership semantics.

### Acceptance Criteria

- Profile view and nav controls are V2-complete.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-19 - Profile Edit, Specialization, and Decor Navigation Migration

### Goal

Migrate profile edit/tagline/name/specialization/decor entry surfaces.

### Scope

- Convert edit and specialization menu scenes.
- Preserve modal submit flows where required.

### Acceptance Criteria

- Profile edit and specialization flows are V2-compatible.
- Ownership and profanity validations remain unchanged.

### Dependencies

- NSB-V2-18.

---

## NSB-V2-20 - Quests, Daily, Claim, Vote Rewards Menu Migration

### Goal

Migrate all quest-centric pages in `noodle.js` and `noodleQuests.js`.

### Scope

- Convert quests paging, daily claim, quest claim, vote rewards, vote claim surfaces.
- Preserve cross-server vote status lookups and claim safeguards.

### Acceptance Criteria

- Quests and vote-reward loops are V2-complete.
- Page navigation and claim actions are concise and non-repetitive.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-21 - Info Menus Migration (Help/News/About/Season/Event/Recipes/Regulars)

### Goal

Migrate informational menu surfaces and pagers to V2 containers.

### Scope

- Convert help pages, news/about/season/event tabs, recipes, regulars.
- Preserve unread-news indicator behavior.

### Acceptance Criteria

- Informational menus are V2-complete and succinct.
- No duplicate navigation buttons for equivalent actions.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-22 - Social Home and Leaderboard Menu Migration

### Goal

Migrate social landing pages and leaderboard menus in `noodleSocial.js`.

### Scope

- Convert social main rows and server/global leaderboard pagers.
- Preserve existing filters and pagination logic.

### Acceptance Criteria

- Social home and leaderboard flows are V2-complete.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-23 - Party Lifecycle Menu Migration

### Goal

Migrate party create/join/view/leader-transfer/kick/invite/status/menu surfaces.

### Scope

- Convert all party lifecycle embeds and action rows.
- Preserve permission checks and party integrity checks.

### Acceptance Criteria

- Party lifecycle is V2-complete and owner-safe.
- Transition messaging stays minimal and clear.

### Dependencies

- NSB-V2-22.

---

## NSB-V2-24 - Tips, Blessings, and Social Stats Menu Migration

### Goal

Migrate tips, blessings, and social stats surfaces.

### Scope

- Convert tip and blessing result/status menus.
- Convert social stats displays.

### Acceptance Criteria

- Tips/blessings/stats flows are V2-complete.

### Dependencies

- NSB-V2-22.

---

## NSB-V2-25 - Shared Order Menu Migration (Create/Contribute/Complete/Cancel)

### Goal

Migrate all shared-order flows in social module.

### Scope

- Convert shared-order recipe picker, contribution menus, confirmations, completion/cancel states.
- Preserve party role and readiness checks.

### Acceptance Criteria

- Shared-order flow is fully V2 and functionally equivalent.

### Dependencies

- NSB-V2-23.

---

## NSB-V2-26 - Staff Command Menu Migration

### Goal

Migrate all staff command embeds/menus in `noodleStaff.js`.

### Scope

- Convert staff management, level-up selection, refresh actions.
- Preserve slot/cap and level-up validation behavior.

### Acceptance Criteria

- Staff command interactions are V2-complete.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-27 - Upgrades Command Menu Migration

### Goal

Migrate all upgrade command embeds/menus in `noodleUpgrades.js`.

### Scope

- Convert upgrade category selection, upgrade action rows, and related back-nav surfaces.
- Preserve affordability, unlock, and progression logic.

### Acceptance Criteria

- Upgrades command interactions are V2-complete.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-28 - Decor Command Module Migration

### Goal

Migrate `noodleDecor.js` embed/menu surfaces.

### Scope

- Convert owned/equipped/sets/shop decor displays to container scenes.
- Align with profile/decor navigation expectations.

### Acceptance Criteria

- Decor module surfaces are V2-complete or intentionally deprecated with replacement paths.

### Dependencies

- NSB-V2-19.

---

## NSB-V2-29 - Dev Command UI Migration (`/noodle-dev`)

### Goal

Migrate dev status/dashboard/menu surfaces for test-bot operations.

### Scope

- Convert dev dashboard pages and server pagination controls.
- Preserve owner gating and official-guild restrictions.

### Acceptance Criteria

- Dev dashboard/status flows are V2-compatible in test environments.

### Dependencies

- NSB-V2-04.

---

## NSB-V2-30 - Scheduled DM Reminder Card Migration

### Goal

Migrate daily reminder DM card/button interaction surfaces to V2-compatible containers.

### Scope

- Convert reminder message layout and reminder-toggle interaction UI.
- Preserve opt-out state behavior.

### Acceptance Criteria

- Reminder card interaction works in test and production paths.

### Dependencies

- NSB-V2-01.

---

## NSB-V2-31 - Comprehensive Test Suite and Review Hardening

### Goal

Ensure full-scope migration passes review checks and blocks regression.

### Scope

- Add scene render snapshot tests for all shipped V2 scene families.
- Add routing tests for all `noodle:v2:*` actions.
- Add stale/owner mismatch tests for every migrated module.
- Keep existing suite green.
- Add mandatory tutorial parity suite for every feature-flag rollout phase.

### Acceptance Criteria

- `npm run lint`, `npm test`, and `npm run review:guard` pass.
- New tests cover all migrated modules.
- CI required checks block merges on failure.
- Tutorial-focused suites (routing, major actions, reset/replay) pass before enabling V2 for tutorial users.

### Dependencies

- NSB-V2-01 through NSB-V2-30.

---

## NSB-V2-32 - Telemetry and UX Efficiency Reporting

### Goal

Provide data-backed migration validation for efficiency and user experience.

### Scope

- Add V2 telemetry events for scene transitions/errors by module.
- Track click count per loop, loop completion time, minigame outcome distribution.
- Publish baseline vs V2 comparison report.

### Acceptance Criteria

- Metrics available in telemetry logs for test sessions.
- Go/no-go recommendation references quantified improvements/regressions.

### Dependencies

- NSB-V2-05 through NSB-V2-31.

---

## NSB-V2-33 - Production Cutover and Legacy Cleanup

### Goal

Roll out V2 safely and remove redundant V1-only UI pathways when stable.

### Scope

- Production rollout checklist and staged enablement.
- Rollback drill validation.
- Remove or freeze obsolete legacy UI code after acceptance period.

### Acceptance Criteria

- Cutover completed with rollback readiness.
- Legacy cleanup is deliberate and reviewed.
- Final migration summary links all issue evidence.

### Dependencies

- NSB-V2-01 through NSB-V2-32.

---

## Global Non-Repetition and Simplicity Rules

- Use shared scene renderer helpers, do not duplicate container layout logic.
- Use shared custom ID parsing utilities, do not split/parse ad hoc in handlers.
- Reuse existing domain/game functions; UI layer orchestrates and never reimplements business logic.
- Keep one authoritative scene/action registry in code.
- Keep scene messaging short and singular: one primary instruction and one concise status block.
- Do not render duplicate action buttons with identical outcomes in the same scene.

## Global Definition of Done

- Meets acceptance criteria for the issue.
- No duplicated business logic introduced.
- New tests added and passing.
- Existing tests unchanged unless intentionally migrated.
- Reviewer can trace scene/action behavior from registry and tests quickly.
