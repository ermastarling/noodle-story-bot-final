import { nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";
import { ensureBadgeState } from "./badges.js";

export const DECOR_SLOTS = ["front", "counter", "wall", "sign", "frame"];
export const ALLOW_EQUIP_EVENT_ITEMS_AFTER_EVENT = true;
export const DECOR_SET_COMPLETION_MODE = "owned";

export function getDecorRegistry(decorContent) {
  const items = decorContent?.items ?? [];
  return new Map(items.map((item) => [item.item_id, item]));
}

export function getDecorSetsRegistry(setsContent) {
  const sets = setsContent?.sets ?? [];
  return new Map(sets.map((set) => [set.set_id, set]));
}

export function ensureDecorState(player) {
  if (!player.cosmetics_owned) player.cosmetics_owned = {};
  if (!player.profile) player.profile = {};
  if (!player.profile.decor_slots) {
    player.profile.decor_slots = { front: null, counter: null, wall: null, sign: null, frame: null };
  }
  if (!player.profile.decor_sets_completed) player.profile.decor_sets_completed = [];
  return player.profile.decor_slots;
}

export function getOwnedDecorItems(player) {
  ensureDecorState(player);
  return Object.entries(player.cosmetics_owned || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([itemId]) => itemId);
}

function hasCollectionEntry(player, collectionId, entry) {
  const progress = player.collections?.progress?.[collectionId];
  if (!progress) return false;
  if (!entry) return (player.collections?.completed ?? []).includes(collectionId);
  return (progress.completed_entries ?? []).includes(String(entry));
}

export function isDecorUnlocked(player, item, serverState = null) {
  if (!item) return false;
  const rule = item.unlock_rule ?? {};
  switch (item.unlock_source) {
    case "shop_level":
      return (player.shop_level || 1) >= Number(rule.level || 0);
    case "rep":
      return (player.rep || 0) >= Number(rule.rep || 0);
    case "collection":
      return hasCollectionEntry(player, rule.collection_id, rule.entry);
    case "event":
      return !!serverState?.active_event_id && (!rule.event_id || serverState.active_event_id === rule.event_id);
    case "quest":
      return false;
    case "market_cosmetic":
      return false;
    default:
      return false;
  }
}

export function grantUnlockedDecor(player, decorContent, serverState = null) {
  ensureDecorState(player);
  const registry = getDecorRegistry(decorContent);
  let granted = 0;

  for (const item of registry.values()) {
    if (!item?.item_id) continue;
    if (!isDecorUnlocked(player, item, serverState)) continue;
    const owned = Number(player.cosmetics_owned[item.item_id] || 0);
    if (owned > 0) continue;
    player.cosmetics_owned[item.item_id] = 1;
    granted += 1;
  }

  return granted;
}

export function canEquipDecor(player, decorContent, slot, itemId, serverState = null) {
  ensureDecorState(player);
  const registry = getDecorRegistry(decorContent);
  if (!DECOR_SLOTS.includes(slot)) return { ok: false, reason: "Invalid decor slot." };
  if (!itemId) return { ok: true };
  const item = registry.get(itemId);
  if (!item) return { ok: false, reason: "Decor item not found." };
  if (item.slot !== slot) return { ok: false, reason: `Item belongs to slot ${item.slot}.` };

  const owned = Number(player.cosmetics_owned?.[itemId] || 0);
  if (owned <= 0) return { ok: false, reason: "You do not own that decor item." };

  if (item.unlock_source === "event" && !serverState?.active_event_id && !ALLOW_EQUIP_EVENT_ITEMS_AFTER_EVENT) {
    return { ok: false, reason: "Event decor can only be equipped during the event." };
  }

  return { ok: true, item };
}

export function equipDecor(player, decorContent, slot, itemId, serverState = null) {
  const check = canEquipDecor(player, decorContent, slot, itemId, serverState);
  if (!check.ok) return check;

  ensureDecorState(player);
  player.profile.decor_slots[slot] = itemId || null;
  return { ok: true, item: check.item || null };
}

function applyRewards(player, rewards) {
  if (!rewards) return 0;
  const rewardList = Array.isArray(rewards) ? rewards : [rewards];
  let leveledUp = 0;

  for (const reward of rewardList) {
    if (!reward) continue;
    if (reward.coins) player.coins = (player.coins || 0) + reward.coins;
    if (reward.rep) player.rep = (player.rep || 0) + reward.rep;
    if (reward.sxp) {
      player.sxp_total = (player.sxp_total || 0) + reward.sxp;
      player.sxp_progress = (player.sxp_progress || 0) + reward.sxp;
      leveledUp += applySxpLevelUp(player);
    }
  }

  if (!player.lifetime) player.lifetime = {};
  if (rewards?.coins) {
    player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + rewards.coins;
  }

  return leveledUp;
}

export function evaluateDecorSets(player, decorContent, decorSetsContent) {
  ensureDecorState(player);
  const registry = getDecorRegistry(decorContent);
  const sets = decorSetsContent?.sets ?? [];
  const owned = new Set(getOwnedDecorItems(player));
  const equipped = player.profile.decor_slots || {};
  const newlyCompleted = [];

  for (const set of sets) {
    if (!set?.set_id) continue;
    if (player.profile.decor_sets_completed.includes(set.set_id)) continue;

    const pieces = set.pieces ?? [];
    const completed = pieces.every((piece) => {
      if (DECOR_SET_COMPLETION_MODE === "equipped") {
        return equipped?.[piece.slot] === piece.item_id;
      }
      return owned.has(piece.item_id);
    });

    if (!completed) continue;

    player.profile.decor_sets_completed.push(set.set_id);
    ensureBadgeState(player);

    if (!player.collections) player.collections = { completed: [], progress: {} };
    if (!player.collections.completed.includes(set.set_id)) {
      player.collections.completed.push(set.set_id);
    }

    if (set.completion_badge_id && !player.profile.badges.includes(set.completion_badge_id)) {
      player.profile.badges.push(set.completion_badge_id);
    }

    applyRewards(player, set.completion_rewards);
    newlyCompleted.push(set.set_id);
  }

  return newlyCompleted;
}

export function getDecorItemById(decorContent, itemId) {
  const registry = getDecorRegistry(decorContent);
  return registry.get(itemId) || null;
}

export function getDecorItemsBySlot(decorContent, slot) {
  const registry = getDecorRegistry(decorContent);
  return [...registry.values()].filter((item) => item.slot === slot);
}

export function formatDecorSlotLabel(slot) {
  const map = { front: "Front", counter: "Counter", wall: "Wall", sign: "Sign", frame: "Frame" };
  return map[slot] || slot;
}

export function formatDecorItemLine(item) {
  if (!item) return "";
  return `${item.name} (${item.rarity})`;
}

export function buildDecorOwnershipSummary(player, decorContent, serverState = null) {
  grantUnlockedDecor(player, decorContent, serverState);
  const owned = new Set(getOwnedDecorItems(player));
  const registry = getDecorRegistry(decorContent);
  const lines = [];

  for (const slot of DECOR_SLOTS) {
    const items = [...registry.values()].filter((item) => item.slot === slot && owned.has(item.item_id));
    if (!items.length) continue;
    lines.push(`**${formatDecorSlotLabel(slot)}**: ${items.map((i) => i.name).join(", ")}`);
  }

  return lines.length ? lines.join("\n") : "_No decor owned yet._";
}
