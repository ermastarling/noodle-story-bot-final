/**
 * inventory.js
 * Phase 10: Inventory Capacity & Spoilage
 * 
 * Manages inventory capacity limits, overflow handling, and bowl storage.
 */

// ========== Capacity Constants ==========

/**
 * Base capacity for ingredient stacks (per item type)
 * Modified by u_pantry upgrade: ING_STACK_CAP = 40 + 5 * u_pantry
 */
export const ING_STACK_CAP_BASE = 40;

/**
 * Capacity increase per pantry upgrade level
 */
export const ING_STACK_CAP_PER_UPGRADE = 5;

/**
 * Base capacity for bowl stacks (per bowl type)
 */
export const BOWL_STACK_CAP_BASE = 10;

/**
 * Overflow handling mode
 * - "block": Prevent adding items that would exceed capacity
 * - "truncate": Add up to capacity, discard overflow
 * - "allow": Allow overflow (no limits)
 */
export const OVERFLOW_MODE = "block";

// ========== Capacity Calculation ==========

/**
 * Calculate ingredient stack capacity for a player
 * @param {Object} player - Player profile
 * @returns {number} Max items per ingredient type
 */
export function getIngredientStackCapacity(player) {
  const pantryLevel = player.upgrades?.u_pantry || 0;
  return ING_STACK_CAP_BASE + (ING_STACK_CAP_PER_UPGRADE * pantryLevel);
}

/**
 * Calculate bowl stack capacity for a player
 * Currently fixed, but could be modified by upgrades in the future
 * @param {Object} player - Player profile
 * @returns {number} Max bowls per bowl type
 */
export function getBowlStackCapacity(player) {
  // Future: Could add secure_crates bonus here if needed
  return BOWL_STACK_CAP_BASE;
}

/**
 * Check if adding items would exceed capacity
 * @param {Object} player - Player profile
 * @param {string} itemId - Item identifier
 * @param {number} quantity - Quantity to add
 * @returns {Object} { canAdd: boolean, currentQty: number, maxCapacity: number, overflow: number }
 */
export function checkIngredientCapacity(player, itemId, quantity) {
  if (!player.inv_ingredients) player.inv_ingredients = {};
  
  const currentQty = player.inv_ingredients[itemId] || 0;
  const maxCapacity = getIngredientStackCapacity(player);
  const afterAdd = currentQty + quantity;
  const overflow = Math.max(0, afterAdd - maxCapacity);
  const canAdd = overflow === 0;
  
  return {
    canAdd,
    currentQty,
    maxCapacity,
    afterAdd: Math.min(afterAdd, maxCapacity),
    overflow
  };
}

/**
 * Check if adding bowls would exceed capacity
 * @param {Object} player - Player profile
 * @param {string} bowlKey - Bowl identifier
 * @param {number} quantity - Quantity to add
 * @returns {Object} { canAdd: boolean, currentQty: number, maxCapacity: number, overflow: number }
 */
export function checkBowlCapacity(player, bowlKey, quantity) {
  if (!player.inv_bowls) player.inv_bowls = {};
  
  const currentQty = player.inv_bowls[bowlKey]?.qty || 0;
  const maxCapacity = getBowlStackCapacity(player);
  const afterAdd = currentQty + quantity;
  const overflow = Math.max(0, afterAdd - maxCapacity);
  const canAdd = overflow === 0;
  
  return {
    canAdd,
    currentQty,
    maxCapacity,
    afterAdd: Math.min(afterAdd, maxCapacity),
    overflow
  };
}

// ========== Ingredient Inventory Management ==========

/**
 * Add ingredients to inventory with capacity checks
 * @param {Object} player - Player profile
 * @param {Object} drops - Object mapping itemId to quantity { itemId: qty, ... }
 * @param {string} mode - Overflow mode: "block", "truncate", or "allow"
 * @returns {Object} { success: boolean, added: {}, blocked: {}, message: string }
 */
