import { makeStreamRng, weightedPick } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { getActiveBlessing, BLESSING_EFFECTS } from "./social.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import { calculateCombinedEffects } from "./upgrades.js";
import { calculateStaffEffects } from "./staff.js";

const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();
const MAX_ORDERS_CAP = 500;

export function computeOrderCount(settings, combinedEffects) {
  const base = Math.min(Number(settings.ORDERS_BASE_COUNT ?? MAX_ORDERS_CAP), MAX_ORDERS_CAP);
  const bonus = combinedEffects?.order_board_bonus ? Number(combinedEffects.order_board_bonus) : 0;
  const total = Math.max(1, Math.floor(base + bonus));
  return Math.min(total, MAX_ORDERS_CAP);
}

function buildRecipePools({ content, activeSeason, playerRecipePool, activeEventId }) {
  const recipes = Object.values(content.recipes);

  const eligibleRecipes = recipes.filter((r) => {
    if (!playerRecipePool.has(r.recipe_id)) return false;
    if (r.event_id && (!activeEventId || r.event_id !== activeEventId)) return false;
    if (r.tier === "seasonal") return r.season === activeSeason;
    return true;
  });

  const seasonalRecipes = eligibleRecipes.filter((r) => r.tier === "seasonal" && r.season === activeSeason);
  return {
    recipePoolsByTier: {
      common: eligibleRecipes.filter((r) => r.tier === "common"),
      uncommon: eligibleRecipes.filter((r) => r.tier === "uncommon"),
      rare: eligibleRecipes.filter((r) => r.tier === "rare"),
      epic: eligibleRecipes.filter((r) => r.tier === "epic"),
      seasonal: seasonalRecipes
    },
    hasSeasonal: seasonalRecipes.length > 0
  };
}

