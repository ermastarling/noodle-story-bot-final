export const DATA_SCHEMA_VERSION = 1;

export const STARTER_PROFILE = {
  coins: 120,
  rep: 0,
  shop_level: 1,
  sxp_total: 0,
  sxp_progress: 0,
  known_recipes: ["classic_soy_ramen"],
  inv_ingredients: { broth_soy: 3, noodles_wheat: 3, scallions: 2 },
};

export const INGREDIENT_CAPACITY_BASE = 50;

export const TUTORIAL_QUESTS = ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"];

export const COIN_BASE = { common: 27, uncommon: 42, rare: 68, epic: 245, seasonal: 285 };
export const SXP_BASE  = { common: 20, uncommon: 32, rare: 45, epic: 90, seasonal: 110 };
export const REP_BASE  = { common: 3,  uncommon: 5,  rare: 7,  epic: 15, seasonal: 20 };

export function sxpToNext(level) {
  return 100 + 25 * level;
}

// Recipe Discovery System (Phase 15)
export const DISCOVERY_HOOKS = { 
  on_serve: true, 
  on_forage: false, 
  on_quest_complete: true 
};

export const DISCOVERY_CHANCE_BASE = { 
  serve: 0.02, 
  quest_complete: 0.06 
};

// Scroll discovery has its own base chance (independent from clues)
export const DISCOVERY_SCROLL_CHANCE_BASE = {
  serve: 0.007,
  quest_complete: 0.00
};

export const CLUES_TO_UNLOCK_RECIPE = 3;
export const CLUE_DUPLICATE_COINS = 25;
export const SCROLL_DUPLICATE_TOKEN_CHANCE = 0.50;
export const SCROLL_DUPLICATE_COINS = 80;

export const PROFILE_DEFAULT_TAGLINE = "A tiny shop with a big simmer.";
export const PROFILE_BADGES_SHOWN = 3;
export const PROFILE_COLLECTIONS_SHOWN = 3;

export const DISCOVERY_TIER_UNLOCK_LEVEL = { 
  rare: 5, 
  epic: 10, 
  seasonal: 12 
};

export const DISCOVERY_TIER_UNLOCK_REP = { 
  rare: 25, 
  epic: 100, 
  seasonal: 150 
};

// Recipe discovery weighting by tier (lower weight = rarer to discover)
export const DISCOVERY_RECIPE_TIER_WEIGHTS = {
  common: 1,
  rare: 0.45,
  epic: 0.2,
  seasonal: 0.1
};
