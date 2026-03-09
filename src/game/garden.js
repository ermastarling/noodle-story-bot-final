import { addIngredientsToInventory } from "./inventory.js";
import { applyHarvestCooldownReduction } from "./upgrades.js";

export const GARDEN_UNLOCK_LEVEL = 25;
export const BASE_GARDEN_PLOTS = 5;
export const BASE_COMPOST_CAP = 100;
export const COMPOST_PER_BAG = 5;
export const PLOT_YIELD = 5;
export const SPOILED_STASH_KEY = "spoiled_generic";

const COOLDOWN_BY_TIER_MS = {
  common: 60 * 60 * 1000,
  uncommon: 2 * 60 * 60 * 1000,
  rare: 3 * 60 * 60 * 1000
};

const CITRUS_COOLDOWN_MS = 5 * 60 * 60 * 1000;

const SEED_ALIASES = {
  citrus_peels: "citrus_seed",
  citrus_slices: "citrus_seed",
  petal_garnish: "flower_bush"
};

const SEED_DISPLAY = {
  citrus_seed: "Citrus Plants",
  flower_bush: "Flower Bushes"
};

export function isGardenUnlocked(player) {
  return (player?.shop_level ?? 0) >= GARDEN_UNLOCK_LEVEL;
}

export function canonicalSeedId(seedId) {
  return SEED_ALIASES[seedId] ?? seedId;
}

export function getSeedIdForIngredient(itemId) {
  return canonicalSeedId(itemId);
}

function normalizeSeedCounts(seeds = {}) {
  const merged = {};
  for (const [seedId, qty] of Object.entries(seeds)) {
    const canonical = canonicalSeedId(seedId);
    const n = Math.max(0, Number(qty) || 0);
    if (n <= 0) continue;
    merged[canonical] = (merged[canonical] || 0) + n;
  }
  return merged;
}

function normalizeYieldMap(raw, seedId = null) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = {};
    for (const [itemId, qty] of Object.entries(raw)) {
      const n = Math.max(0, Math.floor(Number(qty) || 0));
      if (n > 0) out[itemId] = n;
    }
    return out;
  }
  const n = Math.max(0, Math.floor(Number(raw ?? 0)));
  if (!seedId || n <= 0) return {};
  return { [seedId]: n };
}

export function getYieldTotal(yieldMap = {}) {
  return Object.values(yieldMap || {}).reduce((sum, v) => sum + (v || 0), 0);
}

export function ensureGardenState(player) {
  if (!player.garden) {
    player.garden = { seeds: {}, spoiled: {}, compost_bags: 0, plots: [] };
  }
  if (!player.garden.seeds) player.garden.seeds = {};
  if (!player.garden.spoiled) player.garden.spoiled = {};
  if (!Number.isFinite(player.garden.compost_bags)) player.garden.compost_bags = 0;
  if (!Array.isArray(player.garden.plots)) player.garden.plots = [];
  player.garden.seeds = normalizeSeedCounts(player.garden.seeds);
  return player.garden;
}

export function ensureGardenPlots(player, effects = {}) {
  const garden = ensureGardenState(player);
  const target = Math.max(0, getGardenPlotCount(player, effects));
  if (!Array.isArray(garden.plots)) garden.plots = [];
  if (garden.plots.length > target) {
    garden.plots = garden.plots.slice(0, target);
  }
  while (garden.plots.length < target) {
    garden.plots.push({ seed_id: null, remaining: 0, harvest_ready_at: 0 });
  }
  garden.plots = garden.plots.map((plot) => {
    const rawSeedId = plot?.seed_id ?? null;
    const canonical = canonicalSeedId(rawSeedId);
    return {
      seed_id: canonical,
      remaining: normalizeYieldMap(plot?.remaining, rawSeedId),
      total_yield: normalizeYieldMap(plot?.total_yield ?? plot?.remaining, rawSeedId),
      harvest_ready_at: Number(plot?.harvest_ready_at ?? 0)
    };
  });
  return garden.plots;
}

export function getGardenPlotCount(player, effects = {}) {
  const bonus = Math.floor(effects.garden_plot_bonus || 0);
  return BASE_GARDEN_PLOTS + bonus;
}

export function getSeedDisplayName(seedId, content) {
  const canonical = canonicalSeedId(seedId);
  if (SEED_DISPLAY[canonical]) return SEED_DISPLAY[canonical];
  return getItemName(canonical, content);
}

