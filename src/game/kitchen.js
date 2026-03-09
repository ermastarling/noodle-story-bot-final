import { nowTs } from "../util/time.js";
import { FORAGE_ITEM_IDS } from "./forage.js";

export const KITCHEN_UNLOCK_LEVEL = 45;
export const KITCHEN_SIMMER_MS = 15 * 60 * 1000;
export const KITCHEN_FORAGE_PER_BROTH = 5;
export const KITCHEN_BASE_SLOTS = 10;

// Per-broth forage recipes. Totals currently sum to 5 to match legacy cost expectations.
export const KITCHEN_BROTH_RECIPES = {
  broth_soy: [
    { item_id: "scallions", qty: 2 },
    { item_id: "carrots", qty: 2 },
    { item_id: "citrus_peels", qty: 1 }
  ],
  broth_ginger: [
    { item_id: "root_vegetables", qty: 2 },
    { item_id: "citrus_slices", qty: 1 },
    { item_id: "scallions", qty: 1 },
    { item_id: "wild_greens", qty: 1 }
  ],
  broth_butter: [
    { item_id: "carrots", qty: 2 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "root_vegetables", qty: 2 }
  ],
  broth_sweet_soy: [
    { item_id: "citrus_slices", qty: 2 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "scallions", qty: 1 },
    { item_id: "carrots", qty: 1 }
  ],
  broth_chicken: [
    { item_id: "root_vegetables", qty: 2 },
    { item_id: "carrots", qty: 2 },
    { item_id: "wild_greens", qty: 1 }
  ],
  broth_rich_stock: [
    { item_id: "forest_mushrooms", qty: 2 },
    { item_id: "root_vegetables", qty: 1 },
    { item_id: "scallions", qty: 1 },
    { item_id: "black_garlic", qty: 1 }
  ],
  broth_chili: [
    { item_id: "ember_peppers", qty: 1 },
    { item_id: "citrus_peels", qty: 1 },
    { item_id: "carrots", qty: 2 },
    { item_id: "scallions", qty: 1 }
  ],
  broth_light: [
    { item_id: "wild_greens", qty: 2 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "citrus_peels", qty: 1 },
    { item_id: "scallions", qty: 1 }
  ],
  broth_beef: [
    { item_id: "forest_mushrooms", qty: 2 },
    { item_id: "root_vegetables", qty: 2 },
    { item_id: "carrots", qty: 1 }
  ],
  broth_mixed: [
    { item_id: "wild_greens", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "citrus_slices", qty: 1 },
    { item_id: "carrots", qty: 1 },
    { item_id: "root_vegetables", qty: 1 }
  ],
  broth_herbal: [
    { item_id: "wild_greens", qty: 2 },
    { item_id: "dew_greens", qty: 2 },
    { item_id: "night_herbs", qty: 1 }
  ],
  broth_miso: [
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "root_vegetables", qty: 2 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "scallions", qty: 1 }
  ],
  broth_black_garlic: [
    { item_id: "black_garlic", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "night_herbs", qty: 1 },
    { item_id: "carrots", qty: 1 },
    { item_id: "scallions", qty: 1 }
  ],
  broth_shio: [
    { item_id: "citrus_peels", qty: 1 },
    { item_id: "citrus_slices", qty: 1 },
    { item_id: "scallions", qty: 1 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "wild_greens", qty: 1 }
  ],
  broth_citrus_infused: [
    { item_id: "citrus_peels", qty: 2 },
    { item_id: "citrus_slices", qty: 2 },
    { item_id: "dew_greens", qty: 1 }
  ],
  broth_glowing_miso: [
    { item_id: "night_spices", qty: 1 },
    { item_id: "star_anise", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "root_vegetables", qty: 1 }
  ],
  broth_fire: [
    { item_id: "ember_peppers", qty: 1 },
    { item_id: "night_spices", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "carrots", qty: 1 },
    { item_id: "citrus_peels", qty: 1 }
  ],
  broth_floral: [
    { item_id: "petal_garnish", qty: 1 },
    { item_id: "dew_greens", qty: 2 },
    { item_id: "wild_greens", qty: 1 },
    { item_id: "citrus_slices", qty: 1 }
  ],
  broth_sakura: [
    { item_id: "petal_garnish", qty: 1 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "citrus_slices", qty: 1 },
    { item_id: "scallions", qty: 1 },
    { item_id: "wild_greens", qty: 1 }
  ],
  broth_chilled_citrus: [
    { item_id: "citrus_peels", qty: 2 },
    { item_id: "citrus_slices", qty: 1 },
    { item_id: "dew_greens", qty: 1 },
    { item_id: "night_herbs", qty: 1 }
  ],
  broth_pumpkin: [
    { item_id: "roasted_roots", qty: 1 },
    { item_id: "root_vegetables", qty: 2 },
    { item_id: "carrots", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 }
  ],
  broth_creamy_hearth: [
    { item_id: "roasted_roots", qty: 1 },
    { item_id: "forest_mushrooms", qty: 1 },
    { item_id: "black_garlic", qty: 1 },
    { item_id: "carrots", qty: 1 },
    { item_id: "root_vegetables", qty: 1 }
  ]
};

