# Components V2 Migration Architecture

## Purpose

Define the production-ready architecture for migrating from legacy embed + button rows to Discord Components V2 container-first UI, with a deterministic cook minigame that is user-friendly, review-safe, and maintainable.

## Non-Negotiable Constraints

- Components V2 messages must use the `IS_COMPONENTS_V2` flag.
- Components V2 messages cannot rely on legacy `content` + `embeds` payload style.
- Existing legacy component IDs must continue to work during migration.
- Main gameplay logic remains in game/domain modules during UI migration.
- Every new UI flow must be owner-locked and stale-safe.
- Tutorial progression semantics and gate behavior must remain identical between V1 and V2 during migration.

## Tutorial Safety Requirements

- Keep tutorial source-of-truth in existing tutorial modules and routing rules; V2 scenes may orchestrate UI only.
- Preserve step order and completion events: `accept -> buy -> forage -> cook -> serve`.
- Preserve centralized gate evaluation (`resolveTutorialGateValue`, `resolveTutorialProgressRowKey`, and nav dispatch tutorial overrides).
- Preserve tutorial-specific behavior in cook flow (including intro-cook failure disable behavior) until intentional redesign is approved.
- Preserve tutorial replay/reset behavior and `/noodle-dev reset_tutorial` operational safety.
- V2 fallback behavior for tutorial users: if a V2 scene/token fails, recover to a valid tutorial-safe entry scene, not a generic non-tutorial menu.

## Tutorial Rollout Rules

- Phase 1: tutorial users are eligible for V2 by default when Components V2 is enabled, unless explicitly disabled with `NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED=0`.
- Phase 2: enable V2 tutorial for internal testers only after parity tests pass.
- Phase 3: enable V2 tutorial for test guild after monitored validation window.
- Production tutorial cutover requires explicit signoff with tutorial regression suite green.

## Design Goals

- Efficient: low click count and no duplicate screens.
- Non-repetitive: shared scene rendering helpers and shared action dispatch.
- User-friendly: clear labels, consistent row structure, explicit next actions.
- Simplicity-first messaging: each scene should use short, direct copy with one primary instruction and no repeated status lines.
- Button minimalism: avoid repeating equivalent buttons across rows; each action appears once per scene unless state changes.
- Maintainable: versioned custom IDs, scene state machine, compatibility layer.
- Review-ready: clear acceptance criteria and regression tests per flow.

## V2 UI Model

### Screen Primitive

Each screen is a **scene**.

Each scene has:

- `sceneId`: stable key.
- `render(ctx)`: returns container components payload.
- `actions`: allowed action keys for this scene.
- `transition(action, ctx)`: returns next scene + domain side effects.

### Shared Scene Context

- `userId`
- `serverId`
- `messageId`
- `token` (state token)
- `playerSnapshotVersion`
- `expiresAt`

## Exact Scene Map (V2)

### Main Loop Scenes

1. `orders.board`
- Purpose: primary gameplay hub for accepted/available orders.
- Entry from: `/noodle orders`, nav back, post-results.
- Actions:
  - `orders.open_accept`
  - `orders.open_cook`
  - `orders.open_serve`
  - `orders.quick_serve_ready`
  - `orders.refresh`
  - `nav.main`
- Inline serve rule:
  - When accepted orders include at least one recipe with ready cooked bowls, render an inline **Serve Ready** action next to that accepted-order row within the orders board container.
  - If no accepted order is currently serveable, hide inline serve actions and keep only top-level serve navigation.

2. `orders.accept_picker`
- Purpose: multi-select available orders to accept.
- Entry from: `orders.board`.
- Actions:
  - `accept.pick_orders`
  - `accept.confirm`
  - `accept.cancel`
  - `orders.back_board`

3. `orders.accept_result`
- Purpose: summarize accepted orders and shortages.
- Entry from: `orders.accept_picker` confirm.
- Actions:
  - `orders.open_cook`
  - `orders.open_serve`
  - `orders.back_board`

4. `cook.recipe_picker`
- Purpose: select recipe and quantity source for cook flow.
- Entry from: `orders.board`, `orders.accept_result`.
- Actions:
  - `cook.pick_recipe`
  - `cook.set_qty`
  - `cook.start_minigame`
  - `cook.cancel`
  - `orders.back_board`

5. `cook.minigame`
- Purpose: interactive cook skill game.
- Entry from: `cook.recipe_picker`.
- Actions:
  - `minigame.choose_action`
  - `minigame.commit_turn`
  - `minigame.finish`
  - `minigame.abort`

6. `cook.result`
- Purpose: show bowls produced, quality, and penalties.
- Entry from: `cook.minigame` finish.
- Actions:
  - `orders.open_serve`
  - `cook.retry_same_recipe`
  - `orders.back_board`

7. `serve.order_picker`
- Purpose: pick accepted orders to serve now.
- Entry from: `orders.board`, `cook.result`.
- Actions:
  - `serve.pick_orders`
  - `serve.confirm`
  - `serve.cancel`
  - `orders.back_board`

8. `serve.result`
- Purpose: show rewards/discovery/level outcomes.
- Entry from: `serve.order_picker` confirm.
- Actions:
  - `orders.open_accept`
  - `orders.open_cook`
  - `orders.back_board`

### Secondary Scenes (Phase 2)

9. `market.buy`
- Actions: `buy.pick_items`, `buy.qty_1`, `buy.qty_5`, `buy.qty_10`, `buy.confirm`, `nav.main`

