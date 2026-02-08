import { makeStreamRng, weightedPick } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import { calculateCombinedEffects } from "./upgrades.js";
import { calculateStaffEffects } from "./staff.js";

const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();

export function generateOrderBoard({ serverId, dayKey, settings, content, activeSeason, playerRecipePool, player, activeEventId = null }) {
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"orders", serverId, dayKey });
  const maxOrders = 100;
  const count = Math.min(Number(settings.ORDERS_BASE_COUNT ?? maxOrders), maxOrders);
  const tierWeights = settings.ORDER_TIER_WEIGHTS_BASE ?? { common:0.55, uncommon:0.22, rare:0.15, epic:0.06, seasonal:0.02 };

  const recipes = Object.values(content.recipes);

  const eligibleRecipes = recipes.filter((r) => {
    if (!playerRecipePool.has(r.recipe_id)) return false;
    if (r.event_id && (!activeEventId || r.event_id !== activeEventId)) return false;
    if (r.tier === "seasonal") return r.season === activeSeason;
    return true;
  });

  const seasonalRecipes = eligibleRecipes.filter((r) => r.tier === "seasonal" && r.season === activeSeason);
  const recipePoolsByTier = {
    common: eligibleRecipes.filter((r) => r.tier === "common"),
    uncommon: eligibleRecipes.filter((r) => r.tier === "uncommon"),
    rare: eligibleRecipes.filter((r) => r.tier === "rare"),
    epic: eligibleRecipes.filter((r) => r.tier === "epic"),
    seasonal: seasonalRecipes
  };

  const pickWeightedRecipeFrom = (recipeList) => {
    if (!recipeList.length) return null;
    const recipeWeights = Object.fromEntries(
      recipeList.map((r) => [r.recipe_id, Math.max(0.0001, Number(tierWeights?.[r.tier] ?? 0.01))])
    );
    const pickedId = weightedPick(rng, recipeWeights);
    return recipeList.find((r) => r.recipe_id === pickedId) ?? recipeList[Math.floor(rng() * recipeList.length)];
  };

  const blessing = player ? getActiveBlessing(player) : null;
  const npcBlessingActive = blessing?.type === "npc_weight_mult";
  const npcRarityMultipliers = BLESSING_EFFECTS.npc_weight_mult?.rarityMultipliers ?? {};
  const npcRarityWeights = settings.NPC_RARITY_WEIGHTS ?? {
    common: 1,
    uncommon: 0.85,
    rare: 0.55,
    epic: 0.25,
    seasonal: 0.08
  };

  const combinedEffects = player
    ? calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects)
    : null;
  const varietyBonus = combinedEffects?.npc_variety_bonus || 0;
  const rarityBoosts = { common: 0, uncommon: 0.5, rare: 1, epic: 1.5, seasonal: 2 };

  const buildNpcWeights = ({ allowSeasonal }) => Object.fromEntries(
    Object.values(content.npcs)
      .filter((npc) => {
        const rarity = npc?.rarity ?? "common";
        if (rarity === "seasonal") return allowSeasonal;
        return (recipePoolsByTier[rarity] || []).length > 0;
      })
      .map((npc) => {
        const rarity = npc?.rarity ?? "common";
        const baseWeight = npcRarityWeights[rarity] ?? 1;
        const rarityMult = npcBlessingActive ? (npcRarityMultipliers[rarity] ?? 1) : 1;
        const varietyMult = 1 + varietyBonus * (rarityBoosts[rarity] ?? 0);
        return [npc.npc_id, Math.max(0.01, baseWeight * rarityMult * varietyMult)];
      })
  );

  const npcWeights = buildNpcWeights({ allowSeasonal: seasonalRecipes.length > 0 });

  const board = [];
  for (let i=0;i<count;i++) {
    const npc = weightedPick(rng, npcWeights);
    const npcRarity = content.npcs?.[npc]?.rarity ?? "common";
    const recipePool = recipePoolsByTier[npcRarity] || [];
    const r = pickWeightedRecipeFrom(recipePool);
    if (!r) continue;
    const isLimited = npc === "rain_soaked_courier"
      ? true
      : rng() < Number(settings.LIMITED_TIME_CHANCE ?? 0.20);
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

export function ensureDailyOrders(serverState, settings, content, playerRecipePool, serverId, activeEventId = null) {
  const dayKey = dayKeyUTC();
  if (serverState.orders_day === dayKey && Array.isArray(serverState.order_board)) return serverState;

  const activeSeason = serverState.season ?? "spring";
  serverState.orders_day = dayKey;
  serverState.order_board = generateOrderBoard({ serverId, dayKey, settings, content, activeSeason, playerRecipePool, activeEventId });
  return serverState;
}

export function ensureDailyOrdersForPlayer(playerState, settings, content, activeSeason, serverId, userId, activeEventId = null) {
  const dayKey = dayKeyUTC();
  const orderSeedVersion = 3; // Increment when seed logic changes
  
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
    player: playerState,
    activeEventId
  });
  return playerState;
}
