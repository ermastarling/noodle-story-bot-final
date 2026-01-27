import { test } from "node:test";
import assert from "node:assert";
import {
  detectDeadlock,
  applyFallbackRecipeAccess,
  applyEmergencyGrant,
  getFailStreakBonuses,
  consumeFailStreakRelief,
  updateFailStreak,
  checkRepFloorBonus,
  applyRepFloorBonus,
  getPityDiscount,
  getAvailableRecipes,
  clearTemporaryRecipes,
  FALLBACK_RECIPE_ID,
  FAIL_STREAK_TRIGGER,
  EMERGENCY_GRANT
} from "../src/game/resilience.js";

test("B1: detectDeadlock - returns false when player has coins", () => {
  const player = { coins: 10, known_recipes: [], inv_ingredients: {} };
  const serverState = { market_prices: {} };
  const content = { recipes: {} };
  
  assert.strictEqual(detectDeadlock(player, serverState, content), false);
});

test("B1: detectDeadlock - returns true when truly deadlocked", () => {
  const player = { 
    coins: 0, 
    known_recipes: ["test_recipe"], 
    inv_ingredients: {} 
  };
  const serverState = { market_prices: { item1: 10 } };
  const content = { 
    recipes: { 
      test_recipe: { 
        ingredients: [{ item_id: "missing_item", qty: 1 }] 
      } 
    } 
  };
  
  assert.strictEqual(detectDeadlock(player, serverState, content), true);
});

test("B1: detectDeadlock - returns false when player can cook", () => {
  const player = { 
    coins: 0, 
    known_recipes: ["test_recipe"], 
    inv_ingredients: { item1: 5 } 
  };
  const serverState = { market_prices: { item2: 10 } };
  const content = { 
    recipes: { 
      test_recipe: { 
        ingredients: [{ item_id: "item1", qty: 1 }] 
      } 
    } 
  };
  
  assert.strictEqual(detectDeadlock(player, serverState, content), false);
});

test("B2: applyFallbackRecipeAccess - grants temporary recipe on first call", () => {
  const player = { known_recipes: ["other_recipe"], resilience: {} };
  const content = { recipes: { [FALLBACK_RECIPE_ID]: { name: "Simple Broth" } } };
  
  const result = applyFallbackRecipeAccess(player, content);
  
  assert.strictEqual(result.granted, true);
  assert.ok(result.message.includes("Rescue Mode"));
  assert.ok(player.resilience.temp_recipes.includes(FALLBACK_RECIPE_ID));
});

test("B2: applyFallbackRecipeAccess - doesn't grant if already known", () => {
  const player = { known_recipes: [FALLBACK_RECIPE_ID], resilience: {} };
  const content = { recipes: { [FALLBACK_RECIPE_ID]: { name: "Simple Broth" } } };
  
  const result = applyFallbackRecipeAccess(player, content);
  
  assert.strictEqual(result.granted, false);
});

test("B3: applyEmergencyGrant - grants ingredients once per day", () => {
  const player = { inv_ingredients: {}, resilience: {} };
  
  const result = applyEmergencyGrant(player);
  
  assert.strictEqual(result.granted, true);
  assert.ok(result.message.includes("Emergency Supplies"));
  assert.strictEqual(player.inv_ingredients.broth_soy, EMERGENCY_GRANT.broth_soy);
  assert.strictEqual(player.inv_ingredients.noodles_wheat, EMERGENCY_GRANT.noodles_wheat);
  assert.ok(player.resilience.last_rescue_at > 0);
});

test("B4: updateFailStreak - increments on failure", () => {
  const player = { buffs: { fail_streak: 0 } };
  
  updateFailStreak(player, false); // failure
  
  assert.strictEqual(player.buffs.fail_streak, 1);
});

test("B4: updateFailStreak - resets on success", () => {
  const player = { buffs: { fail_streak: 2 } };
  
  updateFailStreak(player, true); // success
  
  assert.strictEqual(player.buffs.fail_streak, 0);
});

test("B4: updateFailStreak - grants relief after trigger threshold", () => {
  const player = { buffs: { fail_streak: FAIL_STREAK_TRIGGER - 1 } };
  
  updateFailStreak(player, false); // failure that triggers relief
  
  assert.strictEqual(player.buffs.fail_streak, 0);
  assert.strictEqual(player.buffs.fail_streak_relief, 2);
});

test("B4: getFailStreakBonuses - returns bonuses when relief active", () => {
  const player = { buffs: { fail_streak_relief: 2 } };
  
  const bonuses = getFailStreakBonuses(player);
  
  assert.strictEqual(bonuses.active, true);
  assert.strictEqual(bonuses.cook_fail_reduction, 0.03);
  assert.strictEqual(bonuses.spoilage_chance_reduction, 0.01);
  assert.strictEqual(bonuses.quality_floor, "standard");
});

test("B4: consumeFailStreakRelief - decrements relief counter", () => {
  const player = { buffs: { fail_streak_relief: 2 } };
  
  consumeFailStreakRelief(player);
  
  assert.strictEqual(player.buffs.fail_streak_relief, 1);
  
  consumeFailStreakRelief(player);
  
  assert.strictEqual(player.buffs.fail_streak_relief, 0);
});

test("B7: checkRepFloorBonus - eligible when rep is at floor", () => {
  const player = { rep: 0, buffs: {} };
  
  const result = checkRepFloorBonus(player);
  
  assert.strictEqual(result.eligible, true);
  assert.strictEqual(player.buffs.rep_floor_bonus, true);
});

test("B7: applyRepFloorBonus - returns +1 and clears flag", () => {
  const player = { buffs: { rep_floor_bonus: true } };
  
  const bonus = applyRepFloorBonus(player);
  
  assert.strictEqual(bonus, 1);
  assert.strictEqual(player.buffs.rep_floor_bonus, false);
});

test("getAvailableRecipes - includes permanent and temporary recipes", () => {
  const player = {
    known_recipes: ["recipe1", "recipe2"],
    resilience: { temp_recipes: ["temp_recipe1"] }
  };
  
  const available = getAvailableRecipes(player);
  
  assert.ok(available.includes("recipe1"));
  assert.ok(available.includes("recipe2"));
  assert.ok(available.includes("temp_recipe1"));
});

test("clearTemporaryRecipes - clears temp recipes when player has coins", () => {
  const player = {
    coins: 10,
    resilience: { temp_recipes: ["temp_recipe1"] }
  };
  
  clearTemporaryRecipes(player);
  
  assert.strictEqual(player.resilience.temp_recipes.length, 0);
});

test("clearTemporaryRecipes - keeps temp recipes when player has no coins", () => {
  const player = {
    coins: 0,
    resilience: { temp_recipes: ["temp_recipe1"] }
  };
  
  clearTemporaryRecipes(player);
  
  assert.strictEqual(player.resilience.temp_recipes.length, 1);
});
