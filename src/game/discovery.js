import { 
  DISCOVERY_HOOKS, 
  DISCOVERY_CHANCE_BASE, 
  DISCOVERY_SCROLL_CHANCE_BASE,
  DISCOVERY_PITY_NO_DROP_SERVES,
  CLUES_TO_UNLOCK_RECIPE,
  CLUE_DUPLICATE_COINS,
  CLUE_DUPLICATE_WHILE_UNDISCOVERED_CHANCE,
  SCROLL_DUPLICATE_COINS,
  SCROLL_DUPLICATE_WHILE_UNDISCOVERED_CHANCE,
  DISCOVERY_TIER_UNLOCK_LEVEL,
  DISCOVERY_TIER_UNLOCK_REP,
  DISCOVERY_RECIPE_TIER_WEIGHTS
} from "../constants.js";
import { nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";
import { FALLBACK_RECIPE_ID } from "./resilience.js";
import { isFishingIngredientLocked } from "./fishing.js";
import { weightedPick } from "../util/rng.js";
import { grantBadge } from "./badges.js";
import { getIcon } from "../ui/icons.js";

const LOCKED_FISHING_RECIPE_DISCOVERY_WEIGHT_MULT = 0.25;

export function getTakeoutDiscoveryAttemptLimit(servingsToProcess = 0, env = process.env) {
  const requested = Math.max(0, Math.floor(Number(servingsToProcess) || 0));
  const parsedCap = Number(env?.NOODLE_TAKEOUT_DISCOVERY_MAX_ATTEMPTS);
  const envCap = Number.isFinite(parsedCap) ? Math.floor(parsedCap) : 12;
  const cap = Math.max(0, envCap);
  return Math.min(requested, cap);
}

function isRecipeActiveForEvent(recipe, activeEventId) {
  if (!recipe?.event_id) return true;
  if (!activeEventId) return false;
  return String(recipe.event_id) === String(activeEventId);
}
export function unlockRecipeForPlayer(player, content, recipeId) {
  if (!player) return { ok: false, reason: "Missing player." };
  const normalizedRecipeId = String(recipeId ?? "").trim();
  if (!normalizedRecipeId) return { ok: false, reason: "Missing recipe id." };

  const recipe = content?.recipes?.[normalizedRecipeId] ?? null;
  if (!recipe) return { ok: false, reason: "Recipe not found." };

  if (!Array.isArray(player.known_recipes)) {
    player.known_recipes = [];
  }

  if (player.known_recipes.includes(normalizedRecipeId)) {
    return {
      ok: true,
      added: false,
      recipeId: normalizedRecipeId,
      recipe
    };
  }

  player.known_recipes.push(normalizedRecipeId);
  if (player.clues_owned?.[normalizedRecipeId]) {
    delete player.clues_owned[normalizedRecipeId];
  }

  return {
    ok: true,
    added: true,
    recipeId: normalizedRecipeId,
    recipe
  };
}

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
    
    if (!isRecipeActiveForEvent(recipe, activeEventId)) {
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
      const weight = getDiscoveryRecipeWeight(player, recipe);
      return [recipe.recipe_id, Math.max(0.01, weight)];
    })
  );

  const pickedId = weightedPick(rng, weights);
  return discoverableRecipes.find((r) => r.recipe_id === pickedId) ?? discoverableRecipes[0];
}

