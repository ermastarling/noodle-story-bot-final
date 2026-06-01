// src/game/forage.js
import { makeStreamRng } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";
import { addIngredientsToInventory } from "./inventory.js";

// ✅ Forage-only pool
// If the user chooses a specific item, we validate against this table.
// Seasonal-only items get a reduced effective weight so they drop less often.
const SEASONAL_FORAGE_WEIGHT_MULTIPLIER = 0.4;

const FORAGE_TABLE = [
  // Toppings/Vegetables
  { item_id: "scallions",        weight: 60, min: 1, max: 3 },
  { item_id: "carrots",           weight: 55, min: 1, max: 3 },
  { item_id: "root_vegetables",  weight: 50, min: 1, max: 2 },
  { item_id: "citrus_peels",      weight: 40, min: 1, max: 2 },
  { item_id: "citrus_slices",    weight: 35, min: 1, max: 2 },
  { item_id: "wild_greens",      weight: 50, min: 1, max: 2 },
  { item_id: "forest_mushrooms", weight: 45, min: 1, max: 2 },
  { item_id: "night_herbs",      weight: 20, min: 1, max: 1 },
  { item_id: "ember_peppers",     weight: 30, min: 1, max: 1 },
  { item_id: "dew_greens",       weight: 30, min: 1, max: 2 },
  { item_id: "petal_garnish",    weight: 20, min: 1, max: 1, seasonalOnly: true },

  // Spices/Aromatics
  { item_id: "black_garlic",     weight: 20,  min: 1, max: 1 },
  { item_id: "star_anise",       weight: 20, min: 1, max: 1, seasonalOnly: true },
  { item_id: "night_spices",     weight: 20,  min: 1, max: 1, seasonalOnly: true }
];

export const FORAGE_ITEM_IDS = FORAGE_TABLE.map(e => e.item_id);
export const RARE_FORAGE_ITEM_IDS = FORAGE_TABLE
  .filter((e) => e.weight <= 20)
  .map((e) => e.item_id);

export function getForageEntry(itemId) {
  return FORAGE_TABLE.find((entry) => entry.item_id === itemId) ?? null;
}

export function getForageMaxForItem(itemId) {
  const entry = getForageEntry(itemId);
  return entry?.max ?? 1;
}

function rngInt(rng, min, max) {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedPick(rng, table) {
  const total = table.reduce((sum, e) => sum + getEffectiveWeight(e), 0);
  let roll = rngInt(rng, 1, total);
  for (const entry of table) {
    roll -= getEffectiveWeight(entry);
    if (roll <= 0) return entry;
  }
  return table[table.length - 1];
}

function getEffectiveWeight(entry) {
  const base = entry.weight ?? 1;
  const multiplier = entry.seasonalOnly ? SEASONAL_FORAGE_WEIGHT_MULTIPLIER : 1;
  return Math.max(1, Math.round(base * multiplier));
}

export function canForage(player, nowMs, cooldownMs = 5 * 60 * 1000) {
  const last = player.cooldowns?.forage_last_ms ?? 0;
  const nextAt = last + cooldownMs;
  return { ok: nowMs >= nextAt, nextAt };
}

/**
 * rollForageDrops
 * - If itemId is provided, returns that item in the requested quantity (clamped to 1..5).
 * - Otherwise, returns random drops using "picks" (legacy behavior).
 *
 * If allowedItemIds is provided, forage is restricted to ONLY those item ids.
 */
export function rollForageDrops({
  serverId,
  userId,
  picks = 2,
  itemId = null,
  quantity = 1,
  allowedItemIds = null
}) {
  const dayKey = dayKeyUTC();

  // Per-user seeded stream so it’s stable and fair-ish for random rolls.
  const rng = makeStreamRng({
    mode: "seeded",
    seed: 12345,
    streamName: "forage",
    serverId,
    dayKey,
    userId
  });

  // Normalize allowed set (null = no gating)
  const allowedSet =
    Array.isArray(allowedItemIds) && allowedItemIds.length
      ? new Set(allowedItemIds)
      : null;

  const table = allowedSet
    ? FORAGE_TABLE.filter(e => allowedSet.has(e.item_id))
    : FORAGE_TABLE;

  if (!table.length) {
    throw new Error("No forage items available for this player.");
  }

  // Player-chosen forage: exact item + qty (up to 5)
  if (itemId) {
    const entry = table.find(e => e.item_id === itemId);
    if (!entry) {
      throw new Error(`Invalid or locked forage item: ${itemId}`);
    }
    const q = Math.max(1, Math.min(5, Number(quantity) || 1));
    return { [itemId]: q };
  }

  // Random forage (legacy): "picks" weighted rolls with per-entry min/max
  const drops = {};
  for (let i = 0; i < picks; i++) {
    const entry = weightedPick(rng, table);
    const qty = rngInt(rng, entry.min, entry.max);
    drops[entry.item_id] = (drops[entry.item_id] ?? 0) + qty;
  }
  return drops;
}

export function applyDropsToInventory(player, drops) {
  // Use the new inventory system with capacity checks
  const result = addIngredientsToInventory(player, drops, "block");
  return result;
}

export function applyForagePityCounter(player, drops, {
  allowedRare = [],
  itemId = null,
  serverId = "",
  userId = "",
  dayKey = dayKeyUTC()
} = {}) {
  if (itemId || !Array.isArray(allowedRare) || allowedRare.length === 0) {
    return false;
  }

  if (!drops || typeof drops !== "object") {
    return false;
  }

  const hasRareDrop = Object.keys(drops).some((id) => allowedRare.includes(id));
  if (hasRareDrop) {
    player.forage_pity_rare_count = 0;
    return false;
  }

  player.forage_pity_rare_count = (player.forage_pity_rare_count || 0) + 1;
  if (player.forage_pity_rare_count < 10) {
    return false;
  }

  const pityRng = makeStreamRng({
    mode: "seeded",
    seed: 98765,
    streamName: "forage_pity",
    serverId,
    dayKey,
    userId
  });
  const pickIdx = Math.floor(pityRng() * allowedRare.length);
  const pityItem = allowedRare[Math.max(0, Math.min(allowedRare.length - 1, pickIdx))];
  drops[pityItem] = (drops[pityItem] ?? 0) + 1;
  player.forage_pity_rare_count = 0;
  return true;
}

export function setForageCooldown(player, nowMs) {
  if (!player.cooldowns) player.cooldowns = {};
  player.cooldowns.forage_last_ms = nowMs;
}
