import test from "node:test";
import assert from "node:assert/strict";
import { newPlayerProfile } from "../src/game/player.js";
import { addSeeds, harvestGardenPlots, plantSeedInPlot } from "../src/game/garden.js";
import { recordKitchenBrothServings } from "../src/game/kitchen.js";

test("Garden achievements count collected seeds, planted plots, and vegetable/herb harvests", () => {
  const player = newPlayerProfile("garden-achievement-user");
  const now = 1_000;
  addSeeds(player, { scallions: 100 });
  player.garden.compost_bags = 1;

  const planted = plantSeedInPlot(player, "scallions", { items: {} }, {}, { now });
  assert.equal(planted.ok, true);
  assert.equal(player.lifetime.garden_plots_planted, 1);

  const harvested = harvestGardenPlots(player, { items: {} }, {}, {
    plotIndex: planted.plotIndex,
    now: planted.harvestReadyAt
  });
  assert.equal(harvested.added.scallions, 5);
  assert.equal(player.lifetime.garden_items_harvested, 5);
  assert.equal(player.lifetime.garden_seeds_collected, 100);
});

test("Kitchen simmer achievement progress counts only completed collected broth servings", () => {
  const player = newPlayerProfile("kitchen-achievement-user");
  assert.equal(recordKitchenBrothServings(player, 0), 0);
  assert.equal(recordKitchenBrothServings(player, 3), 3);
  assert.equal(recordKitchenBrothServings(player, 2.9), 5);
});
