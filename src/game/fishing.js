import { makeStreamRng } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";
import { addIngredientsToInventory } from "./inventory.js";

export const FISHING_UNLOCK_LEVEL = 65;
export const FISHING_BASE_COOLDOWN_MS = 4 * 60 * 1000;
export const FISHING_RECIPE_IDS = [
  "catfish_shore_ramen",
  "salmon_ocean_udon",
  "grouper_miso_bowl",
  "tuna_eel_deluxe",
  "harbor_crab_ramen"
];

const FISHING_TABLE = [
  // Common
  { item_id: "tilapia", weight: 55, min: 1, max: 2 },
  { item_id: "catfish", weight: 55, min: 1, max: 2 },
  { item_id: "basa", weight: 50, min: 1, max: 2 },
  { item_id: "shrimp", weight: 50, min: 1, max: 2 },
  { item_id: "clams", weight: 45, min: 1, max: 2 },
  // Uncommon
  { item_id: "seabass", weight: 35, min: 1, max: 2 },
  { item_id: "flounder", weight: 35, min: 1, max: 2 },
  { item_id: "mackerel", weight: 32, min: 1, max: 2 },
  { item_id: "squid", weight: 30, min: 1, max: 2 },
  { item_id: "oysters", weight: 30, min: 1, max: 1 },
  // Rare
  { item_id: "grouper", weight: 18, min: 1, max: 1 },
  { item_id: "salmon", weight: 18, min: 1, max: 1 },
  { item_id: "tuna", weight: 15, min: 1, max: 1 },
  { item_id: "crab", weight: 15, min: 1, max: 1 },
  { item_id: "eel", weight: 12, min: 1, max: 1 }
];

export const FISHING_ITEM_IDS = FISHING_TABLE.map((e) => e.item_id);
export const RARE_FISHING_ITEM_IDS = FISHING_TABLE.filter((e) => e.weight <= 20).map((e) => e.item_id);

export function isFishingUnlocked(player) {
  return (player?.shop_level ?? 0) >= FISHING_UNLOCK_LEVEL;
}

export function ensureFishingState(player) {
  if (!player.fishing) {
    player.fishing = { unlock_seen_level: player?.shop_level ?? 1 };
  }
  const seenLevelRaw = Number(player.fishing.unlock_seen_level ?? player?.shop_level ?? 1);
  player.fishing.unlock_seen_level = Number.isFinite(seenLevelRaw) ? seenLevelRaw : (player?.shop_level ?? 1);
  return player.fishing;
}

export function getFishingUnlockState(player) {
  const level = Number(player?.shop_level ?? 1);
  const unlocked = isFishingUnlocked(player);
  const state = ensureFishingState(player);
  const seenLevel = Number.isFinite(state.unlock_seen_level) ? state.unlock_seen_level : level;
  const justUnlocked = unlocked && seenLevel < FISHING_UNLOCK_LEVEL;
  state.unlock_seen_level = Math.max(seenLevel, level);
  if (justUnlocked) {
    const known = new Set(player.known_recipes || []);
    for (const recipeId of FISHING_RECIPE_IDS) {
      known.add(recipeId);
    }
    player.known_recipes = [...known];
  }
  return { unlocked, justUnlocked, seenLevel: state.unlock_seen_level };
}

function rngInt(rng, min, max) {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function getEffectiveWeight(entry) {
  const base = entry.weight ?? 1;
  return Math.max(1, Math.round(base));
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

export function canFish(player, nowMs, cooldownMs = FISHING_BASE_COOLDOWN_MS) {
  const last = player.cooldowns?.fishing_last_ms ?? 0;
  const nextAt = last + cooldownMs;
  return { ok: nowMs >= nextAt, nextAt };
}

export function setFishingCooldown(player, nowMs) {
  if (!player.cooldowns) player.cooldowns = {};
  player.cooldowns.fishing_last_ms = nowMs;
}

export function rollFishingDrops({ serverId, userId, picks = 2, itemId = null, quantity = 1, allowedItemIds = null }) {
  const dayKey = dayKeyUTC();
  const rng = makeStreamRng({
    mode: "seeded",
    seed: 24680,
    streamName: "fishing",
    serverId,
    dayKey,
    userId
  });

  const allowedSet = Array.isArray(allowedItemIds) && allowedItemIds.length ? new Set(allowedItemIds) : null;
  const table = allowedSet ? FISHING_TABLE.filter((e) => allowedSet.has(e.item_id)) : FISHING_TABLE;

  if (!table.length) {
    throw new Error("No fishing items available for this player.");
  }

  if (itemId) {
    const entry = table.find((e) => e.item_id === itemId);
    if (!entry) {
      throw new Error(`Invalid or locked fishing item: ${itemId}`);
    }
    const q = Math.max(1, Math.min(5, Number(quantity) || 1));
    return { [itemId]: q };
  }

  const drops = {};
  for (let i = 0; i < picks; i++) {
    const entry = weightedPick(rng, table);
    const qty = rngInt(rng, entry.min ?? 1, entry.max ?? 1);
    drops[entry.item_id] = (drops[entry.item_id] ?? 0) + qty;
  }
  return drops;
}

export function applyFishingDrops(player, drops) {
  return addIngredientsToInventory(player, drops, "block");
}