export function getSeedTier(seedId, content) {
  const canonical = canonicalSeedId(seedId);
  if (canonical === "flower_bush") return content?.items?.petal_garnish?.tier ?? "uncommon";
  if (canonical === "citrus_seed") return content?.items?.citrus_peels?.tier ?? "common";
  return content?.items?.[canonical]?.tier ?? "common";
}

export function getSeedBaseCooldownMs(seedId, content) {
  const canonical = canonicalSeedId(seedId);
  if (canonical === "citrus_seed") return CITRUS_COOLDOWN_MS;
  const tier = getSeedTier(canonical, content);
  return COOLDOWN_BY_TIER_MS[tier] ?? COOLDOWN_BY_TIER_MS.common;
}

export function getSeedYieldMap(seedId, { allowedIngredients = null } = {}) {
  const canonical = canonicalSeedId(seedId);
  const allowedSet = allowedIngredients ? new Set(allowedIngredients) : null;

  if (canonical === "citrus_seed") {
    const hasPeels = !allowedSet || allowedSet.has("citrus_peels");
    const hasSlices = !allowedSet || allowedSet.has("citrus_slices");
    if (hasPeels && hasSlices) return { citrus_peels: PLOT_YIELD, citrus_slices: PLOT_YIELD };
    if (hasSlices) return { citrus_slices: PLOT_YIELD };
    return { citrus_peels: PLOT_YIELD };
  }

  if (canonical === "flower_bush") {
    return { petal_garnish: PLOT_YIELD };
  }

  return { [canonical]: PLOT_YIELD };
}

export function describeYieldMap(yieldMap = {}, content) {
  const entries = Object.entries(yieldMap || {});
  if (!entries.length) return "nothing";
  return entries
    .map(([itemId, qty]) => `${qty} ${getItemName(itemId, content)}`)
    .join(" + ");
}

export function getCompostCap(player, effects = {}) {
  void player; // compost cap is now flat
  void effects;
  return BASE_COMPOST_CAP;
}

export function getPlotYieldRemaining(plot) {
  return normalizeYieldMap(plot?.remaining, canonicalSeedId(plot?.seed_id ?? null));
}

export function getPlotTotalYield(plot) {
  const canonical = canonicalSeedId(plot?.seed_id ?? null);
  return normalizeYieldMap(plot?.total_yield ?? plot?.remaining, canonical);
}

export function addSeeds(player, seedDrops) {
  const garden = ensureGardenState(player);
  for (const [itemId, qty] of Object.entries(seedDrops || {})) {
    if (!qty || qty <= 0) continue;
    const canonical = canonicalSeedId(itemId);
    garden.seeds[canonical] = (garden.seeds[canonical] || 0) + qty;
  }
  return garden.seeds;
}

export function stashSpoiledIngredient(player, itemId, qty) {
  // Don’t stash spoiled items until the garden feature is unlocked
  if (!qty || qty <= 0) return 0;
  if (!isGardenUnlocked(player)) return 0;
  const garden = ensureGardenState(player);
  const key = SPOILED_STASH_KEY;
  garden.spoiled[key] = (garden.spoiled[key] || 0) + qty;
  return garden.spoiled[key];
}

export function totalSpoiledCount(player) {
  const garden = ensureGardenState(player);
  return Object.values(garden.spoiled || {}).reduce((sum, v) => sum + (v || 0), 0);
}

export function getCompostableForageables(player, content) {
  const inv = player?.inv_ingredients || {};
  const compostable = {};
  for (const [itemId, qty] of Object.entries(inv)) {
    if (!qty || qty <= 0) continue;
    const item = content.items?.[itemId];
    if (!item || item.acquisition !== "forage") continue;
    compostable[itemId] = qty;
  }
  return compostable;
}

