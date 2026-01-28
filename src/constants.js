export const DATA_SCHEMA_VERSION = 1;

export const STARTER_PROFILE = {
  coins: 120,
  rep: 0,
  shop_level: 1,
  sxp_total: 0,
  sxp_progress: 0,
  known_recipes: ["classic_soy_ramen"],
  inv_ingredients: { soy_broth: 3, wheat_noodles: 3, scallions: 2 },
};

export const TUTORIAL_QUESTS = ["intro_market", "intro_cook", "intro_orders", "intro_serve"];

export const COIN_BASE = { common: 27, rare: 68, epic: 245, seasonal: 285 };
export const SXP_BASE  = { common: 20, rare: 45, epic: 90, seasonal: 110 };
export const REP_BASE  = { common: 3,  rare: 7,  epic: 15, seasonal: 20 };

export function sxpToNext(level) {
  return 100 + 25 * level;
}
