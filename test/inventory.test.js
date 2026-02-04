import { test } from "node:test";
import assert from "node:assert";
import {
  ING_STACK_CAP_BASE,
  ING_STACK_CAP_PER_UPGRADE,
  BOWL_STACK_CAP_BASE,
  OVERFLOW_MODE,
  getIngredientStackCapacity,
  getBowlStackCapacity,
  checkIngredientCapacity,
  checkBowlCapacity,
  addIngredientsToInventory,
  removeIngredientsFromInventory,
  hasIngredients,
  addBowlToInventory,
  removeBowlFromInventory,
  getTotalBowlCount,
  getTotalIngredientCount,
  getInventoryStatus
} from "../src/game/inventory.js";

function makeTestPlayer(pantryLevel = 0) {
  return {
    user_id: "test-user",
    upgrades: {
      u_pantry: pantryLevel,
      u_cold_cellar: 0,
      u_secure_crates: 0
    },
    inv_ingredients: {},
    inv_bowls: {}
  };
}

// ========== Capacity Calculation Tests ==========

test("Inventory: getIngredientStackCapacity with no upgrades", () => {
  const player = makeTestPlayer(0);
  const capacity = getIngredientStackCapacity(player);
  assert.strictEqual(capacity, 40, "Base capacity should be 40");
});

test("Inventory: getIngredientStackCapacity with pantry upgrades", () => {
  const player = makeTestPlayer(5);
  const capacity = getIngredientStackCapacity(player);
  assert.strictEqual(capacity, 40 + (5 * 5), "Capacity should increase by 5 per upgrade");
});

test("Inventory: getBowlStackCapacity returns base capacity", () => {
  const player = makeTestPlayer(0);
  const capacity = getBowlStackCapacity(player);
  assert.strictEqual(capacity, 10, "Bowl capacity should be 10");
});

// ========== Capacity Check Tests ==========

test("Inventory: checkIngredientCapacity with empty inventory", () => {
  const player = makeTestPlayer(0);
  const check = checkIngredientCapacity(player, "scallions", 10);
  
  assert.strictEqual(check.canAdd, true, "Should be able to add items");
  assert.strictEqual(check.currentQty, 0, "Current quantity should be 0");
  assert.strictEqual(check.maxCapacity, 40, "Max capacity should be 40");
  assert.strictEqual(check.overflow, 0, "No overflow");
});

test("Inventory: checkIngredientCapacity at capacity limit", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 40;
  
  const check = checkIngredientCapacity(player, "scallions", 1);
  assert.strictEqual(check.canAdd, false, "Should not be able to add more");
  assert.strictEqual(check.overflow, 1, "Should have 1 overflow");
});

test("Inventory: checkIngredientCapacity with pantry upgrade", () => {
  const player = makeTestPlayer(2); // +10 capacity
  player.inv_ingredients["scallions"] = 45;
  
  const check = checkIngredientCapacity(player, "scallions", 5);
  assert.strictEqual(check.canAdd, true, "Should be able to add with upgrade");
  assert.strictEqual(check.maxCapacity, 50, "Capacity should be 50");
});

// ========== Add Ingredients Tests ==========

test("Inventory: addIngredientsToInventory in block mode", () => {
  const player = makeTestPlayer(0);
  const drops = { scallions: 10, carrots: 5 };
  
  const result = addIngredientsToInventory(player, drops, "block");
  
  assert.strictEqual(result.success, true, "Should succeed");
  assert.strictEqual(player.inv_ingredients.scallions, 10);
  assert.strictEqual(player.inv_ingredients.carrots, 5);
  assert.strictEqual(Object.keys(result.blocked).length, 0, "Nothing blocked");
});

test("Inventory: addIngredientsToInventory blocks overflow", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 38;
  
  const drops = { scallions: 5 }; // Would exceed capacity of 40
  const result = addIngredientsToInventory(player, drops, "block");
  
  assert.strictEqual(result.success, false, "Should fail");
  assert.strictEqual(player.inv_ingredients.scallions, 38, "Quantity unchanged");
  assert.strictEqual(result.blocked.scallions, 5, "All 5 blocked");
});

test("Inventory: addIngredientsToInventory truncate mode", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 38;
  
  const drops = { scallions: 5 }; // Would exceed capacity of 40
  const result = addIngredientsToInventory(player, drops, "truncate");
  
  assert.strictEqual(result.success, false, "Should fail (partial)");
  assert.strictEqual(player.inv_ingredients.scallions, 40, "Should add 2, reaching capacity");
  assert.strictEqual(result.added.scallions, 2, "Added 2");
  assert.strictEqual(result.blocked.scallions, 3, "Blocked 3");
});

test("Inventory: addIngredientsToInventory allow mode ignores capacity", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 38;
  
  const drops = { scallions: 10 }; // Would exceed capacity
  const result = addIngredientsToInventory(player, drops, "allow");
  
  assert.strictEqual(result.success, true, "Should succeed");
  assert.strictEqual(player.inv_ingredients.scallions, 48, "Should ignore capacity");
});

// ========== Remove Ingredients Tests ==========

test("Inventory: removeIngredientsFromInventory success", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 10;
  
  const result = removeIngredientsFromInventory(player, { scallions: 5 });
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.inv_ingredients.scallions, 5);
  assert.strictEqual(result.removed.scallions, 5);
});

test("Inventory: removeIngredientsFromInventory cleans up zero quantities", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 5;
  
  const result = removeIngredientsFromInventory(player, { scallions: 5 });
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.inv_ingredients.scallions, undefined, "Should be removed");
});

