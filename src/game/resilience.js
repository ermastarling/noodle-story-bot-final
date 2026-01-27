/**
 * resilience.js
 * Phase B: Resilience & Comeback Mechanics
 * 
 * Provides safety nets and comeback mechanics to prevent player deadlocks
 * and frustration from early-game failures.
 */

import { nowTs, dayKeyUTC } from "../util/time.js";
import { MARKET_ITEM_IDS, sellPrice } from "./market.js";

// Constants
export const FALLBACK_RECIPE_ID = "simple_broth";
export const FAIL_STREAK_TRIGGER = 3;
export const RECOVERY_COOLDOWN_HOURS = 24;
export const MARKET_PITY_DISCOUNT = 0.50;
export const REP_FLOOR = 0;

// Emergency grant quantities
export const EMERGENCY_GRANT = {
  broth_soy: 1,
  noodles_wheat: 1
};

/**
 * B1: Economic Deadlock Detection
 * DEADLOCK = (coins == 0) AND (no cookable recipes) AND (no market buy possible)
 */
export function detectDeadlock(player, serverState, content) {
  // If player has coins, not in deadlock
  if (player.coins > 0) return false;

  const knownRecipes = player.known_recipes || [];
  const inventory = player.inv_ingredients || {};
  const marketPrices = serverState.market_prices || {};

  // Check if player can cook any known recipe
  let canCookAny = false;
  for (const recipeId of knownRecipes) {
    const recipe = content.recipes?.[recipeId];
    if (!recipe) continue;

    let canCook = true;
    for (const ing of recipe.ingredients || []) {
      const have = inventory[ing.item_id] || 0;
      if (have < ing.qty) {
        canCook = false;
        break;
      }
    }
    if (canCook) {
      canCookAny = true;
      break;
    }
  }

  if (canCookAny) return false;

  // Check if player can buy anything from market (need to be able to afford at least one item)
  let canBuyAny = false;
  for (const [itemId, price] of Object.entries(marketPrices)) {
    if (price <= player.coins) {
      canBuyAny = true;
      break;
    }
  }

  if (canBuyAny) return false;

  // Check if player has any sellable items (items that can be sold to the market)
  // Only items in MARKET_ITEM_IDS with a valid sell price count as sellable
  let hasSellableItems = false;
  for (const [itemId, qty] of Object.entries(inventory)) {
    if (qty > 0 && MARKET_ITEM_IDS.includes(itemId)) {
      // Check if this item actually has a sell price in the current market
      const price = sellPrice(serverState, itemId);
      if (price > 0) {
        hasSellableItems = true;
        break;
      }
    }
  }
  
  if (hasSellableItems) return false;

  // DEADLOCK CONFIRMED
  return true;
}

/**
 * B2: Fallback Recipe Access
 * If deadlocked, temporarily grant access to simple_broth until coins > 0
 */
export function applyFallbackRecipeAccess(player, content) {
  const fallbackRecipe = content.recipes?.[FALLBACK_RECIPE_ID];
  if (!fallbackRecipe) return { granted: false, message: "" };

  // Check if player already knows this recipe permanently
  if (player.known_recipes.includes(FALLBACK_RECIPE_ID)) {
    return { granted: false, message: "" };
  }

  // Grant temporary access via resilience flag
  if (!player.resilience) player.resilience = {};
  if (!player.resilience.temp_recipes) player.resilience.temp_recipes = [];
  
  if (!player.resilience.temp_recipes.includes(FALLBACK_RECIPE_ID)) {
    player.resilience.temp_recipes.push(FALLBACK_RECIPE_ID);
    return { 
      granted: true, 
      message: "🆘 **Rescue Mode**: You can temporarily cook a simple broth to get back on your feet." 
    };
  }

  return { granted: false, message: "" };
}

/**
 * B3: Emergency Ingredient Grant
 * If deadlocked (once per day): +1 soy_broth, +1 wheat_noodles
 */
export function applyEmergencyGrant(player, content) {
  const now = nowTs();
  const today = dayKeyUTC(now);
  
  if (!player.resilience) player.resilience = {};
  
  // Check last rescue
  const lastRescue = player.resilience.last_rescue_at || 0;
  const lastRescueDay = lastRescue ? dayKeyUTC(lastRescue) : null;
  
  // Only grant once per day
  if (lastRescueDay === today) {
    return { granted: false, message: "" };
  }

  // Grant emergency ingredients (validate items exist in content)
  if (!player.inv_ingredients) player.inv_ingredients = {};
  
  let grantedAny = false;
  for (const [itemId, qty] of Object.entries(EMERGENCY_GRANT)) {
    // Only grant if item exists in content bundle
    if (content && content.items && content.items[itemId]) {
      player.inv_ingredients[itemId] = (player.inv_ingredients[itemId] || 0) + qty;
      grantedAny = true;
    }
  }

  if (!grantedAny) {
    return { granted: false, message: "" };
  }

  player.resilience.last_rescue_at = now;

  return { 
    granted: true, 
    message: "🆘 **Emergency Supplies**: You've received some basic ingredients to help you recover." 
  };
}