export function craftCompostBags(player, content, effects = {}, { maxBags = null } = {}) {
  const garden = ensureGardenState(player);
  if (!player.inv_ingredients) player.inv_ingredients = {};
  const compostCap = getCompostCap(player, effects);
  const room = compostCap - (garden.compost_bags || 0);
  if (room <= 0) {
    return { bagsMade: 0, reason: "capacity", compostCap };
  }

  const spoiled = { ...garden.spoiled };
  const pantryForageables = getCompostableForageables(player, content);

  const spoiledCount = Object.values(spoiled).reduce((sum, v) => sum + (v || 0), 0);
  const pantryCount = Object.values(pantryForageables).reduce((sum, v) => sum + (v || 0), 0);
  const totalUnits = spoiledCount + pantryCount;
  const maxCraftable = Math.floor(totalUnits / COMPOST_PER_BAG);
  const targetBags = Math.min(room, maxBags ?? maxCraftable);

  if (targetBags <= 0) {
    return { bagsMade: 0, reason: "materials", compostCap };
  }

  let needed = targetBags * COMPOST_PER_BAG;
  const spoiledUsed = {};
  for (const [itemId, qty] of Object.entries(garden.spoiled)) {
    if (needed <= 0) break;
    const use = Math.min(qty, needed);
    if (use > 0) {
      garden.spoiled[itemId] = qty - use;
      needed -= use;
      spoiledUsed[itemId] = use;
      if (garden.spoiled[itemId] <= 0) delete garden.spoiled[itemId];
    }
  }

  const pantryUsed = {};
  if (needed > 0) {
    for (const [itemId, qty] of Object.entries(pantryForageables)) {
      if (needed <= 0) break;
      const use = Math.min(qty, needed);
      if (use > 0) {
        player.inv_ingredients[itemId] = Math.max(0, (player.inv_ingredients[itemId] || 0) - use);
        needed -= use;
        pantryUsed[itemId] = use;
        if (player.inv_ingredients[itemId] === 0) delete player.inv_ingredients[itemId];
      }
    }
  }

  const bagsMade = targetBags;
  garden.compost_bags += bagsMade;

  return {
    bagsMade,
    spoiledUsed,
    pantryUsed,
    compostAfter: garden.compost_bags,
    compostCap,
    reason: bagsMade > 0 ? "ok" : "materials"
  };
}

export function plantSeedInPlot(player, seedId, content, effects = {}, { now = Date.now(), allowedIngredients = null } = {}) {
  const garden = ensureGardenState(player);
  const plots = ensureGardenPlots(player, effects);
  if (!seedId) return { ok: false, reason: "no_seed" };
  const canonical = canonicalSeedId(seedId);
  const seedsAvailable = garden.seeds?.[canonical] || 0;
  if (seedsAvailable <= 0) return { ok: false, reason: "no_seeds" };
  if ((garden.compost_bags || 0) <= 0) return { ok: false, reason: "no_compost" };

  const emptyIndex = plots.findIndex((plot) => !plot.seed_id && getYieldTotal(getPlotYieldRemaining(plot)) <= 0);
  if (emptyIndex === -1) return { ok: false, reason: "no_empty_plot" };

  const baseCooldown = getSeedBaseCooldownMs(canonical, content);
  const readyIn = Math.max(30 * 1000, applyHarvestCooldownReduction(baseCooldown, effects));

  const yieldMap = getSeedYieldMap(canonical, { allowedIngredients });
  const totalYield = getYieldTotal(yieldMap);
  if (totalYield <= 0) return { ok: false, reason: "no_yield" };

  garden.seeds[canonical] = seedsAvailable - 1;
  if (garden.seeds[canonical] <= 0) delete garden.seeds[canonical];
  garden.compost_bags -= 1;

  plots[emptyIndex] = {
    seed_id: canonical,
    remaining: yieldMap,
    total_yield: yieldMap,
    harvest_ready_at: now + readyIn
  };

  return {
    ok: true,
    plotIndex: emptyIndex,
    seedId: canonical,
    remaining: yieldMap,
    compostAfter: garden.compost_bags,
    harvestReadyAt: now + readyIn
  };
}

