import { 
  DISCOVERY_HOOKS, 
  DISCOVERY_CHANCE_BASE, 
  CLUE_DUPLICATE_COINS,
  SCROLL_DUPLICATE_TOKEN_CHANCE,
  SCROLL_DUPLICATE_COINS,
  DISCOVERY_TIER_UNLOCK_LEVEL,
  DISCOVERY_TIER_UNLOCK_REP
} from "../constants.js";
import { nowTs } from "../util/time.js";

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
  if (!DISCOVERY_HOOKS.on_serve) return null;
  
  let baseChance = DISCOVERY_CHANCE_BASE.serve;
  
  // Wandering Scholar: 10% chance to drop a recipe clue
  if (npcArchetype === "wandering_scholar") {
    const clueRoll = rng();
    if (clueRoll < 0.10) {
      return rollClue(player, content, rng);
    }
  }
  
  // Curious Apprentice: +5% discovery chance to next roll
  if (player.buffs?.apprentice_bonus_pending) {
    baseChance += 0.05;
    player.buffs.apprentice_bonus_pending = false;
  }
  
  // Moonlit Spirit: small scroll chance on Epic tier
  if (npcArchetype === "moonlit_spirit" && tier === "epic") {
    const scrollRoll = rng();
    if (scrollRoll < 0.05) {
      return rollScroll(player, content, rng);
    }
  }
  
  // Base discovery roll
  const discoveryRoll = rng();
  if (discoveryRoll < baseChance) {
    // 50/50 between clue and scroll
    if (rng() < 0.5) {
      return rollClue(player, content, rng);
    } else {
      return rollScroll(player, content, rng);
    }
  }
  
  return null;
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
export function applyDiscovery(player, discovery) {
  if (!discovery) return { isDuplicate: false, reward: null };
  
  if (discovery.type === "clue") {
    // Check if player already has this clue
    if (!player.clues_owned) player.clues_owned = {};
    
    const clueKey = discovery.recipeId;
    if (player.clues_owned[clueKey]) {
      // Duplicate clue - give coins
      player.coins = (player.coins || 0) + CLUE_DUPLICATE_COINS;
      return { 
        isDuplicate: true, 
        reward: `+${CLUE_DUPLICATE_COINS} coins (duplicate clue)` 
      };
    }
    
    // New clue
    player.clues_owned[clueKey] = {
      clue_id: discovery.clueId,
      recipe_id: discovery.recipeId,
      obtained_at: nowTs()
    };
    
    return { 
      isDuplicate: false, 
      reward: null,
      message: `🔍 Discovered a clue for **${discovery.recipeName}**!`
    };
  }
  
  if (discovery.type === "scroll") {
    // Check if player already has this scroll
    if (!player.scrolls_owned) player.scrolls_owned = {};
    
    const scrollKey = discovery.recipeId;
    if (player.scrolls_owned[scrollKey]) {
      // Duplicate scroll - 50% chance for token, otherwise coins
      const tokenRoll = Math.random();
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
      reward: null,
      message: `📜 Learned **${discovery.recipeName}** from a scroll!`
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
