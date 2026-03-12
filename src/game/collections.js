import { nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";
import { loadEventsContent } from "../content/index.js";

const eventsContentCache = loadEventsContent();

function getEventRecipeIds() {
  const events = eventsContentCache?.events ?? [];
  return events
    .flatMap((evt) => evt?.event_recipes ?? [])
    .map((r) => r?.recipe_id)
    .filter(Boolean);
}

function getEventRecipeIdsByTier(tier) {
  const events = eventsContentCache?.events ?? [];
  return events
    .flatMap((evt) => evt?.event_recipes ?? [])
    .filter((r) => r?.recipe_id && (!tier || r?.tier === tier))
    .map((r) => r.recipe_id);
}

export function ensureCollectionsState(player) {
  if (!player.collections) player.collections = { completed: [], progress: {} };
  if (!Array.isArray(player.collections.completed)) player.collections.completed = [];
  if (!player.collections.progress) player.collections.progress = {};
  return player.collections;
}

export function ensureCollectionProgress(collections, collectionId) {
  if (!collections.progress[collectionId]) {
    collections.progress[collectionId] = { completed_entries: [], counters: {}, completed_at: null };
  }
  if (!Array.isArray(collections.progress[collectionId].completed_entries)) {
    collections.progress[collectionId].completed_entries = [];
  }
  if (!collections.progress[collectionId].counters) {
    collections.progress[collectionId].counters = {};
  }
  return collections.progress[collectionId];
}

export function resolveCollectionEntries(collection, contentBundle) {
  if (Array.isArray(collection.entries) && collection.entries.length > 0) return collection.entries;
  if (collection.entry_source === "npcs") {
    return Object.keys(contentBundle?.npcs ?? {}).filter(Boolean);
  }
  if (collection.entry_source === "recipes") {
    const tier = collection.tier;

    // Seasonal scrapbook: include every seasonal-tagged or event-only recipe across all seasons.
    if (collection.collection_id === "recipe_codex_seasonal") {
      const seasonalAndEventIds = Object.values(contentBundle?.recipes ?? {})
        .filter((r) => r?.recipe_id)
        .filter((r) => r.tier === "seasonal" || r.event_id || r.is_event_recipe || r.season)
        .map((r) => r.recipe_id);
      const eventIds = getEventRecipeIds();
      return Array.from(new Set([...seasonalAndEventIds, ...eventIds]));
    }

    const allRecipes = Object.values(contentBundle?.recipes ?? {}).filter((r) => r?.recipe_id);
    const baseIds = allRecipes
      .filter((r) => !tier || r?.tier === tier)
      .map((r) => r.recipe_id);

    // Ensure tiered collections also count all event recipes of that tier (across all seasons).
    const eventTierIds = allRecipes
      .filter((r) => r.event_id || r.is_event_recipe)
      .filter((r) => !tier || r?.tier === tier)
      .map((r) => r.recipe_id);

    // Add any event recipes from events content in case the content bundle omitted them.
    const eventTierIdsFromEvents = getEventRecipeIdsByTier(tier);

    return Array.from(new Set([...baseIds, ...eventTierIds, ...eventTierIdsFromEvents]));
  }
  return [];
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

function markCollectionComplete(collections, collection, progress, player) {
  if (collections.completed.includes(collection.collection_id)) return;
  collections.completed.push(collection.collection_id);
  progress.completed_at = nowTs();
  applyRewards(player, collection.rewards);
}

function tryCompleteCollection(collections, collection, progress, totalEntries, player) {
  if (totalEntries <= 0) return;
  const completedCount = progress.completed_entries.length;
  if (completedCount >= totalEntries) {
    markCollectionComplete(collections, collection, progress, player);
  }
}

export function applyCollectionProgressOnServe(player, collectionsContent, contentBundle, event) {
  const collections = ensureCollectionsState(player);
  const collectionsList = collectionsContent?.collections ?? [];

  for (const collection of collectionsList) {
    const progress = ensureCollectionProgress(collections, collection.collection_id);
    const entries = resolveCollectionEntries(collection, contentBundle);

    if (collection.type === "npc" && event?.npcArchetype) {
      if (entries.includes(event.npcArchetype) && !progress.completed_entries.includes(event.npcArchetype)) {
        progress.completed_entries.push(event.npcArchetype);
      }
      tryCompleteCollection(collections, collection, progress, entries.length, player);
    }

    if (collection.type === "recipe" && event?.recipeId) {
      if (entries.includes(event.recipeId) && !progress.completed_entries.includes(event.recipeId)) {
        progress.completed_entries.push(event.recipeId);
      }
      tryCompleteCollection(collections, collection, progress, entries.length, player);
    }

    if (collection.type === "milestone" && collection.counter_key) {
      const total = Number(player?.lifetime?.[collection.counter_key] || 0);
      progress.counters[collection.counter_key] = total;
      for (const entry of entries) {
        const threshold = Number(entry);
        if (Number.isFinite(threshold) && total >= threshold && !progress.completed_entries.includes(entry)) {
          progress.completed_entries.push(entry);
        }
      }
      tryCompleteCollection(collections, collection, progress, entries.length, player);
    }
  }
}

export function applyCollectionProgressOnCook(player, collectionsContent, contentBundle, event) {
  const collections = ensureCollectionsState(player);
  const collectionsList = collectionsContent?.collections ?? [];

  for (const collection of collectionsList) {
    const progress = ensureCollectionProgress(collections, collection.collection_id);
    const entries = resolveCollectionEntries(collection, contentBundle);

    if (collection.type === "recipe" && event?.recipeId) {
      if (entries.includes(event.recipeId) && !progress.completed_entries.includes(event.recipeId)) {
        progress.completed_entries.push(event.recipeId);
      }
      tryCompleteCollection(collections, collection, progress, entries.length, player);
    }

    if (collection.type === "milestone" && collection.counter_key && event?.bowlsCooked) {
      const prev = Number(progress.counters[collection.counter_key] || 0);
      const next = prev + Number(event.bowlsCooked || 0);
      progress.counters[collection.counter_key] = next;
      for (const entry of entries) {
        const threshold = Number(entry);
        if (Number.isFinite(threshold) && next >= threshold && !progress.completed_entries.includes(entry)) {
          progress.completed_entries.push(entry);
        }
      }
      tryCompleteCollection(collections, collection, progress, entries.length, player);
    }
  }
}

export function getCollectionsSummary(player, collectionsContent, contentBundle, limit = 3) {
  const collections = ensureCollectionsState(player);
  const collectionsList = collectionsContent?.collections ?? [];
  const summary = {
    completed: collections.completed.length,
    total: collectionsList.length,
    top_progress: []
  };

  const progressList = collectionsList.map((collection) => {
    const progress = ensureCollectionProgress(collections, collection.collection_id);
    const entries = resolveCollectionEntries(collection, contentBundle);
    const totalEntries = entries.length;
    const completedEntries = progress.completed_entries.length;
    const percent = totalEntries > 0 ? Math.floor((completedEntries / totalEntries) * 100) : 0;
    return {
      collection_id: collection.collection_id,
      name: collection.name,
      completed: completedEntries,
      total: totalEntries,
      percent
    };
  });

  summary.top_progress = progressList
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit)
    .map(({ collection_id, name, percent }) => ({ collection_id, name, percent }));

  return summary;
}

// One-time migration: mark recipe collections with any recipes the player already knows/has cooked, including event recipes.
export function backfillRecipeCollections(player, collectionsContent, contentBundle) {
  if (!player) return;
  const collections = ensureCollectionsState(player);
  if (collections.backfill_event_recipe_progress_done) return;

  const ownedRecipeIds = new Set();
  (player.known_recipes || []).forEach((id) => id && ownedRecipeIds.add(id));

  // Capture any recipe ids from bowl inventory snapshots too.
  Object.entries(player.inv_bowls || {}).forEach(([key, bowl]) => {
    if (key) ownedRecipeIds.add(key);
    const recipeId = bowl?.recipe_id;
    if (recipeId) ownedRecipeIds.add(recipeId);
  });

  const collectionsList = collectionsContent?.collections ?? [];
  for (const collection of collectionsList) {
    if (collection.type !== "recipe") continue;
    const entries = resolveCollectionEntries(collection, contentBundle);
    const progress = ensureCollectionProgress(collections, collection.collection_id);

    // Ensure all owned recipes are marked complete for this collection.
    for (const recipeId of entries) {
      if (ownedRecipeIds.has(recipeId) && !progress.completed_entries.includes(recipeId)) {
        progress.completed_entries.push(recipeId);
      }
    }

    const total = entries.length;
    if (total > 0 && progress.completed_entries.length >= total) {
      if (!collections.completed.includes(collection.collection_id)) {
        collections.completed.push(collection.collection_id);
      }
      if (!progress.completed_at) progress.completed_at = nowTs();
    }
  }

  collections.backfill_event_recipe_progress_done = true;
}