function pickDuplicateEligibleRecipe(player, content, rng, { mode = "clue", activeSeason = null, activeEventId = null } = {}) {
  const allRecipes = Object.values(content.recipes || {});
  const ownedRecipeIds = mode === "scroll"
    ? new Set(Object.keys(player.scrolls_owned || {}))
    : new Set(player.known_recipes || []);

  const candidates = allRecipes.filter((recipe) => {
    if (!recipe || recipe.recipe_id === FALLBACK_RECIPE_ID) return false;
    if (!ownedRecipeIds.has(recipe.recipe_id)) return false;
    if (!isRecipeActiveForEvent(recipe, activeEventId)) return false;
    if (recipe.tier === "seasonal" && (!activeSeason || recipe.season !== activeSeason)) return false;
    if (!canDiscoverTier(player, recipe.tier)) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  const idx = Math.floor(rng() * candidates.length);
  return candidates[Math.max(0, Math.min(candidates.length - 1, idx))];
}

export function getDiscoveryRecipeWeight(player, recipe) {
  const baseWeight = DISCOVERY_RECIPE_TIER_WEIGHTS[recipe?.tier] ?? 1;
  const ingredients = recipe?.ingredients ?? [];
  const hasLockedFishingIngredient = ingredients.some((ing) => isFishingIngredientLocked(player, ing?.item_id));
  if (!hasLockedFishingIngredient) return baseWeight;
  return baseWeight * LOCKED_FISHING_RECIPE_DISCOVERY_WEIGHT_MULT;
}

/**
 * Roll for recipe discovery after a serve
 */
export function rollRecipeDiscovery({
  player,
  content,
  npcArchetype,
  tier,
  rng,
  activeSeason = null,
  activeEventId = null,
  allowPity = true,
  trackPityStreak = true
}) {
  if (!DISCOVERY_HOOKS.on_serve) return [];

  const discoveries = [];
  const pityThreshold = Math.max(1, Math.floor(Number(DISCOVERY_PITY_NO_DROP_SERVES) || 40));
  const currentNoDropStreak = Math.max(0, Math.floor(Number(player?.discovery?.no_drop_serve_streak || 0) || 0));
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
  const _discoverableRecipes = getDiscoverableRecipes(player, content, { activeSeason, activeEventId });

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
    if (roll < 0.01) {
      const clue = rollClue(player, content, rng, activeSeason, activeEventId);
      if (clue) discoveries.push(clue);
    }
  }

  // Moonlit Spirit: extra independent 1% scroll chance on Epic tier
  if (!discoveries.length && npcArchetype === "moonlit_spirit" && tier === "epic") {
    const roll = rng();
    if (roll < 0.01) {
      const scroll = rollScroll(player, content, rng, activeSeason, activeEventId);
      if (scroll) discoveries.push(scroll);
    }
  }

  // Base roll: only one drop (clue OR scroll)
  if (!discoveries.length) {
    const totalChance = clueChance + scrollChance;
    const dropRoll = rng();
    if (dropRoll < totalChance) {
      const pick = rng();
      if (pick < (clueChance / totalChance)) {
        const clue = rollClue(player, content, rng, activeSeason, activeEventId);
        if (clue) {
          discoveries.push(clue);
        }
      } else {
        const scroll = rollScroll(player, content, rng, activeSeason, activeEventId);
        if (scroll) {
          discoveries.push(scroll);
        }
      }
    }
  }

  const shouldTrackPityStreak = trackPityStreak !== false;
  const shouldAllowPity = allowPity !== false;

  // Pity safety net: force a clue after a long no-drop streak.
  if (!discoveries.length && shouldTrackPityStreak) {
    const nextNoDropStreak = currentNoDropStreak + 1;
    if (shouldAllowPity && nextNoDropStreak >= pityThreshold) {
      const pityClue = rollClue(player, content, rng, activeSeason, activeEventId);
      if (pityClue) {
        pityClue.pityGranted = true;
        discoveries.push(pityClue);
      } else {
        player.discovery = player.discovery || {};
        player.discovery.no_drop_serve_streak = nextNoDropStreak;
      }
    } else {
      player.discovery = player.discovery || {};
      player.discovery.no_drop_serve_streak = nextNoDropStreak;
    }
  }

  if (discoveries.length > 0 && shouldTrackPityStreak) {
    player.discovery = player.discovery || {};
    player.discovery.no_drop_serve_streak = 0;
    for (const d of discoveries) {
      if (d?.pityGranted) {
        d.pityNoDropStreak = currentNoDropStreak + 1;
      }
    }
  }

  return discoveries;
}

/**
 * Roll a recipe clue
 */
function rollClue(player, content, rng, activeSeason = null, activeEventId = null) {
  const discoverableRecipe = pickDiscoverableRecipe(player, content, rng, { excludeCompletedClues: true, activeSeason, activeEventId });
  const duplicateRecipe = pickDuplicateEligibleRecipe(player, content, rng, { mode: "clue", activeSeason, activeEventId });

  let recipe = discoverableRecipe;
  if (discoverableRecipe && duplicateRecipe) {
    // Allow duplicate clue outcomes before full completion.
    recipe = rng() < CLUE_DUPLICATE_WHILE_UNDISCOVERED_CHANCE
      ? duplicateRecipe
      : discoverableRecipe;
  } else if (!recipe) {
    // Endgame fallback: allow duplicate clue compensation when no new clues remain.
    recipe = duplicateRecipe;
  }
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
  const discoverableRecipe = pickDiscoverableRecipe(player, content, rng, { excludeCompletedClues: true, activeSeason, activeEventId });
  const duplicateRecipe = pickDuplicateEligibleRecipe(player, content, rng, { mode: "scroll", activeSeason, activeEventId });

  let recipe = discoverableRecipe;
  if (discoverableRecipe && duplicateRecipe) {
    // Allow duplicate scroll outcomes before full completion.
    recipe = rng() < SCROLL_DUPLICATE_WHILE_UNDISCOVERED_CHANCE
      ? duplicateRecipe
      : discoverableRecipe;
  } else if (!recipe) {
    // Endgame fallback: allow duplicate scroll compensation when no new scroll targets remain.
    recipe = duplicateRecipe;
  }
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

  const getRevealableIngredientIds = (recipe) => {
    return (recipe?.ingredients ?? [])
      .map((ing) => ing?.item_id)
      .filter((itemId) => itemId && !isFishingIngredientLocked(player, itemId));
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
    const allIngredientIds = getRevealableIngredientIds(recipe);
    
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
      const badgeLine = maybeGrantEventBadge(recipe);
      
      return {
        isDuplicate: false,
        recipeUnlocked: true,
        unlockedRecipeId: discovery.recipeId,
        unlockedRecipeName: discovery.recipeName,
        reward: null,
        message: `${getIcon("search")}${getIcon("sparkle")} Collected ${CLUES_TO_UNLOCK_RECIPE} clues - learned **${discovery.recipeName}**!${ingredientMsg}${badgeLine ? `\n${badgeLine}` : ""}`
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
      player.coins = (player.coins || 0) + SCROLL_DUPLICATE_COINS;
      return {
        isDuplicate: true,
        reward: `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)`
      };
    }
    
    // Get recipe details to show ingredients
    const recipe = recipes[discovery.recipeId];
    let ingredientsText = "";
    if (recipe && recipe.ingredients && recipe.ingredients.length > 0) {
      const ingredientNames = getRevealableIngredientIds(recipe)
        .map((itemId) => items[itemId]?.name || itemId)
        .join(", ");
      if (ingredientNames) {
        ingredientsText = `\nIngredients: ${ingredientNames}`;
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

    if (player.clues_owned?.[discovery.recipeId]) {
      delete player.clues_owned[discovery.recipeId];
    }
    
    const badgeLine = maybeGrantEventBadge(recipe);

    return {
      isDuplicate: false,
      recipeUnlocked: true,
      unlockedRecipeId: discovery.recipeId,
      unlockedRecipeName: discovery.recipeName,
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
