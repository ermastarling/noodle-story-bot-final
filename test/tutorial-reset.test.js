import { strict as assert } from "assert";
import { test } from "node:test";

import { newPlayerProfile } from "../src/game/player.js";
import { advanceTutorial, getCurrentTutorialStep, resetTutorialProgress } from "../src/game/tutorial.js";

test("Tutorial reset: keeps inventory and core progress data", () => {
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

  const before = {
    coins: player.coins,
    knownRecipes: [...player.known_recipes],
    invIngredients: JSON.parse(JSON.stringify(player.inv_ingredients)),
    invBowls: JSON.parse(JSON.stringify(player.inv_bowls))
  };

  resetTutorialProgress(player);

  // Tutorial is restarted from the first step.
  const step = getCurrentTutorialStep(player);
  assert.equal(player.tutorial?.active, true);
  assert.equal(step?.id, "intro_order");

  // Order flow is reset so tutorial can start cleanly.
  assert.deepEqual(player.orders?.accepted ?? {}, {});
  assert.equal(player.orders_day, null);
  assert.equal(player.orders_seed, null);
  assert.equal(player.orders_pool_sig, null);
  assert.deepEqual(player.orders_consumed_indices, []);
  assert.equal(player.orders_total_count, 0);
  assert.equal(player.orders_depleted_day, null);

  // Unrelated player data remains untouched.
  assert.equal(player.coins, before.coins);
  assert.deepEqual(player.known_recipes, before.knownRecipes);
  assert.deepEqual(player.inv_ingredients, before.invIngredients);
  assert.deepEqual(player.inv_bowls, before.invBowls);
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