export function harvestGardenPlots(
  player,
  content,
  effects = {},
  { plotIndex = null, now = Date.now(), onlyReady = false, allowedIngredients = null } = {}
) {
  const plots = ensureGardenPlots(player, effects);
  const targets = plotIndex === null ? plots.map((_, idx) => idx) : [plotIndex];
  const results = [];
  const totalAdded = {};
  const seedBonus = {};
  let anyHarvestable = false;

  for (const idx of targets) {
    const plot = plots[idx];
    const seedId = canonicalSeedId(plot?.seed_id ?? null);
    const remainingMap = getPlotYieldRemaining(plot);
    const remainingTotal = getYieldTotal(remainingMap);
    if (!plot || !seedId || remainingTotal <= 0) continue;
    if (onlyReady && plot.harvest_ready_at && plot.harvest_ready_at > now) continue;
    anyHarvestable = true;

    if (plot.harvest_ready_at && plot.harvest_ready_at > now) {
      results.push({
        plotIndex: idx,
        seedId,
        added: 0,
        addedItems: {},
        leftover: remainingTotal,
        leftoverItems: remainingMap,
        blocked: true,
        notReady: true,
        readyAt: plot.harvest_ready_at
      });
      continue;
    }

    const invResult = addIngredientsToInventory(player, remainingMap, "truncate");
    const addedItems = invResult.added || {};
    const leftoverItems = {};
    for (const [itemId, qty] of Object.entries(remainingMap)) {
      const added = addedItems[itemId] || 0;
      const leftover = Math.max(0, qty - added);
      if (leftover > 0) leftoverItems[itemId] = leftover;
      if (added > 0) {
        totalAdded[itemId] = (totalAdded[itemId] || 0) + added;
      }
    }

    plot.remaining = leftoverItems;
    if (Object.keys(plot.remaining).length === 0) {
      plots[idx] = { seed_id: null, remaining: 0, total_yield: {}, harvest_ready_at: 0 };
    }

    const harvestSeedChance = Math.min(0.5, effects.garden_harvest_seed_chance || 0);
    if (harvestSeedChance > 0 && Math.random() < harvestSeedChance) {
      seedBonus[seedId] = (seedBonus[seedId] || 0) + 1;
    }

    const addedTotal = getYieldTotal(addedItems);
    const leftoverTotal = getYieldTotal(leftoverItems);

    results.push({
      plotIndex: idx,
      seedId,
      added: addedTotal,
      addedItems,
      leftover: leftoverTotal,
      leftoverItems,
      blocked: leftoverTotal > 0,
      readyAt: 0
    });
  }

  if (Object.keys(seedBonus).length) {
    addSeeds(player, seedBonus);
  }

  return {
    results,
    added: totalAdded,
    seedBonus,
    anyHarvestable,
    harvestedPlots: results.filter((r) => r.added > 0).length
  };
}

export function autoHarvestReadyPlots(player, content, effects = {}, { now = Date.now(), allowedIngredients = null } = {}) {
  const result = harvestGardenPlots(player, content, effects, { now, onlyReady: true, allowedIngredients });
  const harvested = result.results.filter((r) => !r.notReady && r.added > 0);
  return {
    harvested,
    seedBonus: result.seedBonus,
    added: result.added
  };
}

export function formatSeedLines(seeds = {}, content) {
  const entries = Object.entries(seeds).filter(([, qty]) => qty > 0);
  if (!entries.length) return "_No seeds collected yet._";
  return entries
    .map(([seedId, qty]) => [seedId, qty, getSeedDisplayName(seedId, content)])
    .sort(([, , nameA], [, , nameB]) => nameA.localeCompare(nameB))
    .map(([seedId, qty, name]) => `• ${name}: **${qty} seeds**`)
    .join("\n");
}

export function formatSpoiledLines(spoiled = {}, content) {
  const total = Object.values(spoiled || {}).reduce((sum, v) => sum + (v || 0), 0);
  if (!total) return "_No spoiled ingredients saved._";
  return `• Spoiled ingredients: **${total}**`;
}

export function formatPlotLines(player, content, effects = {}, now = Date.now()) {
  const plots = ensureGardenPlots(player, effects);
  if (!plots.length) return "_No plots available yet._";
  return plots
    .map((plot, idx) => {
      const label = `Plot ${idx + 1}`;
      const remainingMap = getPlotYieldRemaining(plot);
      const remainingTotal = getYieldTotal(remainingMap);
      if (!plot?.seed_id || remainingTotal <= 0) {
        return `${label}: Empty`;
      }
      const totalYield = getYieldTotal(getPlotTotalYield(plot));
      const readyText = !plot.harvest_ready_at || plot.harvest_ready_at <= now
        ? "ready"
        : `ready ${formatTimestamp(plot.harvest_ready_at)}`;
      const seedName = getSeedDisplayName(plot.seed_id, content);
      const progressTotal = totalYield || remainingTotal;
      return `${label}: ${seedName} — **${remainingTotal}/${progressTotal}** left (${readyText})`;
    })
    .join("\n");
}

function getItemName(itemId, content) {
  return content?.items?.[itemId]?.name ?? itemId;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTimestamp(ms) {
  const ts = Math.floor(ms / 1000);
  return `<t:${ts}:R>`;
}