test("Inventory: removeIngredientsFromInventory insufficient items", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients["scallions"] = 3;
  
  const result = removeIngredientsFromInventory(player, { scallions: 5 });
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(player.inv_ingredients.scallions, 3, "Unchanged");
  assert.ok(result.insufficient.scallions, "Should have insufficient entry");
});

// ========== Has Ingredients Tests ==========

test("Inventory: hasIngredients with sufficient items", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients = { scallions: 10, carrots: 5 };
  
  const check = hasIngredients(player, { scallions: 5, carrots: 3 });
  
  assert.strictEqual(check.has, true);
  assert.strictEqual(Object.keys(check.missing).length, 0);
});

test("Inventory: hasIngredients with insufficient items", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients = { scallions: 3, carrots: 5 };
  
  const check = hasIngredients(player, { scallions: 5, carrots: 3 });
  
  assert.strictEqual(check.has, false);
  assert.ok(check.missing.scallions, "Should have missing entry");
  assert.strictEqual(check.missing.scallions.short, 2, "Should be short by 2");
});

// ========== Bowl Inventory Tests ==========

test("Inventory: addBowlToInventory success", () => {
  const player = makeTestPlayer(0);
  const bowlData = {
    recipe_id: "classic_soy_ramen",
    tier: "common",
    quality: 85,
    cooked_at: Date.now()
  };
  
  const result = addBowlToInventory(player, "bowl_1", bowlData, 3, "block");
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.added, 3);
  assert.strictEqual(player.inv_bowls.bowl_1.qty, 3);
  assert.strictEqual(player.inv_bowls.bowl_1.recipe_id, "classic_soy_ramen");
});

test("Inventory: addBowlToInventory blocks at capacity", () => {
  const player = makeTestPlayer(0);
  const bowlData = {
    recipe_id: "classic_soy_ramen",
    tier: "common",
    quality: 85,
    cooked_at: Date.now()
  };
  
  player.inv_bowls.bowl_1 = { ...bowlData, qty: 9 };
  
  const result = addBowlToInventory(player, "bowl_1", bowlData, 2, "block");
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.blocked, 2);
  assert.strictEqual(player.inv_bowls.bowl_1.qty, 9, "Unchanged");
});

test("Inventory: addBowlToInventory truncate mode", () => {
  const player = makeTestPlayer(0);
  const bowlData = {
    recipe_id: "classic_soy_ramen",
    tier: "common",
    quality: 85,
    cooked_at: Date.now()
  };
  
  player.inv_bowls.bowl_1 = { ...bowlData, qty: 9 };
  
  const result = addBowlToInventory(player, "bowl_1", bowlData, 3, "truncate");
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.added, 1, "Should add 1");
  assert.strictEqual(result.blocked, 2, "Should block 2");
  assert.strictEqual(player.inv_bowls.bowl_1.qty, 10, "Should reach capacity");
});

test("Inventory: removeBowlFromInventory success", () => {
  const player = makeTestPlayer(0);
  player.inv_bowls.bowl_1 = {
    recipe_id: "classic_soy_ramen",
    tier: "common",
    quality: 85,
    qty: 5,
    cooked_at: Date.now()
  };
  
  const result = removeBowlFromInventory(player, "bowl_1", 2);
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.removed, 2);
  assert.strictEqual(player.inv_bowls.bowl_1.qty, 3);
});

test("Inventory: removeBowlFromInventory cleans up empty", () => {
  const player = makeTestPlayer(0);
  player.inv_bowls.bowl_1 = {
    recipe_id: "classic_soy_ramen",
    tier: "common",
    quality: 85,
    qty: 2,
    cooked_at: Date.now()
  };
  
  const result = removeBowlFromInventory(player, "bowl_1", 2);
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.inv_bowls.bowl_1, undefined, "Should be removed");
});

// ========== Count Tests ==========

test("Inventory: getTotalIngredientCount", () => {
  const player = makeTestPlayer(0);
  player.inv_ingredients = { scallions: 10, carrots: 5, mushrooms: 3 };
  
  const total = getTotalIngredientCount(player);
  assert.strictEqual(total, 18);
});

test("Inventory: getTotalBowlCount", () => {
  const player = makeTestPlayer(0);
  player.inv_bowls = {
    bowl_1: { recipe_id: "r1", tier: "common", quality: 85, qty: 3, cooked_at: 0 },
    bowl_2: { recipe_id: "r2", tier: "rare", quality: 90, qty: 2, cooked_at: 0 }
  };
  
  const total = getTotalBowlCount(player);
  assert.strictEqual(total, 5);
});

// ========== Status Tests ==========

test("Inventory: getInventoryStatus", () => {
  const player = makeTestPlayer(2); // pantry level 2 = 50 capacity
  player.inv_ingredients = { scallions: 50, carrots: 30, mushrooms: 10 };
  player.inv_bowls = {
    bowl_1: { recipe_id: "r1", tier: "common", quality: 85, qty: 10, cooked_at: 0 }
  };
  
  const status = getInventoryStatus(player);
  
  assert.strictEqual(status.ingredients.stackCapacity, 50);
  assert.strictEqual(status.ingredients.uniqueTypes, 3);
  assert.strictEqual(status.ingredients.totalItems, 90);
  assert.strictEqual(status.ingredients.atCapacity.length, 1);
  assert.strictEqual(status.ingredients.atCapacity[0], "scallions");
  
  assert.strictEqual(status.bowls.stackCapacity, 10);
  assert.strictEqual(status.bowls.uniqueTypes, 1);
  assert.strictEqual(status.bowls.totalItems, 10);
  assert.strictEqual(status.bowls.atCapacity.length, 1);
});
