import { makeStreamRng, weightedPick } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import { calculateCombinedEffects } from "./upgrades.js";
import { calculateStaffEffects } from "./staff.js";

const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();

export function generateOrderBoard({ serverId, dayKey, settings, content, activeSeason, playerRecipePool, player }) {
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"orders", serverId, dayKey });
  const maxOrders = 100;
  const count = Math.min(Number(settings.ORDERS_BASE_COUNT ?? maxOrders), maxOrders);
  const tierWeights = settings.ORDER_TIER_WEIGHTS_BASE ?? { common:0.70, rare:0.25, epic:0.04, seasonal:0.01 };

  const recipes = Object.values(content.recipes);

  const getEligibleRecipes = () => recipes.filter((r) => {
    if (!playerRecipePool.has(r.recipe_id)) return false;
    if (r.tier === "seasonal") return r.season === activeSeason;
    return true;
  });

  const pickWeightedRecipe = () => {
    const eligible = getEligibleRecipes();
    if (!eligible.length) return null;
    const recipeWeights = Object.fromEntries(
      eligible.map((r) => [r.recipe_id, Math.max(0.0001, Number(tierWeights?.[r.tier] ?? 0.01))])
    );
    const pickedId = weightedPick(rng, recipeWeights);
    return eligible.find((r) => r.recipe_id === pickedId) ?? eligible[Math.floor(rng() * eligible.length)];
  };

  const blessing = player ? getActiveBlessing(player) : null;
  const npcBlessingActive = blessing?.type === "npc_weight_mult";
  const npcRarityMultipliers = BLESSING_EFFECTS.npc_weight_mult?.rarityMultipliers ?? {};
  const npcRarityWeights = settings.NPC_RARITY_WEIGHTS ?? {
    common: 1,
    uncommon: 1,
    rare: 1,
    epic: 1,
    seasonal: 1
  };

  const combinedEffects = player
    ? calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects)
    : null;
  const varietyBonus = combinedEffects?.npc_variety_bonus || 0;
  const rarityBoosts = { common: 0, uncommon: 0.5, rare: 1, epic: 1.5, seasonal: 2 };

  const npcWeights = Object.fromEntries(
    Object.values(content.npcs).map((npc) => {
      const rarity = npc?.rarity ?? "common";
      const baseWeight = npcRarityWeights[rarity] ?? 1;
      const rarityMult = npcBlessingActive ? (npcRarityMultipliers[rarity] ?? 1) : 1;
      const varietyMult = 1 + varietyBonus * (rarityBoosts[rarity] ?? 0);
      return [npc.npc_id, Math.max(0.01, baseWeight * rarityMult * varietyMult)];
    })
  );

  const board = [];
  for (let i=0;i<count;i++) {
    const r = pickWeightedRecipe();
    if (!r) continue;

    const npc = weightedPick(rng, npcWeights);
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
  const orderSeedVersion = 2; // Increment when seed logic changes
  
  // Include temporary recipes in pool (B5: Order Board Guarantee)
  const permanentRecipes = playerState.known_recipes || [];
  const tempRecipes = playerState.resilience?.temp_recipes || [];
  // If temporary recipes exist (recovery mode), use them as the pool
  const playerRecipePool = new Set(
    tempRecipes.length > 0 ? tempRecipes : [...permanentRecipes, ...tempRecipes]
  );

  if (playerState.orders_day === dayKey 
      && playerState.order_seed_version === orderSeedVersion
      && Array.isArray(playerState.order_board)) {
    // Regenerate if no orders match the player's current recipe pool
    const hasPoolOrder = playerState.order_board.some((o) => playerRecipePool.has(o.recipe_id));
    if (hasPoolOrder) return playerState;
  }

  // Include recipe pool size in seed so orders change when learning new recipes
  const seedString = `${serverId}-${userId}-recipes${playerRecipePool.size}`;
  playerState.orders_day = dayKey;
  playerState.order_seed_version = orderSeedVersion;
  playerState.order_board = generateOrderBoard({
    serverId: seedString,
    dayKey,
    settings,
    content,
    activeSeason,
    playerRecipePool,
    player: playerState
  });
  return playerState;
}
