import { 
  DISCOVERY_HOOKS, 
  DISCOVERY_CHANCE_BASE, 
  DISCOVERY_SCROLL_CHANCE_BASE,
  CLUES_TO_UNLOCK_RECIPE,
  CLUE_DUPLICATE_COINS,
  SCROLL_DUPLICATE_TOKEN_CHANCE,
  SCROLL_DUPLICATE_COINS,
  DISCOVERY_TIER_UNLOCK_LEVEL,
  DISCOVERY_TIER_UNLOCK_REP
} from "../constants.js";
import { nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";

/**
 * Check if player can discover recipes of a given tier
 */
export function canDiscoverTier(player, tier) {
  const level = player.shop_level || 1;
  const rep = player.rep || 0;
  
  const levelReq = DISCOVERY_TIER_UNLOCK_LEVEL[tier];
  const repReq = DISCOVERY_TIER_UNLOCK_REP[tier];
  
  if (levelReq && level < levelReq) return false;
  if (repReq && rep < repReq) return false;
  
  return true;
}

/**
 * Get list of recipes player can potentially discover
 */
export function getDiscoverableRecipes(player, content) {
  const knownRecipes = new Set(player.known_recipes || []);
  const allRecipes = Object.values(content.recipes || {});
  
  return allRecipes.filter(recipe => {
    // Skip if already known
    if (knownRecipes.has(recipe.recipe_id)) return false;
    
    // Check tier unlock requirements
    if (!canDiscoverTier(player, recipe.tier)) return false;
    
    return true;
  });
}

/**
 * Roll for recipe discovery after a serve
 */
export function rollRecipeDiscovery({ player, content, npcArchetype, tier, rng }) {
  if (!DISCOVERY_HOOKS.on_serve) return [];

  const discoveries = [];
  let clueChance = DISCOVERY_CHANCE_BASE.serve;
  let scrollChance = DISCOVERY_SCROLL_CHANCE_BASE.serve;

  const blessing = getActiveBlessing(player);
  if (blessing?.type === "discovery_chance_add") {
    const bonus = BLESSING_EFFECTS.discovery_chance_add;
    clueChance += bonus?.clueBonus ?? 0;
    scrollChance += bonus?.scrollBonus ?? 0;
  }

  // Check discoverable recipes first
  const discoverableRecipes = getDiscoverableRecipes(player, content);
  console.log(`🔍 Discovery roll: ${discoverableRecipes.length} discoverable recipes available`);

  // Curious Apprentice: +5% discovery chance to next roll (applies to both)
  if (player.buffs?.apprentice_bonus_pending) {
    clueChance += 0.05;
    scrollChance += 0.05;
    player.buffs.apprentice_bonus_pending = false;
  }

  // Wandering Scholar: extra independent 10% chance to drop a clue
  if (npcArchetype === "wandering_scholar") {
    const roll = rng();
    console.log(`🔍 Scholar roll: ${roll.toFixed(4)} vs 0.10`);
    if (roll < 0.10) {
      const clue = rollClue(player, content, rng);
      if (clue) discoveries.push(clue);
    }
  }

  // Moonlit Spirit: extra independent 5% scroll chance on Epic tier
  if (npcArchetype === "moonlit_spirit" && tier === "epic") {
    const roll = rng();
    console.log(`🔍 Moonlit roll: ${roll.toFixed(4)} vs 0.05`);
    if (roll < 0.05) {
      const scroll = rollScroll(player, content, rng);
      if (scroll) discoveries.push(scroll);
    }
  }

  // Base independent rolls (clue + scroll can both happen)
  const clueRoll = rng();
  console.log(`🔍 Clue roll: ${clueRoll.toFixed(4)} vs ${clueChance.toFixed(4)}`);
  if (clueRoll < clueChance) {
    const clue = rollClue(player, content, rng);
    if (clue) {
      console.log(`✅ Clue rolled: ${clue.recipeName}`);
      discoveries.push(clue);
    }
  }

  const scrollRoll = rng();
  console.log(`🔍 Scroll roll: ${scrollRoll.toFixed(4)} vs ${scrollChance.toFixed(4)}`);
  if (scrollRoll < scrollChance) {
    const scroll = rollScroll(player, content, rng);
    if (scroll) {
      console.log(`✅ Scroll rolled: ${scroll.recipeName}`);
      discoveries.push(scroll);
    }
  }

  return discoveries;
}

/**
 * Roll a recipe clue
 */
function rollClue(player, content, rng) {
  const discoverableRecipes = getDiscoverableRecipes(player, content);
  if (discoverableRecipes.length === 0) return null;
  
  const recipe = discoverableRecipes[Math.floor(rng() * discoverableRecipes.length)];
  const clueId = `clue_${recipe.recipe_id}_${Date.now()}_${Math.floor(rng() * 1000)}`;
  
  return {
    type: "clue",
    clueId,
    recipeId: recipe.recipe_id,
    recipeName: recipe.name,
    recipeTier: recipe.tier
  };
}

/**
 * Roll a recipe scroll
 */
function rollScroll(player, content, rng) {
  const discoverableRecipes = getDiscoverableRecipes(player, content);
  if (discoverableRecipes.length === 0) return null;
  
  const recipe = discoverableRecipes[Math.floor(rng() * discoverableRecipes.length)];
  const scrollId = `scroll_${recipe.recipe_id}_${Date.now()}_${Math.floor(rng() * 1000)}`;
  
  // Determine rarity based on recipe tier
  let rarity = "common";
  if (recipe.tier === "seasonal") rarity = "legendary";
  else if (recipe.tier === "epic") rarity = "epic";
  else if (recipe.tier === "rare") rarity = "rare";
  
  return {
    type: "scroll",
    scrollId,
    recipeId: recipe.recipe_id,
    recipeName: recipe.name,
    recipeTier: recipe.tier,
    rarity
  };
}

/**
 * Apply discovery to player state
 */
export function applyDiscovery(player, discovery, content, rng = Math.random) {
  if (!discovery) return { isDuplicate: false, reward: null };
  
  if (discovery.type === "clue") {
    // Check if player already knows this recipe
    if (!player.known_recipes) player.known_recipes = [];
    if (player.known_recipes.includes(discovery.recipeId)) {
      // Already unlocked - give coins for duplicate
      player.coins = (player.coins || 0) + CLUE_DUPLICATE_COINS;
      return { 
        isDuplicate: true, 
        reward: `+${CLUE_DUPLICATE_COINS} coins (duplicate clue)` 
      };
    }
    
    // Get recipe details to find ingredients
    const recipe = content.recipes[discovery.recipeId];
    if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) {
      return { isDuplicate: false, reward: null };
    }
    
    // Initialize clues tracking
    if (!player.clues_owned) player.clues_owned = {};
    const clueKey = discovery.recipeId;
    
    // Track clue count for this recipe
    if (!player.clues_owned[clueKey]) {
      player.clues_owned[clueKey] = {
        recipe_id: discovery.recipeId,
        count: 0,
        revealed_ingredients: [],
        first_obtained_at: nowTs()
      };
    }
    
    // Backfill ingredients for pre-existing clues (migration)
    if (!player.clues_owned[clueKey].revealed_ingredients) {
      player.clues_owned[clueKey].revealed_ingredients = [];
    }
    const existingCount = player.clues_owned[clueKey].count || 0;
    const revealedIngredients = player.clues_owned[clueKey].revealed_ingredients;
    const allIngredientIds = recipe.ingredients.map(ing => ing.item_id);
    
    // If we have clues but no revealed ingredients, backfill them
    if (existingCount > 0 && revealedIngredients.length < existingCount) {
      const needed = existingCount - revealedIngredients.length;
      const unrevealedIngredients = allIngredientIds.filter(id => !revealedIngredients.includes(id));
      for (let i = 0; i < needed && i < unrevealedIngredients.length; i++) {
        const idx = Math.floor(rng() * unrevealedIngredients.length);
        const ingredientId = unrevealedIngredients.splice(idx, 1)[0];
        revealedIngredients.push(ingredientId);
      }
    }
    
    const unrevealedIngredients = allIngredientIds.filter(id => !revealedIngredients.includes(id));
    
    let newIngredient = null;
    if (unrevealedIngredients.length > 0) {
      // Pick a random unrevealed ingredient
      const idx = Math.floor(rng() * unrevealedIngredients.length);
      newIngredient = unrevealedIngredients[idx];
      revealedIngredients.push(newIngredient);
      player.clues_owned[clueKey].revealed_ingredients = revealedIngredients;
    }
    
    player.clues_owned[clueKey].count += 1;
    const clueCount = player.clues_owned[clueKey].count;
    
    // Build ingredient reveal message
    let ingredientMsg = "";
    if (newIngredient) {
      const itemName = content.items[newIngredient]?.name || newIngredient;
      ingredientMsg = ` - revealed ingredient: **${itemName}**`;
    }
    
    // Check if we have enough clues to unlock
    if (clueCount >= CLUES_TO_UNLOCK_RECIPE) {
      player.known_recipes.push(discovery.recipeId);
      delete player.clues_owned[clueKey]; // Remove clues once recipe learned
      
      return { 
        isDuplicate: false,
        recipeUnlocked: true,
        reward: null,
        message: `🔍✨ Collected ${CLUES_TO_UNLOCK_RECIPE} clues - learned **${discovery.recipeName}**!${ingredientMsg}`
      };
    }
    
    // Still need more clues
    const remaining = CLUES_TO_UNLOCK_RECIPE - clueCount;
    return { 
      isDuplicate: false,
      recipeUnlocked: false,
      reward: null,
      message: `🔍 Clue ${clueCount}/${CLUES_TO_UNLOCK_RECIPE} for **${discovery.recipeName}** (${remaining} more)${ingredientMsg}`
    };
  }
  
  if (discovery.type === "scroll") {
    // Check if player already has this scroll
    if (!player.scrolls_owned) player.scrolls_owned = {};
    
    const scrollKey = discovery.recipeId;
    if (player.scrolls_owned[scrollKey]) {
      // Duplicate scroll - 50% chance for token, otherwise coins
      const tokenRoll = rng();
      if (tokenRoll < SCROLL_DUPLICATE_TOKEN_CHANCE) {
        // Add cosmetic token (not implemented yet, just return message)
        return { 
          isDuplicate: true, 
          reward: `cosmetic token chance (duplicate scroll)` 
        };
      } else {
        player.coins = (player.coins || 0) + SCROLL_DUPLICATE_COINS;
        return { 
          isDuplicate: true, 
          reward: `+${SCROLL_DUPLICATE_COINS} coins (duplicate scroll)` 
        };
      }
    }
    
    // Get recipe details to show ingredients
    const recipe = content.recipes[discovery.recipeId];
    let ingredientsText = "";
    if (recipe && recipe.ingredients && recipe.ingredients.length > 0) {
      const ingredientNames = recipe.ingredients
        .map(ing => content.items[ing.item_id]?.name || ing.item_id)
        .join(", ");
      ingredientsText = `\nIngredients: ${ingredientNames}`;
    }
    
    // New scroll - learn recipe immediately
    player.scrolls_owned[scrollKey] = {
      scroll_id: discovery.scrollId,
      recipe_id: discovery.recipeId,
      obtained_at: nowTs(),
      rarity: discovery.rarity
    };
    
    if (!player.known_recipes) player.known_recipes = [];
    if (!player.known_recipes.includes(discovery.recipeId)) {
      player.known_recipes.push(discovery.recipeId);
    }
    
    return { 
      isDuplicate: false,
      recipeUnlocked: true,
      reward: null,
      message: `📜 Learned **${discovery.recipeName}** from a scroll!${ingredientsText}`
    };
  }
  
  return { isDuplicate: false, reward: null };
}

/**
 * Apply NPC-triggered discovery bonuses for future serves
 */
export function applyNpcDiscoveryBuff(player, npcArchetype) {
  // Curious Apprentice: +5% discovery chance to next roll
  if (npcArchetype === "curious_apprentice") {
    if (!player.buffs) player.buffs = {};
    player.buffs.apprentice_bonus_pending = true;
  }
}
