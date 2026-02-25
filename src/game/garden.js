import { addIngredientsToInventory } from "./inventory.js";
import { applyCooldownReduction } from "./upgrades.js";

export const GARDEN_UNLOCK_LEVEL = 25;
export const BASE_GARDEN_PLOTS = 5;
export const BASE_COMPOST_CAP = 100;
export const COMPOST_PER_BAG = 5;
export const PLOT_YIELD = 5;
export const PLOT_BASE_COOLDOWN_MS = 5 * 60 * 1000;

export function isGardenUnlocked(player) {
  return (player?.shop_level ?? 0) >= GARDEN_UNLOCK_LEVEL;
}

export function ensureGardenState(player) {
  if (!player.garden) {
    player.garden = { seeds: {}, spoiled: {}, compost_bags: 0, plots: [] };
  }
  if (!player.garden.seeds) player.garden.seeds = {};
  if (!player.garden.spoiled) player.garden.spoiled = {};
  if (!Number.isFinite(player.garden.compost_bags)) player.garden.compost_bags = 0;
  if (!Array.isArray(player.garden.plots)) player.garden.plots = [];
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
  garden.plots = garden.plots.map((plot) => ({
    seed_id: plot?.seed_id ?? null,
    remaining: Math.max(0, Number(plot?.remaining ?? 0)),
    harvest_ready_at: Number(plot?.harvest_ready_at ?? 0)
  }));
  return garden.plots;
}

export function getGardenPlotCount(player, effects = {}) {
  const bonus = Math.floor(effects.garden_plot_bonus || 0);
  return BASE_GARDEN_PLOTS + bonus;
}

export function getCompostCap(player, effects = {}) {
  void player; // compost cap is now flat
  void effects;
  return BASE_COMPOST_CAP;
}

export function addSeeds(player, seedDrops) {
  const garden = ensureGardenState(player);
  for (const [itemId, qty] of Object.entries(seedDrops || {})) {
    if (!qty || qty <= 0) continue;
    garden.seeds[itemId] = (garden.seeds[itemId] || 0) + qty;
  }
  return garden.seeds;
}

export function stashSpoiledIngredient(player, itemId, qty) {
  if (!qty || qty <= 0) return 0;
  const garden = ensureGardenState(player);
  garden.spoiled[itemId] = (garden.spoiled[itemId] || 0) + qty;
  return garden.spoiled[itemId];
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

export function plantSeedInPlot(player, seedId, effects = {}, now = Date.now()) {
  const garden = ensureGardenState(player);
  const plots = ensureGardenPlots(player, effects);
  if (!seedId) return { ok: false, reason: "no_seed" };
  const seedsAvailable = garden.seeds?.[seedId] || 0;
  if (seedsAvailable <= 0) return { ok: false, reason: "no_seeds" };
  if ((garden.compost_bags || 0) <= 0) return { ok: false, reason: "no_compost" };

  const emptyIndex = plots.findIndex((plot) => !plot.seed_id && (plot.remaining ?? 0) <= 0);
  if (emptyIndex === -1) return { ok: false, reason: "no_empty_plot" };

  const baseCooldown = PLOT_BASE_COOLDOWN_MS;
  const harvestReduction = (effects.cooldown_reduction || 0) + (effects.harvest_cooldown_reduction || 0);
  const cappedReduction = Math.min(0.8, Math.max(0, harvestReduction));
  const readyIn = Math.max(30 * 1000, Math.floor(baseCooldown * (1 - cappedReduction)));

  garden.seeds[seedId] = seedsAvailable - 1;
  if (garden.seeds[seedId] <= 0) delete garden.seeds[seedId];
  garden.compost_bags -= 1;

  plots[emptyIndex] = {
    seed_id: seedId,
    remaining: PLOT_YIELD,
    harvest_ready_at: now + readyIn
  };

  return {
    ok: true,
    plotIndex: emptyIndex,
    seedId,
    remaining: PLOT_YIELD,
    compostAfter: garden.compost_bags,
    harvestReadyAt: now + readyIn
  };
}

export function harvestGardenPlots(player, content, effects = {}, { plotIndex = null, now = Date.now(), onlyReady = false } = {}) {
  const plots = ensureGardenPlots(player, effects);
  const targets = plotIndex === null ? plots.map((_, idx) => idx) : [plotIndex];
  const results = [];
  const totalAdded = {};
  const seedBonus = {};
  let anyHarvestable = false;

  for (const idx of targets) {
    const plot = plots[idx];
    if (!plot || !plot.seed_id || (plot.remaining ?? 0) <= 0) continue;
    if (onlyReady && plot.harvest_ready_at && plot.harvest_ready_at > now) continue;
    anyHarvestable = true;
    const seedId = plot.seed_id;
    const qty = Math.max(0, Math.floor(plot.remaining ?? 0));
    if (qty <= 0) continue;

    if (plot.harvest_ready_at && plot.harvest_ready_at > now) {
      results.push({
        plotIndex: idx,
        seedId,
        added: 0,
        leftover: qty,
        blocked: true,
        notReady: true,
        readyAt: plot.harvest_ready_at
      });
      continue;
    }

    const invResult = addIngredientsToInventory(player, { [seedId]: qty }, "truncate");
    const added = invResult.added[seedId] || 0;
    const leftover = Math.max(0, qty - added);

    plot.remaining = leftover;
    if (plot.remaining <= 0) plots[idx] = { seed_id: null, remaining: 0, harvest_ready_at: 0 };

    if (added > 0) {
      totalAdded[seedId] = (totalAdded[seedId] || 0) + added;
    }

    const harvestSeedChance = Math.min(0.5, effects.garden_harvest_seed_chance || 0);
    if (harvestSeedChance > 0 && Math.random() < harvestSeedChance) {
      seedBonus[seedId] = (seedBonus[seedId] || 0) + 1;
    }

    results.push({
      plotIndex: idx,
      seedId,
      added,
      leftover,
      blocked: leftover > 0,
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

export function autoHarvestReadyPlots(player, content, effects = {}, now = Date.now()) {
  const result = harvestGardenPlots(player, content, effects, { now, onlyReady: true });
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
    .sort(([a], [b]) => getItemName(a, content).localeCompare(getItemName(b, content)))
    .map(([itemId, qty]) => `• ${getItemName(itemId, content)}: **${qty} seeds**`)
    .join("\n");
}

export function formatSpoiledLines(spoiled = {}, content) {
  const entries = Object.entries(spoiled).filter(([, qty]) => qty > 0);
  if (!entries.length) return "_No spoiled ingredients saved._";
  return entries
    .sort(([a], [b]) => getItemName(a, content).localeCompare(getItemName(b, content)))
    .map(([itemId, qty]) => `• ${getItemName(itemId, content)}: **${qty}**`)
    .join("\n");
}

export function formatPlotLines(player, content, effects = {}, now = Date.now()) {
  const plots = ensureGardenPlots(player, effects);
  if (!plots.length) return "_No plots available yet._";
  return plots
    .map((plot, idx) => {
      const label = `Plot ${idx + 1}`;
      if (!plot?.seed_id || (plot.remaining ?? 0) <= 0) {
        return `${label}: Empty (needs 1 seed + 1 compost bag)`;
      }
      const readyText = !plot.harvest_ready_at || plot.harvest_ready_at <= now
        ? "ready"
        : `ready ${formatTimestamp(plot.harvest_ready_at)}`;
      return `${label}: ${getItemName(plot.seed_id, content)} — **${plot.remaining}/${PLOT_YIELD}** left (${readyText})`;
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
