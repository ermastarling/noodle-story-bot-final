/**
 * timeCatchup.js
 * Phase C: Time & Inactivity Catch-Up
 * 
 * Manages spoilage evaluation, cooldown catch-up, and inactivity tracking
 * when players return after being offline.
 */

import { nowTs, dayKeyUTC } from "../util/time.js";
import { makeStreamRng } from "../util/rng.js";

// Inactivity thresholds (in milliseconds)
const INACTIVE_7D_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVE_30D_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Simple deterministic random for spoilage
 */
function deterministicRandom(seed) {
  const rng = makeStreamRng({
    mode: "seeded",
    seed,
    streamName: "spoilage"
  });
  return rng();
}

/**
 * C1: Spoilage While Offline
 * 
 * Calculate and apply spoilage for missed ticks since last_active_at.
 * Evaluates on tick boundaries, not continuously.
 * 
 * @param {Object} player - Player profile
 * @param {Object} settings - Server settings
 * @param {Object} content - Content bundle
 * @param {number} lastActiveAt - Last active timestamp
 * @param {number} now - Current timestamp
 * @returns {Object} - Spoilage results with messages
 */
export function applySpoilageCatchup(player, settings, content, lastActiveAt, now, effects = null) {
  // If spoilage is disabled, skip
  if (!settings.SPOILAGE_ENABLED) {
    return { applied: false, spoiled: {}, messages: [] };
  }

  // If SPOILAGE_APPLY_ON_LOGIN is false, skip catch-up
  if (!settings.SPOILAGE_APPLY_ON_LOGIN) {
    return { applied: false, spoiled: {}, messages: [] };
  }

  const tickHours = settings.SPOILAGE_TICK_HOURS ?? 1;
  const maxCatchupTicks = settings.SPOILAGE_MAX_CATCHUP_TICKS ?? 24;
  const baseChance = settings.SPOILAGE_BASE_CHANCE ?? 0.05;
  const reduction = Math.max(0, Math.min(0.95, effects?.spoilage_reduction || 0));
  const adjustedBaseChance = baseChance * (1 - reduction);

  // Calculate elapsed time and number of ticks
  const elapsedMs = now - lastActiveAt;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const totalTicks = Math.floor(elapsedHours / tickHours);

  // Cap at max catchup ticks
  const ticksToApply = Math.min(totalTicks, maxCatchupTicks);

  if (ticksToApply <= 0) {
    return { applied: false, spoiled: {}, ticksApplied: 0, messages: [] };
  }

  // Get player upgrades for protected storage
  const upgrades = player.upgrades || {};
  const coldCellarLevel = upgrades.u_cold_cellar || 0;
  const secureCratesLevel = upgrades.u_secure_crates || 0;

  // Track spoiled items
  const spoiled = {};
  const inventory = player.inv_ingredients || {};

  // Process each tick
  for (let tick = 0; tick < ticksToApply; tick++) {
    // Get current spoilable items (snapshot per tick)
    const spoilableItems = Object.entries(inventory).filter(([itemId, qty]) => {
      if (qty <= 0) return false;
      const item = content.items?.[itemId];
      return item?.spoilable === true;
    });

    // Evaluate spoilage for each item
    for (const [itemId, qty] of spoilableItems) {
      const item = content.items?.[itemId];
      if (!item) continue;

      // Check if item is protected by upgrades
      const isProtected = isItemProtected(item, coldCellarLevel, secureCratesLevel);

      // Protected items still evaluated per tick, but with reduced chance
      const spoilChance = isProtected ? adjustedBaseChance * 0.5 : adjustedBaseChance;

      // Deterministic random based on player, item, and tick
      const seed = `spoilage:${player.user_id}:${itemId}:${lastActiveAt}:${tick}`;
      const roll = deterministicRandom(seed);

      if (roll < spoilChance) {
        // Spoil one unit
        const amountToSpoil = 1;
        inventory[itemId] = Math.max(0, (inventory[itemId] || 0) - amountToSpoil);
        spoiled[itemId] = (spoiled[itemId] || 0) + amountToSpoil;
      }
    }
  }

  // Build message
  const messages = [];
  const spoiledCount = Object.values(spoiled).reduce((sum, v) => sum + v, 0);
  
  if (spoiledCount > 0) {
    const itemsList = Object.entries(spoiled)
      .map(([id, qty]) => {
        const name = content.items?.[id]?.name || id;
        return `**${qty}× ${name}**`;
      })
      .join(", ");

    messages.push(
      `🕐 *While you were away, some ingredients spoiled:* ${itemsList}\n` +
      `_(${ticksToApply} ${ticksToApply === 1 ? 'tick' : 'ticks'} evaluated)_`
    );
  }

  return {
    applied: spoiledCount > 0,
    spoiled,
    ticksApplied: ticksToApply,
    messages
  };
}

