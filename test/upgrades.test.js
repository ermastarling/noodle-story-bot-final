import { test } from "node:test";
import assert from "node:assert";
import {
  calculateUpgradeCost,
  purchaseUpgrade,
  calculateUpgradeEffects,
  getUpgradesByCategory,
  applyCookingSpeedBonus,
  applyReputationBonus,
  applyCooldownReduction,
  getTotalBowlCapacity,
  applyMarketDiscount
} from "../src/game/upgrades.js";
import { loadUpgradesContent } from "../src/content/index.js";

const upgradesContent = loadUpgradesContent();

function makeTestPlayer() {
  return {
    user_id: "test-user",
    coins: 5000,
    upgrades: {
      u_prep: 0,
      u_stoves: 0,
      u_ladles: 0,
      u_pantry: 0,
      u_cold_cellar: 0,
      u_secure_crates: 0,
      u_seating: 0,
      u_hospitality: 0,
      u_lantern: 0,
      u_decor: 0,
      u_staff_quarters: 0,
      u_manuals: 0
    }
  };
}

test("Upgrades: calculateUpgradeCost returns correct cost", () => {
  const upgrade = upgradesContent.upgrades.u_prep;
  
  const cost0 = calculateUpgradeCost(upgrade, 0);
  assert.strictEqual(cost0, 200); // Base cost
  
  const cost1 = calculateUpgradeCost(upgrade, 1);
  assert.ok(cost1 > cost0); // Cost increases
  
  const cost5 = calculateUpgradeCost(upgrade, 5);
  assert.ok(cost5 > cost1); // Cost continues to increase
});

test("Upgrades: calculateUpgradeCost returns 0 at max level", () => {
  const upgrade = upgradesContent.upgrades.u_prep;
  const cost = calculateUpgradeCost(upgrade, upgrade.max_level);
  
  assert.strictEqual(cost, 0);
});

test("Upgrades: purchaseUpgrade succeeds when conditions met", () => {
  const player = makeTestPlayer();
  player.coins = 500;
  
  const result = purchaseUpgrade(player, "u_prep", upgradesContent);
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.upgrades.u_prep, 1);
  assert.ok(player.coins < 500); // Coins deducted
});

test("Upgrades: purchaseUpgrade fails when insufficient coins", () => {
  const player = makeTestPlayer();
  player.coins = 50;
  
  const result = purchaseUpgrade(player, "u_prep", upgradesContent);
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(player.upgrades.u_prep, 0);
  assert.strictEqual(player.coins, 50); // No change
});

test("Upgrades: purchaseUpgrade fails at max level", () => {
  const player = makeTestPlayer();
  player.coins = 999999;
  player.upgrades.u_prep = 20; // Max level
  
  const result = purchaseUpgrade(player, "u_prep", upgradesContent);
  
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes("max level"));
});

test("Upgrades: purchaseUpgrade cost increases with each level", () => {
  const player = makeTestPlayer();
  player.coins = 999999;
  
  const result1 = purchaseUpgrade(player, "u_prep", upgradesContent);
  const cost1 = result1.cost;
  
  const result2 = purchaseUpgrade(player, "u_prep", upgradesContent);
  const cost2 = result2.cost;
  
  assert.ok(cost2 > cost1);
});

test("Upgrades: calculateUpgradeEffects aggregates multiple upgrades", () => {
  const player = makeTestPlayer();
  player.upgrades.u_prep = 5;
  player.upgrades.u_stoves = 3;
  player.upgrades.u_seating = 2;
  
  const effects = calculateUpgradeEffects(player, upgradesContent);
  
  assert.ok(effects.cooking_speed_bonus > 0);
  assert.ok(effects.ingredient_save_chance > 0);
  assert.ok(effects.rep_bonus_flat > 0);
});

test("Upgrades: calculateUpgradeEffects scales with level", () => {
  const player = makeTestPlayer();
  
  player.upgrades.u_prep = 1;
  const effects1 = calculateUpgradeEffects(player, upgradesContent);
  const speed1 = effects1.cooking_speed_bonus;
  
  player.upgrades.u_prep = 5;
  const effects5 = calculateUpgradeEffects(player, upgradesContent);
  const speed5 = effects5.cooking_speed_bonus;
  
  assert.ok(speed5 > speed1);
  assert.ok(Math.abs(speed5 - speed1 * 5) < 0.01); // Should be ~5x
});