export function addIngredientsToInventory(player, drops, mode = OVERFLOW_MODE) {
  if (!player.inv_ingredients) player.inv_ingredients = {};
  
  const added = {};
  const blocked = {};
  
  for (const [itemId, qty] of Object.entries(drops)) {
    if (qty <= 0) continue;
    
    const capacityCheck = checkIngredientCapacity(player, itemId, qty);
    
    if (mode === "allow") {
      // No capacity limits
      player.inv_ingredients[itemId] = (player.inv_ingredients[itemId] || 0) + qty;
      added[itemId] = qty;
    } else if (mode === "truncate") {
      // Add up to capacity, discard overflow
      const actualAdd = Math.min(qty, capacityCheck.maxCapacity - capacityCheck.currentQty);
      if (actualAdd > 0) {
        player.inv_ingredients[itemId] = (player.inv_ingredients[itemId] || 0) + actualAdd;
        added[itemId] = actualAdd;
      }
      if (actualAdd < qty) {
        blocked[itemId] = qty - actualAdd;
      }
    } else { // "block" mode (default)
      // Only add if it fits completely
      if (capacityCheck.canAdd) {
        player.inv_ingredients[itemId] = (player.inv_ingredients[itemId] || 0) + qty;
        added[itemId] = qty;
      } else {
        blocked[itemId] = qty;
      }
    }
  }
  
  const success = Object.keys(blocked).length === 0;
  const message = success 
    ? "All items added successfully."
    : `Some items couldn't be added due to capacity limits: ${Object.keys(blocked).join(", ")}`;
  
  return { success, added, blocked, message };
}

/**
 * Remove ingredients from inventory
 * @param {Object} player - Player profile
 * @param {Object} items - Object mapping itemId to quantity { itemId: qty, ... }
 * @returns {Object} { success: boolean, removed: {}, insufficient: {}, message: string }
 */
export function removeIngredientsFromInventory(player, items) {
  if (!player.inv_ingredients) player.inv_ingredients = {};
  
  const removed = {};
  const insufficient = {};
  
  for (const [itemId, qty] of Object.entries(items)) {
    if (qty <= 0) continue;
    
    const currentQty = player.inv_ingredients[itemId] || 0;
    if (currentQty >= qty) {
      player.inv_ingredients[itemId] = currentQty - qty;
      removed[itemId] = qty;
      
      // Clean up zero quantities
      if (player.inv_ingredients[itemId] === 0) {
        delete player.inv_ingredients[itemId];
      }
    } else {
      insufficient[itemId] = { needed: qty, have: currentQty };
    }
  }
  
  const success = Object.keys(insufficient).length === 0;
  const message = success
    ? "All items removed successfully."
    : `Insufficient items: ${Object.keys(insufficient).join(", ")}`;
  
  return { success, removed, insufficient, message };
}

/**
 * Check if player has required ingredients
 * @param {Object} player - Player profile
 * @param {Object} required - Object mapping itemId to quantity { itemId: qty, ... }
 * @returns {Object} { has: boolean, missing: {} }
 */
export function hasIngredients(player, required) {
  if (!player.inv_ingredients) player.inv_ingredients = {};
  
  const missing = {};
  
  for (const [itemId, qty] of Object.entries(required)) {
    const currentQty = player.inv_ingredients[itemId] || 0;
    if (currentQty < qty) {
      missing[itemId] = { needed: qty, have: currentQty, short: qty - currentQty };
    }
  }
  
  return {
    has: Object.keys(missing).length === 0,
    missing
  };
}

// ========== Bowl Inventory Management ==========

/**
 * Add a bowl to inventory with capacity checks
 * Bowl format: { recipe_id, tier, quality, qty, cooked_at }
 * @param {Object} player - Player profile
 * @param {string} bowlKey - Unique bowl identifier (e.g., "ramen_classic_rare_95")
 * @param {Object} bowlData - Bowl metadata { recipe_id, tier, quality, cooked_at }
 * @param {number} quantity - Number of bowls to add
 * @param {string} mode - Overflow mode: "block", "truncate", or "allow"
 * @returns {Object} { success: boolean, added: number, blocked: number, message: string }
 */