export function getBrothRecipe(brothId) {
  return KITCHEN_BROTH_RECIPES[brothId] ?? null;
}

export function isKitchenUnlocked(player) {
  return (player?.shop_level ?? 1) >= KITCHEN_UNLOCK_LEVEL;
}

export function ensureKitchenState(player) {
  if (!player.kitchen) {
    player.kitchen = { active_batches: [], unlock_seen_level: player?.shop_level ?? 1 };
  }

  // Migrate legacy single-batch state
  if (player.kitchen.active_batch && !player.kitchen.active_batches) {
    player.kitchen.active_batches = [player.kitchen.active_batch];
    delete player.kitchen.active_batch;
  }

  if (!Array.isArray(player.kitchen.active_batches)) {
    player.kitchen.active_batches = [];
  }

  const seenLevelRaw = Number(player.kitchen.unlock_seen_level ?? player?.shop_level ?? 1);
  player.kitchen.unlock_seen_level = Number.isFinite(seenLevelRaw)
    ? seenLevelRaw
    : player?.shop_level ?? 1;

  const state = player.kitchen;
  const now = nowTs();
  state.active_batches = state.active_batches.map((batch, idx) => {
    if (!batch.id) {
      batch.id = `kb_${batch.broth_id ?? "broth"}_${batch.started_at ?? now}_${idx}`;
    }
    return batch;
  });

  return state;
}

export function getKitchenUnlockState(player) {
  const level = Number(player?.shop_level ?? 1);
  const unlocked = isKitchenUnlocked(player);
  const state = ensureKitchenState(player);
  const seenLevel = Number.isFinite(state.unlock_seen_level)
    ? state.unlock_seen_level
    : level;
  const justUnlocked = unlocked && seenLevel < KITCHEN_UNLOCK_LEVEL;

  state.unlock_seen_level = Math.max(seenLevel, level);

  return { unlocked, justUnlocked, seenLevel: state.unlock_seen_level };
}

export function getKitchenBatches(player, now = nowTs()) {
  const state = ensureKitchenState(player);
  return (state.active_batches ?? []).map((batch) => {
    const remainingMs = Math.max(0, (batch?.ready_at ?? 0) - now);
    return {
      ...batch,
      remainingMs,
      ready: remainingMs <= 0
    };
  });
}

export function getKitchenStatus(player, now = nowTs()) {
  const batches = getKitchenBatches(player, now);
  const readyBatches = batches.filter((b) => b.ready);
  const nextReadyMs = batches.length ? Math.min(...batches.map((b) => b.remainingMs)) : null;
  return {
    batches,
    readyCount: readyBatches.length,
    nextReadyMs
  };
}

export function getKitchenCapacity(player, effects = {}) {
  const bonus = Number(effects.kitchen_simmer_capacity ?? 0);
  return Math.max(0, KITCHEN_BASE_SLOTS + bonus);
}

export function getKitchenSimmerDurationMs(effects = {}) {
  const reduction = Math.max(0, Math.min(0.9, Number(effects.kitchen_simmer_time_reduction ?? 0)));
  const duration = Math.floor(KITCHEN_SIMMER_MS * (1 - reduction));
  return Math.max(1000, duration);
}

export function getKitchenForagePool(player) {
  const pool = {};
  for (const id of FORAGE_ITEM_IDS) {
    const qty = Math.max(0, Number(player?.inv_ingredients?.[id] ?? 0));
    if (qty > 0) pool[id] = qty;
  }
  return pool;
}

export function getCraftableCountForBroth(player, brothId) {
  const recipe = getBrothRecipe(brothId);
  if (!recipe || !recipe.length) return 0;

  let limit = Infinity;
  for (const req of recipe) {
    const id = req?.item_id;
    const need = Math.max(0, Number(req?.qty ?? 0));
    if (!id || need <= 0) continue;
    const have = Math.max(0, Number(player?.inv_ingredients?.[id] ?? 0));
    const batches = Math.floor(have / need);
    limit = Math.min(limit, batches);
  }

  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, limit);
}

export function planKitchenIngredients(player, brothId) {
  const recipe = getBrothRecipe(brothId);
  if (!recipe || !recipe.length) {
    return {
      recipeMissing: true,
      used: {},
      missing: {},
      remaining: KITCHEN_FORAGE_PER_BROTH,
      neededTotal: KITCHEN_FORAGE_PER_BROTH,
      ok: false
    };
  }

  const used = {};
  const missing = {};
  let neededTotal = 0;
  let missingTotal = 0;

  for (const req of recipe) {
    const id = req?.item_id;
    const need = Math.max(0, Number(req?.qty ?? 0));
    if (!id || need <= 0) continue;

    const have = Math.max(0, Number(player?.inv_ingredients?.[id] ?? 0));
    used[id] = need;
    neededTotal += need;

    if (have < need) {
      missing[id] = need - have;
      missingTotal += need - have;
    }
  }

  return {
    used,
    missing,
    remaining: missingTotal,
    neededTotal,
    ok: missingTotal === 0
  };
}