/**
 * B4: Fail-Streak Mitigation
 * Track consecutive failures and provide relief
 */
export function updateFailStreak(player, success) {
  if (!player.buffs) player.buffs = {};
  
  if (success) {
    // Only reset fail streak on success if no relief is active
    if (!player.buffs.fail_streak_relief || player.buffs.fail_streak_relief <= 0) {
      player.buffs.fail_streak = 0;
    }
  } else {
    // Increment fail streak
    player.buffs.fail_streak = (player.buffs.fail_streak || 0) + 1;
    
    // Apply relief if trigger threshold reached
    if (player.buffs.fail_streak >= FAIL_STREAK_TRIGGER) {
      player.buffs.fail_streak_relief = 2; // Relief for next 2 successes
      player.buffs.fail_streak = 0; // Reset streak
    }
  }
}

/**
 * Get fail-streak mitigation bonuses if active
 */
export function getFailStreakBonuses(player) {
  const relief = player.buffs?.fail_streak_relief || 0;
  
  if (relief <= 0) {
    return {
      active: false,
      cook_fail_reduction: 0,
      spoilage_chance_reduction: 0,
      quality_floor: null
    };
  }

  return {
    active: true,
    cook_fail_reduction: 0.03,
    spoilage_chance_reduction: 0.01,
    quality_floor: "standard"
  };
}

/**
 * Decrement fail-streak relief counter after successful action
 */
export function consumeFailStreakRelief(player) {
  if (player.buffs?.fail_streak_relief > 0) {
    player.buffs.fail_streak_relief -= 1;
  }
}

/**
 * B5: Order Board Guarantee
 * Ensure at least 1 order is fulfillable with known recipes
 */
export function ensureOrderBoardHasFulfillable(orderBoard, knownRecipes) {
  if (!orderBoard || orderBoard.length === 0) return true;
  
  // Check if at least one order uses a known recipe
  const hasFulfillable = orderBoard.some(order => 
    knownRecipes.includes(order.recipe_id)
  );
  
  return hasFulfillable;
}

/**
 * B6: Market Safety Net
 * If prices exceed coins and no sellables exist, apply pity discount
 */
export function applyMarketPityDiscount(player, serverState, content) {
  // Check if player has any sellable items (items that can be sold to the market)
  // Only items in MARKET_ITEM_IDS with a valid sell price count as sellable
  const inventory = player.inv_ingredients || {};
  let hasSellableItems = false;
  
  for (const [itemId, qty] of Object.entries(inventory)) {
    if (qty > 0 && MARKET_ITEM_IDS.includes(itemId)) {
      // Check if this item actually has a sell price in the current market
      const price = sellPrice(serverState, itemId);
      if (price > 0) {
        hasSellableItems = true;
        break;
      }
    }
  }
  
  if (hasSellableItems) return { applied: false, discountedItem: null };
  
  // Check if all market items are too expensive
  const marketPrices = serverState.market_prices || {};
  const affordableItems = Object.entries(marketPrices)
    .filter(([_, price]) => price <= player.coins);
  
  if (affordableItems.length > 0) return { applied: false, discountedItem: null };
  
  // Find cheapest item to discount
  const sortedItems = Object.entries(marketPrices)
    .sort(([_, a], [__, b]) => a - b);
  
  if (sortedItems.length === 0) return { applied: false, discountedItem: null };
  
  const [itemId, originalPrice] = sortedItems[0];
  const discountedPrice = Math.max(1, Math.floor(originalPrice * MARKET_PITY_DISCOUNT));
  
  // Apply discount for the day
  if (!player.resilience) player.resilience = {};
  const today = dayKeyUTC();
  
  // Only apply once per day
  if (player.resilience.pity_discount_day === today) {
    return { applied: false, discountedItem: null };
  }
  
  player.resilience.pity_discount_day = today;
  player.resilience.pity_discount_item = itemId;
  player.resilience.pity_discount_price = discountedPrice;
  
  return { 
    applied: true, 
    discountedItem: itemId, 
    originalPrice, 
    discountedPrice 
  };
}