10. `pantry.view`
- Actions: `pantry.page_prev`, `pantry.page_next`, `orders.open_cook`, `nav.main`

11. `profile.view`
- Actions: `profile.open_edit`, `profile.open_quests`, `profile.open_news`, `nav.main`

## Best Cook Minigame for Container Menus

## Selected Model: "Kitchen Line" (Turn-Based Station Control)

Why this is the best fit:

- Works reliably with Discord latency (no twitch timing dependency).
- Easy to read and play on mobile and desktop.
- Uses buttons/selects cleanly inside containers.
- Deterministic, testable, and simple to review.

### Core Loop

- Player chooses recipe + quantity.
- Minigame runs for `N` turns (default 4).
- Each turn presents 3 station actions:
  - `Stir`
  - `Heat`
  - `Season`
- Game tracks three meters (0-100):
  - `brothBalance`
  - `heatBalance`
  - `flavorBalance`
- Goal: keep each meter inside target range by final turn.

### Skill to Outcome Mapping (No Random Failures)

Given requested bowls `Q`:

- `perfectTurns`: turns where all three meters remain in range.
- `majorMistakes`: turns ending with any meter out of critical bounds.

Outcome:

- `successBowls = max(0, Q - majorMistakes)`
- `failBowls = Q - successBowls`
- `qualityTier` from score:
  - score >= 90: excellent bias
  - score >= 75: good bias
  - else: standard/salvage bias

This replaces RNG failure with player-driven failure.

### Upgrade Integration

- Existing upgrades/staff can modify minigame tolerances, not hidden RNG.
- Example modifiers:
  - wider safe zone
  - one free mistake guard
  - +1 starting meter stability

### Accessibility and UX

- Single primary action row per turn.
- Optional secondary row for `Undo Last` (once per game) and `Finish Early`.
- Clear text indicators in container fields:
  - meter values
  - safe range
  - turns left
  - projected bowl outcome

## Custom ID Schema (Exact)

## Canonical Format

`noodle:v2:<sceneKey>:<actionKey>:<ownerId>:<token>[:<arg1>[:<arg2>]]`

Rules:

- `sceneKey` uses full scene keys (for example `orders.board`, `cook.recipe_picker`, `serve.order_picker`).
- `actionKey` is a short stable key for the scene.
- `ownerId` required for owner lock.
- `token` required for scene-state lookup.
- max length must remain under Discord custom ID limits.
- arguments are optional compact scalars.

## Exact Scene Keys

- `orders.board`
- `orders.accept_picker`
- `orders.accept_result`
- `orders.cancel_picker`
- `cook.recipe_picker`
- `cook.minigame`
- `cook.result`
- `serve.order_picker`
- `serve.result`

## Exact Action Keys

### Orders Board (`orders.board`)

- `acc` open accept picker
- `ck` open cook picker
- `sv` open serve picker
- `fg` open forage action
- `qs` open quests action
- `rf` refresh
- `nm` nav main
- `buy` open market buy
- `pn` open pantry
- `cnl` open cancel picker
- `tk` open takeout

### Accept Picker (`orders.accept_picker`)

- `sel` select order(s)
- `cfm` confirm accept
- `pg` paginate
- `cnl` cancel
- `bk` back

### Cook Recipe Picker (`cook.recipe_picker`)

- `sel` pick recipe
- `qty` set quantity
- `pg` paginate
- `go` start minigame
- `cfa` cook all
- `bk` back

### Cook Minigame (`cook.minigame`)

- `prep` choose prep action
- `heat` choose heat action
- `plate` choose plate action
- `serve` commit turn
- `bk` abort/back

### Cook Result (`cook.result`)

- `ord` open orders board
- `cook` retry cook flow
- `serve` open serve picker
- `nxt` tutorial next

### Serve Picker (`serve.order_picker`)

- `sel` select accepted order(s)
- `cfm` confirm serve
- `sfa` serve all
- `bk` back

### Serve Result (`serve.result`)

- `ord` open orders board
- `cook` open cook picker
- `again` repeat serve loop

## Custom ID Examples

- `noodle:v2:orders.board:ck:123456789012345678:tA91f2`
- `noodle:v2:cook.recipe_picker:qty:123456789012345678:tA91f2:5`
- `noodle:v2:cook.minigame:heat:123456789012345678:tCook77`
- `noodle:v2:serve.order_picker:cfm:123456789012345678:tServe45`

## Scene State Store Contract

State key: `<ownerId>:<token>`

Stored payload:

- `sceneKey`
- `serverId`
- `userId`
- `expiresAt`
- `data` (scene-specific)

Minimum TTL:

- 10 minutes for picker/result scenes
- 5 minutes for minigame scene

On stale token:

- return ephemeral stale message and one-click action to reopen scene from `orders.board`.

## Migration Strategy

1. Add V2 scene router and ID parser.
2. Keep legacy router active.
3. Migrate `orders.board` + `orders.accept_picker` first.
4. Migrate `cook.recipe_picker` + `cook.minigame`.
5. Migrate `serve.order_picker` + results.
6. Remove legacy flow only after parity tests and telemetry checks pass.

## Review and Quality Gates

- No gameplay logic duplication between V1 and V2.
- All V2 scenes tested for owner mismatch and stale state.
- Every scene has a deterministic `render` snapshot test.
- Minigame outcome mapping has unit tests for edge boundaries.
- Tutorial regression suite must pass before each V2 feature-flag expansion.
- Lint/tests/review guard must pass before merge.