export function addBowlToInventory(player, bowlKey, bowlData, quantity = 1, mode = OVERFLOW_MODE) {
  if (!player.inv_bowls) player.inv_bowls = {};
  
  const capacityCheck = checkBowlCapacity(player, bowlKey, quantity);
  
  let actualAdd = 0;
  let blocked = 0;
  
  if (mode === "allow") {
    actualAdd = quantity;
  } else if (mode === "truncate") {
    actualAdd = Math.min(quantity, capacityCheck.maxCapacity - capacityCheck.currentQty);
    blocked = quantity - actualAdd;
  } else { // "block" mode
    if (capacityCheck.canAdd) {
      actualAdd = quantity;
    } else {
      blocked = quantity;
    }
  }
  
  if (actualAdd > 0) {
    if (!player.inv_bowls[bowlKey]) {
      player.inv_bowls[bowlKey] = {
        recipe_id: bowlData.recipe_id,
        tier: bowlData.tier,
        quality: bowlData.quality,
        qty: actualAdd,
        cooked_at: bowlData.cooked_at
      };
    } else {
      player.inv_bowls[bowlKey].qty += actualAdd;
    }
  }
  
  const success = blocked === 0;
  const message = success
    ? `Added ${actualAdd} bowl(s) successfully.`
    : `Only added ${actualAdd} bowl(s); ${blocked} blocked due to capacity.`;
  
  return { success, added: actualAdd, blocked, message };
}

/**
 * Remove bowls from inventory
 * @param {Object} player - Player profile
 * @param {string} bowlKey - Bowl identifier
 * @param {number} quantity - Number of bowls to remove
 * @returns {Object} { success: boolean, removed: number, message: string }
 */
export function removeBowlFromInventory(player, bowlKey, quantity = 1) {
  if (!player.inv_bowls) player.inv_bowls = {};
  
  const currentQty = player.inv_bowls[bowlKey]?.qty || 0;
  
  if (currentQty < quantity) {
    return {
      success: false,
      removed: 0,
      message: `Insufficient bowls. Have ${currentQty}, need ${quantity}.`
    };
  }
  
  player.inv_bowls[bowlKey].qty -= quantity;
  
  // Clean up empty entries
  if (player.inv_bowls[bowlKey].qty === 0) {
    delete player.inv_bowls[bowlKey];
  }
  
  return {
    success: true,
    removed: quantity,
    message: `Removed ${quantity} bowl(s) successfully.`
  };
}

/**
 * Get total count of all bowls in inventory
 * @param {Object} player - Player profile
 * @returns {number} Total bowl count
 */
export function getTotalBowlCount(player) {
  if (!player.inv_bowls) return 0;
  
  return Object.values(player.inv_bowls).reduce((sum, bowl) => sum + (bowl.qty || 0), 0);
}

/**
 * Get total count of all ingredients in inventory
 * @param {Object} player - Player profile
 * @returns {number} Total ingredient count
 */
export function getTotalIngredientCount(player) {
  if (!player.inv_ingredients) return 0;
  
  return Object.values(player.inv_ingredients).reduce((sum, qty) => sum + qty, 0);
}

// ========== Inventory Status ==========

/**
 * Get inventory capacity status for display
 * @param {Object} player - Player profile
 * @returns {Object} Status information
 */
export function getInventoryStatus(player) {
  const ingredientCapacity = getIngredientStackCapacity(player);
  const bowlCapacity = getBowlStackCapacity(player);
  
  const ingredients = player.inv_ingredients || {};
  const bowls = player.inv_bowls || {};
  
  // Count unique item types and total quantities
  const ingredientTypes = Object.keys(ingredients).length;
  const ingredientTotal = getTotalIngredientCount(player);
  
  const bowlTypes = Object.keys(bowls).length;
  const bowlTotal = getTotalBowlCount(player);
  
  // Check for any items at capacity
  const ingredientsAtCapacity = Object.entries(ingredients)
    .filter(([_, qty]) => qty >= ingredientCapacity)
    .map(([id, _]) => id);
  
  const bowlsAtCapacity = Object.entries(bowls)
    .filter(([_, bowl]) => bowl.qty >= bowlCapacity)
    .map(([key, _]) => key);
  
  return {
    ingredients: {
      stackCapacity: ingredientCapacity,
      uniqueTypes: ingredientTypes,
      totalItems: ingredientTotal,
      atCapacity: ingredientsAtCapacity
    },
    bowls: {
      stackCapacity: bowlCapacity,
      uniqueTypes: bowlTypes,
      totalItems: bowlTotal,
      atCapacity: bowlsAtCapacity
    }
  };
}