/**
 * Check if an item is protected by storage upgrades
 */
function isItemProtected(item, coldCellarLevel, secureCratesLevel) {
  // Cold Cellar protects fresh/spoilable ingredients
  if (coldCellarLevel > 0 && item.tags?.includes('fresh')) {
    return true;
  }

  // Secure Crates protect valuable items (rare/epic tier)
  if (secureCratesLevel > 0 && (item.tier === 'rare' || item.tier === 'epic')) {
    return true;
  }

  return false;
}

/**
 * C6: AFK & Inactivity Flags
 * 
 * Track player activity and derive inactivity flags.
 * 
 * @param {number} lastActiveAt - Last active timestamp
 * @param {number} now - Current timestamp
 * @returns {Object} - Inactivity status with flags
 */
export function getInactivityStatus(lastActiveAt, now) {
  const elapsedMs = now - lastActiveAt;

  return {
    last_active_at: lastActiveAt,
    elapsed_ms: elapsedMs,
    is_inactive_7d: elapsedMs >= INACTIVE_7D_MS,
    is_inactive_30d: elapsedMs >= INACTIVE_30D_MS,
    elapsed_days: Math.floor(elapsedMs / (24 * 60 * 60 * 1000))
  };
}

/**
 * C7: Offline Cooldown Behavior
 * 
 * Cooldowns continue to elapse in real time.
 * Check if cooldown has expired while player was offline.
 * 
 * @param {Object} player - Player profile
 * @param {number} now - Current timestamp
 * @returns {Object} - Cooldown status with expired cooldowns
 */
export function checkCooldownCatchup(player, now) {
  const cooldowns = player.cooldowns || {};
  const expired = [];

  for (const [key, expiresAt] of Object.entries(cooldowns)) {
    if (expiresAt && now >= expiresAt) {
      expired.push(key);
    }
  }

  return {
    expired,
    hasExpired: expired.length > 0
  };
}

/**
 * Generate welcome back message for returning players
 * 
 * @param {Object} inactivityStatus - Inactivity status from getInactivityStatus
 * @param {Object} serverState - Server state
 * @param {Object} content - Content bundle
 * @returns {string|null} - Welcome back message or null
 */
export function generateWelcomeBackMessage(inactivityStatus, serverState, content) {
  if (!inactivityStatus.is_inactive_7d) {
    return null;
  }

  const days = inactivityStatus.elapsed_days;
  const messages = [];

  if (inactivityStatus.is_inactive_30d) {
    messages.push(`🎉 Welcome back after **${days} days**! We've missed you.`);
  } else {
    messages.push(`👋 Welcome back! It's been **${days} days**.`);
  }

  // Highlight season if available
  if (serverState.season) {
    messages.push(`🍂 The world is currently in **${serverState.season}**.`);
  }

  return messages.join(" ");
}

/**
 * Main time catch-up orchestration
 * 
 * Called before state-changing commands to reconcile time-based systems.
 * 
 * @param {Object} player - Player profile
 * @param {Object} serverState - Server state
 * @param {Object} settings - Server settings
 * @param {Object} content - Content bundle
 * @param {number} lastActiveAt - Last active timestamp from DB
 * @param {number} now - Current timestamp
 * @returns {Object} - Catch-up results with messages
 */
export function applyTimeCatchup(player, serverState, settings, content, lastActiveAt, now, effects = null) {
  const messages = [];
  let applied = false;

  // Get inactivity status
  const inactivityStatus = getInactivityStatus(lastActiveAt, now);

  // C6: Welcome back message for returning players
  const welcomeMsg = generateWelcomeBackMessage(inactivityStatus, serverState, content);
  if (welcomeMsg) {
    messages.push(welcomeMsg);
    applied = true;
  }

  // C1: Apply spoilage catch-up
  const spoilage = applySpoilageCatchup(player, settings, content, lastActiveAt, now, effects);
  if (spoilage.applied) {
    messages.push(...spoilage.messages);
    applied = true;
  }

  // C7: Check cooldown catch-up (informational only, cooldowns auto-expire)
  const cooldownStatus = checkCooldownCatchup(player, now);

  return {
    applied,
    messages,
    inactivityStatus,
    spoilage,
    cooldownStatus
  };
}