/**
 * Get pity discount if active for an item
 */
export function getPityDiscount(player, itemId) {
  const today = dayKeyUTC();
  
  if (
    player.resilience?.pity_discount_day === today &&
    player.resilience?.pity_discount_item === itemId &&
    player.resilience?.pity_discount_price
  ) {
    return player.resilience.pity_discount_price;
  }
  
  return null;
}

/**
 * B7: Reputation Floor
 * If no REP gained in a session, next successful serve grants +1 REP
 */
export function checkRepFloorBonus(player) {
  if (!player.buffs) player.buffs = {};
  
  // Check if player has earned any rep
  if (player.rep <= REP_FLOOR) {
    // Grant one-time bonus for next serve
    if (!player.buffs.rep_floor_bonus) {
      player.buffs.rep_floor_bonus = true;
      return { eligible: true };
    }
  }
  
  return { eligible: player.buffs.rep_floor_bonus === true };
}

/**
 * Apply and consume rep floor bonus
 */
export function applyRepFloorBonus(player) {
  if (player.buffs?.rep_floor_bonus) {
    player.buffs.rep_floor_bonus = false;
    return 1; // +1 REP bonus
  }
  return 0;
}

/**
 * B8: Seasonal & Event Catch-Up
 * (Placeholder for future implementation)
 * - Missed seasonal recipes re-enter discovery next yearly cycle
 * - Event items convert to coins at 0.75 * base_price
 */
export function applySeasonalCatchUp(player, content) {
  // TODO: Implement when seasonal system is more developed
  return { applied: false };
}

/**
 * B9: Anti-Exploit
 * Check recovery cooldown and ensure no achievements/unlocks from recovery grants
 */
export function checkRecoveryCooldown(player) {
  const now = nowTs();
  const lastRescue = player.resilience?.last_rescue_at || 0;
  const cooldownMs = RECOVERY_COOLDOWN_HOURS * 60 * 60 * 1000;
  
  if (now - lastRescue < cooldownMs) {
    const hoursLeft = Math.ceil((cooldownMs - (now - lastRescue)) / (60 * 60 * 1000));
    return { 
      available: false, 
      hoursLeft 
    };
  }
  
  return { available: true, hoursLeft: 0 };
}

/**
 * Check if player is in recovery mode (any active resilience mechanics)
 */
export function isInRecoveryMode(player) {
  return (
    (player.resilience?.temp_recipes?.length || 0) > 0 ||
    (player.buffs?.fail_streak_relief || 0) > 0
  );
}

/**
 * Main resilience check and application
 * Called before player actions to ensure safety nets are in place
 */
export function applyResilienceMechanics(player, serverState, content) {
  const messages = [];
  let applied = false;

  // Check for deadlock
  const isDeadlocked = detectDeadlock(player, serverState, content);
  
  if (isDeadlocked) {
    // B1: Deadlock detected - apply recovery in priority order
    
    // B2: Fallback recipe
    const fallback = applyFallbackRecipeAccess(player, content);
    if (fallback.granted) {
      messages.push(fallback.message);
      applied = true;
    }
    
    // B3: Emergency grant (once per day)
    const cooldown = checkRecoveryCooldown(player);
    if (cooldown.available) {
      const grant = applyEmergencyGrant(player, content);
      if (grant.granted) {
        messages.push(grant.message);
        applied = true;
      }
    }
  }

  // Check market pity discount (B6)
  if (player.coins <= 5 && !isDeadlocked) { // Close to deadlock
    const pity = applyMarketPityDiscount(player, serverState, content);
    if (pity.applied) {
      const itemName = content.items?.[pity.discountedItem]?.name || pity.discountedItem;
      messages.push(
        `🛟 **Market Help**: Today, **${itemName}** is available at a special price (${pity.discountedPrice}c).`
      );
      applied = true;
    }
  }

  // Check reputation floor bonus (B7)
  checkRepFloorBonus(player);

  return {
    applied,
    messages,
    isDeadlocked
  };
}

/**
 * Get all recipes available to player (including temporary ones)
 */
export function getAvailableRecipes(player) {
  const permanent = player.known_recipes || [];
  const temporary = player.resilience?.temp_recipes || [];
  
  return [...new Set([...permanent, ...temporary])];
}

/**
 * Clear temporary recipe access when player has coins again
 */
export function clearTemporaryRecipes(player) {
  if (player.coins > 0 && player.resilience?.temp_recipes) {
    player.resilience.temp_recipes = [];
  }
}