function buildNpcWeights({ content, recipePoolsByTier, hasSeasonal, settings, varietyBonus, npcBlessingActive, npcRarityMultipliers }) {
  const npcRarityWeights = settings.NPC_RARITY_WEIGHTS ?? {
    common: 1,
    uncommon: 0.85,
    rare: 0.55,
    epic: 0.25,
    seasonal: 0.08
  };

  const rarityBoosts = { common: 0, uncommon: 0.5, rare: 1, epic: 1.5, seasonal: 2 };

  return Object.fromEntries(
    Object.values(content.npcs)
      .filter((npc) => {
        const rarity = npc?.rarity ?? "common";
        if (rarity === "seasonal") return hasSeasonal;
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
}

function buildOrderId(dayKey, index, rng) {
  return `${dayKey}-o${index}-${Math.floor(rng() * 1e9)}`;
}

function pickWeightedRecipeFrom(rng, tierWeights, recipeList) {
  if (!recipeList.length) return null;
  const recipeWeights = Object.fromEntries(
    recipeList.map((r) => [r.recipe_id, Math.max(0.0001, Number(tierWeights?.[r.tier] ?? 0.01))])
  );
  const pickedId = weightedPick(rng, recipeWeights);
  return recipeList.find((r) => r.recipe_id === pickedId) ?? recipeList[Math.floor(rng() * recipeList.length)];
}

function generateOrdersStream({
  serverId,
  dayKey,
  settings,
  content,
  activeSeason,
  playerRecipePool,
  player,
  activeEventId = null,
  totalCount,
  consumedIndices = new Set(),
  offset = 0,
  limit = null
}) {
  const tierWeights = settings.ORDER_TIER_WEIGHTS_BASE ?? { common:0.55, uncommon:0.22, rare:0.15, epic:0.06, seasonal:0.02 };
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"orders", serverId, dayKey });
  const { recipePoolsByTier, hasSeasonal } = buildRecipePools({ content, activeSeason, playerRecipePool, activeEventId });

  const blessing = player ? getActiveBlessing(player) : null;
  const npcBlessingActive = blessing?.type === "npc_weight_mult";
  const npcRarityMultipliers = BLESSING_EFFECTS.npc_weight_mult?.rarityMultipliers ?? {};
  const combinedEffects = player
    ? calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects)
    : null;
  const varietyBonus = combinedEffects?.npc_variety_bonus || 0;

  const npcWeights = buildNpcWeights({
    content,
    recipePoolsByTier,
    hasSeasonal,
    settings,
    varietyBonus,
    npcBlessingActive,
    npcRarityMultipliers
  });

  const orders = [];
  const start = Math.max(0, offset);
  const end = limit ? start + limit : totalCount;

  const baselineId = playerRecipePool.has("classic_soy_ramen")
    ? "classic_soy_ramen"
    : (playerRecipePool.has("simple_broth") ? "simple_broth" : null);

  const includeBaseline = Boolean(baselineId);
  const loopStart = includeBaseline ? 1 : 0;

  if (includeBaseline && !consumedIndices.has(0) && end > 0 && start <= 0) {
    orders.push({
      order_index: 0,
      order_id: buildOrderId(dayKey, 0, rng),
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
  } else if (includeBaseline) {
    // Advance RNG for baseline even if not captured in slice so downstream order ids stay deterministic
    buildOrderId(dayKey, 0, rng);
  }

  for (let idx = loopStart; idx < totalCount; idx++) {
    const npc = weightedPick(rng, npcWeights);
    const npcRarity = content.npcs?.[npc]?.rarity ?? "common";
    const recipePool = recipePoolsByTier[npcRarity] || [];
    const r = pickWeightedRecipeFrom(rng, tierWeights, recipePool);
    if (!r) {
      buildOrderId(dayKey, idx, rng);
      continue;
    }

    const isLimited = npc === "rain_soaked_courier"
      ? true
      : rng() < Number(settings.LIMITED_TIME_CHANCE ?? 0.20);
    const createdAt = nowTs();
    const expiresAt = isLimited ? createdAt + 30*60*1000 : null;

    const order = {
      order_index: idx,
      order_id: buildOrderId(dayKey, idx, rng),
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
    };

    if (!consumedIndices.has(idx) && idx >= start && idx < end) {
      orders.push(order);
    }
  }

  return { orders, totalCount };
}

function buildRecipePoolSignature(playerRecipePool) {
  return Array.from(playerRecipePool).sort().join("|");
}

function getPlayerRecipePool(playerState) {
  const permanentRecipes = playerState.known_recipes || [];
  const tempRecipes = playerState.resilience?.temp_recipes || [];
  return new Set(tempRecipes.length > 0 ? tempRecipes : [...permanentRecipes, ...tempRecipes]);
}

export function ensureDailyOrders(serverState, settings, content, playerRecipePool, serverId, activeEventId = null) {
  const dayKey = dayKeyUTC();
  if (serverState.orders_day === dayKey && Array.isArray(serverState.order_board)) return serverState;

  const activeSeason = serverState.season ?? "spring";
  const combinedEffects = null;
  const count = computeOrderCount(settings, combinedEffects);
  serverState.orders_day = dayKey;
  serverState.order_board = generateOrdersStream({
    serverId,
    dayKey,
    settings,
    content,
    activeSeason,
    playerRecipePool,
    player: null,
    activeEventId,
    totalCount: count
  }).orders;
  return serverState;
}

export function ensureDailyOrdersForPlayer(playerState, settings, content, activeSeason, serverId, userId, activeEventId = null) {
  const dayKey = dayKeyUTC();
  const orderSeedVersion = 4; // Increment when seed logic changes

  if (playerState.orders_depleted_day && playerState.orders_depleted_day !== dayKey) {
    playerState.orders_depleted_day = null;
  }

  const playerRecipePool = getPlayerRecipePool(playerState);
  const poolSig = buildRecipePoolSignature(playerRecipePool);
  const combinedEffects = calculateCombinedEffects(playerState, upgradesContent, staffContent, calculateStaffEffects);
  const totalCount = computeOrderCount(settings, combinedEffects);

  const seedString = `${serverId}-${userId}-recipes-${poolSig}`;
  const dayChanged = playerState.orders_day !== dayKey;
  const seedChanged = playerState.orders_seed !== seedString || playerState.orders_pool_sig !== poolSig;
  const versionChanged = playerState.order_seed_version !== orderSeedVersion;

  if (dayChanged || seedChanged || versionChanged) {
    playerState.orders_day = dayKey;
    playerState.order_seed_version = orderSeedVersion;
    playerState.orders_seed = seedString;
    playerState.orders_pool_sig = poolSig;
    playerState.orders_consumed_indices = [];
    playerState.orders_total_count = totalCount;
    delete playerState.order_board; // free memory from legacy storage
  } else {
    playerState.orders_total_count = totalCount;
  }

  return playerState;
}

export function getOrdersMeta(playerState) {
  const consumed = Array.isArray(playerState.orders_consumed_indices) ? playerState.orders_consumed_indices : [];
  const consumedSet = new Set(consumed);
  const totalCount = Math.max(0, Number(playerState.orders_total_count ?? 0));
  const availableCount = Math.max(0, totalCount - consumedSet.size);
  return { totalCount, consumedSet, availableCount };
}

export function generateOrderPageForPlayer({
  playerState,
  settings,
  content,
  activeSeason,
  serverId,
  userId,
  activeEventId = null,
  page = 0,
  pageSize = 25
}) {
  const playerRecipePool = getPlayerRecipePool(playerState);
  const { totalCount, consumedSet } = getOrdersMeta(playerState);
  const offset = Math.max(0, page) * pageSize;
  const { orders } = generateOrdersStream({
    serverId: playerState.orders_seed || `${serverId}-${userId}`,
    dayKey: playerState.orders_day || dayKeyUTC(),
    settings,
    content,
    activeSeason,
    playerRecipePool,
    player: playerState,
    activeEventId,
    totalCount,
    consumedIndices: consumedSet,
    offset,
    limit: pageSize
  });

  return {
    orders,
    totalCount,
    availableCount: Math.max(0, totalCount - consumedSet.size)
  };
}

export function findOrderByToken({
  playerState,
  settings,
  content,
  activeSeason,
  serverId,
  userId,
  activeEventId = null,
  token
}) {
  if (!token) return null;
  const playerRecipePool = getPlayerRecipePool(playerState);
  const { totalCount, consumedSet } = getOrdersMeta(playerState);
  const target = token.toUpperCase();

  const { orders } = generateOrdersStream({
    serverId: playerState.orders_seed || `${serverId}-${userId}`,
    dayKey: playerState.orders_day || dayKeyUTC(),
    settings,
    content,
    activeSeason,
    playerRecipePool,
    player: playerState,
    activeEventId,
    totalCount,
    consumedIndices: consumedSet,
    offset: 0,
    limit: totalCount
  });

  return orders.find((o) => {
    const full = String(o.order_id).toUpperCase();
    const short = String(o.order_id).replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
    return full === target || short === target;
  }) || null;
}

export function markOrderConsumed(playerState, orderIndex) {
  if (!Number.isFinite(orderIndex)) return;
  if (!Array.isArray(playerState.orders_consumed_indices)) playerState.orders_consumed_indices = [];
  const existing = new Set(playerState.orders_consumed_indices);
  if (existing.has(orderIndex)) return;
  playerState.orders_consumed_indices.push(orderIndex);

  const totalCount = Number(playerState.orders_total_count ?? 0) || 0;
  if (playerState.orders_day && playerState.orders_consumed_indices.length >= totalCount) {
    playerState.orders_depleted_day = playerState.orders_day;
  }
}
