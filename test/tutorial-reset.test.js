import { strict as assert } from "assert";
import { test } from "node:test";

import { newPlayerProfile } from "../src/game/player.js";
import { getOrdersMeta } from "../src/game/orders.js";
import { advanceTutorial, getCurrentTutorialStep, resetTutorialProgress } from "../src/game/tutorial.js";
import { getOrderAcceptCap, ORDER_ACCEPT_CAP_BASE } from "../src/game/subscriptions.js";

test("Tutorial reset: resets only tutorial state and preserves all other profile data", () => {
  const player = newPlayerProfile("user1");

  // Simulate a progressed profile with custom state.
  player.coins = 4321;
  player.known_recipes = ["classic_soy_ramen", "veggie_miso_bowl", "spicy_tonkotsu_bowl"];
  player.inv_ingredients = {
    scallions: 7,
    soy_broth: 4,
    wheat_noodles: 9
  };
  player.inv_bowls = {
    classic_soy_ramen: 2
  };

  player.tutorial = {
    active: false,
    queue: [],
    completed: ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"]
  };

  player.orders = {
    accepted: {
      ODR123: { order: { recipe_id: "classic_soy_ramen" } }
    },
    seasonal_served_today: 3,
    epic_served_today: 1
  };
  player.orders_day = "2026-04-08";
  player.orders_seed = "s1-u1-day-2026-04-08";
  player.orders_pool_sig = "pool-signature";
  player.orders_consumed_indices = [0, 2, 4];
  player.orders_total_count = 8;
  player.orders_depleted_day = "2026-04-08";

  const before = structuredClone(player);
  delete before.tutorial;

  resetTutorialProgress(player);

  // Tutorial is restarted from the first step.
  const step = getCurrentTutorialStep(player);
  assert.equal(player.tutorial?.active, true);
  assert.equal(step?.id, "intro_order");
  assert.equal(getOrdersMeta(player).availableCount, 1);
  assert.equal(getOrdersMeta(player).tutorialReplayAvailable, true);

  const after = structuredClone(player);
  delete after.tutorial;
  assert.deepEqual(after, before);
});

test("Tutorial reset: preserved accepted orders do not block the intro accept step", () => {
  const player = newPlayerProfile("user-full-orders");
  player.known_recipes = ["classic_soy_ramen"];
  player.orders = {
    accepted: Object.fromEntries(
      Array.from({ length: ORDER_ACCEPT_CAP_BASE }, (_, index) => [`ODR${index}`, { order: { recipe_id: "classic_soy_ramen" } }])
    )
  };
  player.tutorial = { active: false, queue: [], completed: ["intro_order"] };
  assert.equal(getOrderAcceptCap(player), ORDER_ACCEPT_CAP_BASE);

  resetTutorialProgress(player);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_order");
  assert.equal(getOrderAcceptCap(player), ORDER_ACCEPT_CAP_BASE + 1);
  assert.equal(Object.keys(player.orders.accepted).length, ORDER_ACCEPT_CAP_BASE);

  assert.equal(advanceTutorial(player, "accept").progressed, true);
  assert.equal(getOrderAcceptCap(player), ORDER_ACCEPT_CAP_BASE);
});

test("Tutorial reset: can replay full tutorial chain to completion", () => {
  const player = newPlayerProfile("user-replay");

  // Progress some steps, then reset and verify a full replay is possible.
  advanceTutorial(player, "accept");
  advanceTutorial(player, "buy");
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_forage");

  resetTutorialProgress(player);
  assert.equal(getCurrentTutorialStep(player)?.id, "intro_order");

  const sequence = ["accept", "buy", "forage", "cook", "serve"];
  let last = null;
  for (const eventName of sequence) {
    last = advanceTutorial(player, eventName);
    assert.equal(last.progressed, true);
  }

  assert.equal(last?.finished, true);
  assert.equal(player.tutorial?.active, false);
  assert.equal(getCurrentTutorialStep(player), null);
});
