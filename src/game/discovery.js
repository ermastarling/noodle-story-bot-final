import { 
  DISCOVERY_HOOKS, 
  DISCOVERY_CHANCE_BASE, 
  DISCOVERY_SCROLL_CHANCE_BASE,
  CLUES_TO_UNLOCK_RECIPE,
  CLUE_DUPLICATE_COINS,
  SCROLL_DUPLICATE_TOKEN_CHANCE,
  SCROLL_DUPLICATE_COINS,
  DISCOVERY_TIER_UNLOCK_LEVEL,
  DISCOVERY_TIER_UNLOCK_REP,
  DISCOVERY_RECIPE_TIER_WEIGHTS
} from "../constants.js";
import { nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";
import { FALLBACK_RECIPE_ID } from "./resilience.js";
import { weightedPick } from "../util/rng.js";
import { grantBadge } from "./badges.js";
import { getIcon } from "../ui/icons.js";

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
export function getDiscoverableRecipes(player, content, { excludeCompletedClues = false, activeSeason = null, activeEventId = null } = {}) {
  const knownRecipes = new Set([
    ...(player.known_recipes || []),
    ...(player.resilience?.temp_recipes || []),
    ...Object.keys(player.scrolls_owned || {})
  ]);
  const allRecipes = Object.values(content.recipes || {});
  const cluesOwned = player.clues_owned || {};
  
  return allRecipes.filter(recipe => {
    if (recipe.recipe_id === FALLBACK_RECIPE_ID) return false;
    // Skip if already known (including temp/scroll unlocks)
    if (knownRecipes.has(recipe.recipe_id)) return false;

    if (excludeCompletedClues) {
      const clueCount = cluesOwned[recipe.recipe_id]?.count ?? 0;
      if (clueCount >= CLUES_TO_UNLOCK_RECIPE) return false;
    }
    
    if (recipe.event_id && (!activeEventId || recipe.event_id !== activeEventId)) {
      return false;
    }

    if (recipe.tier === "seasonal") {
      if (!activeSeason || recipe.season !== activeSeason) return false;
    }

    // Check tier unlock requirements
    if (!canDiscoverTier(player, recipe.tier)) return false;
    
    return true;
  });
}

function pickDiscoverableRecipe(player, content, rng, { excludeCompletedClues = false, activeSeason = null, activeEventId = null } = {}) {
  const discoverableRecipes = getDiscoverableRecipes(player, content, { excludeCompletedClues, activeSeason, activeEventId });
  if (discoverableRecipes.length === 0) return null;

  const weights = Object.fromEntries(
    discoverableRecipes.map((recipe) => {
      const weight = DISCOVERY_RECIPE_TIER_WEIGHTS[recipe.tier] ?? 1;
      return [recipe.recipe_id, Math.max(0.01, weight)];
    })
  );

  const pickedId = weightedPick(rng, weights);
  return discoverableRecipes.find((r) => r.recipe_id === pickedId) ?? discoverableRecipes[0];
}

/**
 * Roll for recipe discovery after a serve
 */
export function rollRecipeDiscovery({ player, content, npcArchetype, tier, rng, activeSeason = null, activeEventId = null }) {
  if (!DISCOVERY_HOOKS.on_serve) return [];

  const discoveries = [];
  let clueChance = DISCOVERY_CHANCE_BASE.serve;
  let scrollChance = DISCOVERY_SCROLL_CHANCE_BASE.serve;
  const dropRateMult = 1;
  clueChance *= dropRateMult;
  scrollChance *= dropRateMult;

  const blessing = getActiveBlessing(player);
  if (blessing?.type === "discovery_chance_add") {
    const bonus = BLESSING_EFFECTS.discovery_chance_add;
    clueChance += bonus?.clueBonus ?? 0;
    scrollChance += bonus?.scrollBonus ?? 0;
  }

  // Check discoverable recipes first
  const discoverableRecipes = getDiscoverableRecipes(player, content, { activeSeason, activeEventId });
  console.log(`🔍 Discovery roll: ${discoverableRecipes.length} discoverable recipes available`);

  // Curious Apprentice: +1% discovery chance to next roll (applies to both)
  if (player.buffs?.apprentice_bonus_pending) {
    clueChance += 0.01;
    scrollChance += 0.01;
    player.buffs.apprentice_bonus_pending = false;
  }

  // Child with Big Scarf: +1% clue chance on serve
  if (npcArchetype === "child_big_scarf") {
    clueChance += 0.01;
  }

  // Wandering Scholar: extra independent 1% chance to drop a clue
  if (npcArchetype === "wandering_scholar") {
    const roll = rng();
    console.log(`🔍 Scholar roll: ${roll.toFixed(4)} vs 0.01`);
    if (roll < 0.01) {
      const clue = rollClue(player, content, rng, activeSeason, activeEventId);
      if (clue) discoveries.push(clue);
    }
  }

  if (discoveries.length > 0) return discoveries;

  // Moonlit Spirit: extra independent 1% scroll chance on Epic tier
  if (npcArchetype === "moonlit_spirit" && tier === "epic") {
    const roll = rng();
    console.log(`🔍 Moonlit roll: ${roll.toFixed(4)} vs 0.01`);
    if (roll < 0.01) {
      const scroll = rollScroll(player, content, rng, activeSeason, activeEventId);
      if (scroll) discoveries.push(scroll);
    }
  }

  if (discoveries.length > 0) return discoveries;

  // Base roll: only one drop (clue OR scroll)
  const totalChance = clueChance + scrollChance;
  const dropRoll = rng();
  console.log(`🔍 Drop roll: ${dropRoll.toFixed(4)} vs ${totalChance.toFixed(4)}`);
  if (dropRoll < totalChance) {
    const pick = rng();
    if (pick < (clueChance / totalChance)) {
      const clue = rollClue(player, content, rng, activeSeason, activeEventId);
      if (clue) {
        console.log(`✅ Clue rolled: ${clue.recipeName}`);
        discoveries.push(clue);
      }
    } else {
      const scroll = rollScroll(player, content, rng, activeSeason, activeEventId);
      if (scroll) {
        console.log(`✅ Scroll rolled: ${scroll.recipeName}`);
        discoveries.push(scroll);
      }
    }
  }

  return discoveries;
}

/**
 * Roll a recipe clue
 */
function rollClue(player, content, rng, activeSeason = null, activeEventId = null) {
  const recipe = pickDiscoverableRecipe(player, content, rng, { excludeCompletedClues: true, activeSeason, activeEventId });
  if (!recipe) return null;
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
function rollScroll(player, content, rng, activeSeason = null, activeEventId = null) {
  const recipe = pickDiscoverableRecipe(player, content, rng, { excludeCompletedClues: true, activeSeason, activeEventId });
  if (!recipe) return null;
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
export function applyDiscovery(player, discovery, content, rng = Math.random, options = {}) {
  const safeContent = content ?? {};
  const recipes = safeContent.recipes ?? {};
  const items = safeContent.items ?? {};
  const badgesContent = options?.badgesContent ?? null;
  if (!discovery) return { isDuplicate: false, reward: null };

  const maybeGrantEventBadge = (recipe) => {
    if (!recipe?.event_badge_id || !badgesContent) return null;
    const result = grantBadge(player, badgesContent, recipe.event_badge_id);
    if (result.status !== "granted") return null;
    const badgeName = result.badge?.name ?? "Event Badge";
    return `${getIcon("badges")} Badge earned: **${badgeName}**`;
  };
  
  if (discovery.type === "clue") {
    // Check if player already knows this recipe
    if (!player.known_recipes) player.known_recipes = [];
    if (player.known_recipes.includes(discovery.recipeId)) {
      // Already unlocked - give coins for duplicate
      player.coins = (player.coins || 0) + CLUE_DUPLICATE_COINS;
        return { 
          isDuplicate: true, 
          reward: `+${CLUE_DUPLICATE_COINS}c (duplicate clue)` 
        };
    }
    
    // Get recipe details to find ingredients
    const recipe = recipes[discovery.recipeId];
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
      const itemName = items[newIngredient]?.name || newIngredient;
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
        message: `${getIcon("search")}${getIcon("sparkle")} Collected ${CLUES_TO_UNLOCK_RECIPE} clues - learned **${discovery.recipeName}**!${ingredientMsg}`
      };
    }
    
    // Still need more clues
    const remaining = CLUES_TO_UNLOCK_RECIPE - clueCount;
    return { 
      isDuplicate: false,
      recipeUnlocked: false,
      reward: null,
      message: `${getIcon("search")} Clue ${clueCount}/${CLUES_TO_UNLOCK_RECIPE} for **${discovery.recipeName}** (${remaining} more)${ingredientMsg}`
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
            reward: `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)` 
          };
      }
    }
    
    // Get recipe details to show ingredients
    const recipe = recipes[discovery.recipeId];
    let ingredientsText = "";
    if (recipe && recipe.ingredients && recipe.ingredients.length > 0) {
      const ingredientNames = recipe.ingredients
        .map(ing => items[ing.item_id]?.name || ing.item_id)
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

    if (player.clues_owned?.[discovery.recipeId]) {
      delete player.clues_owned[discovery.recipeId];
    }
    
    const badgeLine = maybeGrantEventBadge(recipe);

    return { 
      isDuplicate: false,
      recipeUnlocked: true,
      reward: null,
      message: `${getIcon("scroll")} Learned **${discovery.recipeName}** from a scroll!${ingredientsText}${badgeLine ? `\n${badgeLine}` : ""}`
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
