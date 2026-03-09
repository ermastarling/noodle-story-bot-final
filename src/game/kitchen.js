import { nowTs } from "../util/time.js";
import { FORAGE_ITEM_IDS } from "./forage.js";

export const KITCHEN_UNLOCK_LEVEL = 45;
export const KITCHEN_SIMMER_MS = 15 * 60 * 1000;
export const KITCHEN_FORAGE_PER_BROTH = 5;
export const KITCHEN_BASE_SLOTS = 10;

export function isKitchenUnlocked(player) {
  return (player?.shop_level ?? 1) >= KITCHEN_UNLOCK_LEVEL;
}

export function ensureKitchenState(player) {
  if (!player.kitchen) {
    player.kitchen = { active_batches: [] };
  }

  // Migrate legacy single-batch state
  if (player.kitchen.active_batch && !player.kitchen.active_batches) {
    player.kitchen.active_batches = [player.kitchen.active_batch];
    delete player.kitchen.active_batch;
  }

  if (!Array.isArray(player.kitchen.active_batches)) {
    player.kitchen.active_batches = [];
  }

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

export function getKitchenForagePool(player) {
  const pool = {};
  for (const id of FORAGE_ITEM_IDS) {
    const qty = Math.max(0, Number(player?.inv_ingredients?.[id] ?? 0));
    if (qty > 0) pool[id] = qty;
  }
  return pool;
}

export function planKitchenIngredients(player, needed = KITCHEN_FORAGE_PER_BROTH) {
  const pool = getKitchenForagePool(player);
  const entries = Object.entries(pool)
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]));
    });

  const used = {};
  let remaining = needed;
  for (const [id, qty] of entries) {
    if (remaining <= 0) break;
    const take = Math.min(qty, remaining);
    if (take <= 0) continue;
    used[id] = take;
    remaining -= take;
  }

  return { used, remaining, ok: remaining <= 0 };
}