test("Upgrades: getUpgradesByCategory groups correctly", () => {
  const player = makeTestPlayer();
  const categories = getUpgradesByCategory(player, upgradesContent);
  
  assert.ok(categories.kitchen);
  assert.ok(categories.storage);
  assert.ok(categories.service);
  assert.ok(categories.ambience);
  assert.ok(categories.staff);
  
  assert.ok(categories.kitchen.upgrades.length > 0);
});

test("Upgrades: getUpgradesByCategory shows current level and cost", () => {
  const player = makeTestPlayer();
  player.upgrades.u_prep = 5;
  
  const categories = getUpgradesByCategory(player, upgradesContent);
  const prepUpgrade = categories.kitchen.upgrades.find(u => u.upgradeId === "u_prep");
  
  assert.strictEqual(prepUpgrade.currentLevel, 5);
  assert.ok(prepUpgrade.nextCost > 0);
  assert.strictEqual(prepUpgrade.isMaxed, false);
});

test("Upgrades: applyCookingSpeedBonus increases value", () => {
  const baseValue = 100;
  const effects = { cooking_speed_bonus: 0.20 }; // 20% bonus
  
  const result = applyCookingSpeedBonus(baseValue, effects);
  
  assert.strictEqual(result, 120);
});

test("Upgrades: applyReputationBonus adds flat and percent", () => {
  const baseRep = 10;
  const effects = {
    rep_bonus_flat: 2,
    rep_bonus_percent: 0.10 // 10%
  };
  
  const result = applyReputationBonus(baseRep, effects);
  
  // (10 + 2) * 1.10 = 13.2 -> 13
  assert.strictEqual(result, 13);
});

test("Upgrades: applyReputationBonus adds rare/epic bonus", () => {
  const baseRep = 10;
  const effects = {
    rep_bonus_flat: 0,
    rep_bonus_percent: 0,
    rare_epic_rep_bonus: 5
  };
  
  const resultRare = applyReputationBonus(baseRep, effects, "rare");
  assert.strictEqual(resultRare, 15);
  
  const resultEpic = applyReputationBonus(baseRep, effects, "epic");
  assert.strictEqual(resultEpic, 15);
  
  const resultCommon = applyReputationBonus(baseRep, effects, "common");
  assert.strictEqual(resultCommon, 10); // No bonus
});

test("Upgrades: applyCooldownReduction decreases cooldown", () => {
  const baseCooldown = 10000; // 10 seconds
  const effects = { cooldown_reduction: 0.10 }; // 10% reduction
  
  const result = applyCooldownReduction(baseCooldown, effects);
  
  assert.strictEqual(result, 9000);
});

test("Upgrades: getTotalBowlCapacity adds bonus", () => {
  const baseCapacity = 10;
  const effects = { bowl_capacity_bonus: 5 };
  
  const result = getTotalBowlCapacity(baseCapacity, effects);
  
  assert.strictEqual(result, 15);
});

test("Upgrades: applyMarketDiscount reduces price", () => {
  const basePrice = 100;
  const effects = { market_discount: 0.08 }; // 8% discount
  
  const result = applyMarketDiscount(basePrice, effects);
  
  assert.strictEqual(result, 92);
});

test("Upgrades: storage upgrades increase capacity significantly", () => {
  const player = makeTestPlayer();
  player.upgrades.u_pantry = 10; // 10 levels
  
  const effects = calculateUpgradeEffects(player, upgradesContent);
  
  assert.strictEqual(effects.ingredient_capacity, 50); // 10 * 5
});

test("Upgrades: staff upgrades affect multipliers", () => {
  const player = makeTestPlayer();
  player.upgrades.u_staff_quarters = 4;
  player.upgrades.u_manuals = 5;
  
  const effects = calculateUpgradeEffects(player, upgradesContent);
  
  assert.ok(effects.staff_capacity > 0);
  assert.ok(effects.staff_effect_multiplier > 0);
});
