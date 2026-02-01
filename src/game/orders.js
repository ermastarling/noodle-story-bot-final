import { makeStreamRng, weightedPick } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";

export function generateOrderBoard({ serverId, dayKey, settings, content, activeSeason, playerRecipePool }) {
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"orders", serverId, dayKey });
  const maxOrders = 100;
  const count = Math.min(Number(settings.ORDERS_BASE_COUNT ?? maxOrders), maxOrders);
  const tierWeights = settings.ORDER_TIER_WEIGHTS_BASE ?? { common:0.70, rare:0.25, epic:0.04, seasonal:0.01 };

  const recipes = Object.values(content.recipes);

  const pickRecipeByTier = (tier) => {
    const pool = recipes.filter(r => r.tier === tier && playerRecipePool.has(r.recipe_id));
    if (pool.length === 0) return null;
    return pool[Math.floor(rng()*pool.length)];
  };

  const board = [];
  for (let i=0;i<count;i++) {
    const tier = weightedPick(rng, tierWeights);
    const r = pickRecipeByTier(tier) ?? pickRecipeByTier("common");
    if (!r) continue;

    const npcKeys = Object.keys(content.npcs);
    const npc = npcKeys[Math.floor(rng()*npcKeys.length)];
    const isLimited = rng() < Number(settings.LIMITED_TIME_CHANCE ?? 0.20);
    const createdAt = nowTs();
    const expiresAt = isLimited ? createdAt + 30*60*1000 : null;

    board.push({
      order_id: `${dayKey}-${i}-${Math.floor(rng()*1e9)}`,
      tier: r.tier,
      npc_archetype: npc,
      recipe_id: r.recipe_id,
      is_limited_time: isLimited,
      created_at: createdAt,
      expires_at: expiresAt,
      speed_window_seconds: isLimited ? 120 : null,
      base_reward_override: null,
      modifiers: {},
      season: (r.tier === "seasonal") ? activeSeason : null
    });
  }

  const baselineId = playerRecipePool.has("classic_soy_ramen")
    ? "classic_soy_ramen"
    : (playerRecipePool.has("simple_broth") ? "simple_broth" : null);
  // Only add baseline if player has it in their recipe pool
  if (baselineId && !board.some(o => o.recipe_id === baselineId)) {
    board.unshift({
      order_id: `${dayKey}-baseline-${Math.floor(rng()*1e9)}`,
      tier: "common",
      npc_archetype: "sleepy_traveler",
      recipe_id: baselineId,
      is_limited_time: false,
      created_at: nowTs(),
      expires_at: null,
      speed_window_seconds: null,
      base_reward_override: null,
      modifiers: {},
      season: null
    });
  }

  return board.slice(0, Math.min(board.length, maxOrders));
}

export function ensureDailyOrders(serverState, settings, content, playerRecipePool, serverId) {
  const dayKey = dayKeyUTC();
  if (serverState.orders_day === dayKey && Array.isArray(serverState.order_board)) return serverState;

  const activeSeason = serverState.season ?? "spring";
  serverState.orders_day = dayKey;
  serverState.order_board = generateOrderBoard({ serverId, dayKey, settings, content, activeSeason, playerRecipePool });
  return serverState;
}

export function ensureDailyOrdersForPlayer(playerState, settings, content, activeSeason, serverId, userId) {
  const dayKey = dayKeyUTC();
  // Include temporary recipes in pool (B5: Order Board Guarantee)
  const permanentRecipes = playerState.known_recipes || [];
  const tempRecipes = playerState.resilience?.temp_recipes || [];
  // If temporary recipes exist (recovery mode), use them as the pool
  const playerRecipePool = new Set(
    tempRecipes.length > 0 ? tempRecipes : [...permanentRecipes, ...tempRecipes]
  );

  if (playerState.orders_day === dayKey && Array.isArray(playerState.order_board)) {
    // Regenerate if no orders match the player's current recipe pool
    const hasPoolOrder = playerState.order_board.some((o) => playerRecipePool.has(o.recipe_id));
    if (hasPoolOrder) return playerState;
  }

  const seedString = `${serverId}-${userId}`;
  playerState.orders_day = dayKey;
  playerState.order_board = generateOrderBoard({ serverId: seedString, dayKey, settings, content, activeSeason, playerRecipePool });
  return playerState;
}
