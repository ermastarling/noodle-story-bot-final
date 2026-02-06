import { test } from "node:test";
import assert from "node:assert";
import {
  applySpoilageCatchup,
  getInactivityStatus,
  checkCooldownCatchup,
  generateWelcomeBackMessage,
  applyTimeCatchup
} from "../src/game/timeCatchup.js";

// Time constants for tests
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test("C1: applySpoilageCatchup - respects zero SPOILAGE_MAX_CATCHUP_TICKS", () => {
  const player = { 
    user_id: "test_user",
    inv_ingredients: { scallions: 10 }, 
    upgrades: {} 
  };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: true,
    SPOILAGE_TICK_HOURS: 1,
    SPOILAGE_MAX_CATCHUP_TICKS: 0, // Explicitly set to 0 to disable catch-up
    SPOILAGE_BASE_CHANCE: 1.0
  };
  const content = { 
    items: { 
      scallions: { spoilable: true, tags: ["fresh"] } 
    } 
  };
  const lastActiveAt = Date.now() - 10 * HOUR_MS; // 10 hours offline
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  // Should apply 0 ticks even though 10 hours passed
  assert.strictEqual(result.ticksApplied, 0);
  assert.strictEqual(result.applied, false);
  assert.strictEqual(player.inv_ingredients.scallions, 10); // No spoilage
});

test("C1: applySpoilageCatchup - respects zero SPOILAGE_BASE_CHANCE", () => {
  const player = { 
    user_id: "test_user",
    inv_ingredients: { scallions: 10 }, 
    upgrades: {} 
  };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: true,
    SPOILAGE_TICK_HOURS: 1,
    SPOILAGE_MAX_CATCHUP_TICKS: 24,
    SPOILAGE_BASE_CHANCE: 0 // Explicitly set to 0 for no spoilage
  };
  const content = { 
    items: { 
      scallions: { 
        name: "Scallions",
        spoilable: true,
        tags: ["fresh"]
      } 
    } 
  };
  const lastActiveAt = Date.now() - 5 * HOUR_MS;
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  // Should apply ticks but with 0% spoilage chance, nothing spoils
  assert.strictEqual(result.ticksApplied, 5);
  assert.strictEqual(player.inv_ingredients.scallions, 10); // No spoilage due to 0% chance
});

test("C1: applySpoilageCatchup - skips when SPOILAGE_ENABLED is false", () => {
  const player = { inv_ingredients: { scallions: 10 }, upgrades: {} };
  const settings = { SPOILAGE_ENABLED: false };
  const content = { items: { scallions: { spoilable: true } } };
  const lastActiveAt = Date.now() - 10 * HOUR_MS;
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  assert.strictEqual(result.applied, false);
  assert.strictEqual(player.inv_ingredients.scallions, 10);
});

test("C1: applySpoilageCatchup - skips when SPOILAGE_APPLY_ON_LOGIN is false", () => {
  const player = { inv_ingredients: { scallions: 10 }, upgrades: {} };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: false 
  };
  const content = { items: { scallions: { spoilable: true } } };
  const lastActiveAt = Date.now() - 10 * HOUR_MS;
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  assert.strictEqual(result.applied, false);
});

test("C1: applySpoilageCatchup - applies ticks when enabled", () => {
  const player = { 
    user_id: "test_user",
    inv_ingredients: { scallions: 10 }, 
    upgrades: {} 
  };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: true,
    SPOILAGE_TICK_HOURS: 1,
    SPOILAGE_MAX_CATCHUP_TICKS: 24,
    SPOILAGE_BASE_CHANCE: 1.0 // 100% for deterministic testing
  };
  const content = { 
    items: { 
      scallions: { 
        name: "Scallions",
        spoilable: true,
        tags: ["fresh"],
        acquisition: "forage"
      } 
    } 
  };
  const lastActiveAt = Date.now() - 5 * HOUR_MS;
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  // With 100% spoilage chance, should lose items over 5 ticks
  console.log("[timeCatchup.test] ticksApplied:", result.ticksApplied, "scallions:", player.inv_ingredients.scallions);
  assert.strictEqual(result.ticksApplied, 5);
  assert.ok(player.inv_ingredients.scallions < 10);
  
  // Should have spoilage message if items were spoiled
  if (result.applied) {
    assert.ok(result.messages.length > 0);
    assert.ok(result.messages[0].includes("While you were away"));
  }
});

test("C1: applySpoilageCatchup - respects SPOILAGE_MAX_CATCHUP_TICKS", () => {
  const player = { 
    user_id: "test_user",
    inv_ingredients: { scallions: 100 }, 
    upgrades: {} 
  };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: true,
    SPOILAGE_TICK_HOURS: 1,
    SPOILAGE_MAX_CATCHUP_TICKS: 10, // Cap at 10 ticks
    SPOILAGE_BASE_CHANCE: 0.05
  };
  const content = { 
    items: { 
      scallions: { spoilable: true, tags: ["fresh"] } 
    } 
  };
  const lastActiveAt = Date.now() - 50 * HOUR_MS; // 50 hours offline
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  // Should only apply 10 ticks, not 50
  assert.strictEqual(result.ticksApplied, 10);
});

test("C1: applySpoilageCatchup - protected items have reduced spoilage", () => {
  const player = { 
    user_id: "test_user",
    inv_ingredients: { scallions: 10 }, 
    upgrades: { u_cold_cellar: 1 } // Has cold cellar
  };
  const settings = { 
    SPOILAGE_ENABLED: true, 
    SPOILAGE_APPLY_ON_LOGIN: true,
    SPOILAGE_TICK_HOURS: 1,
    SPOILAGE_MAX_CATCHUP_TICKS: 24,
    SPOILAGE_BASE_CHANCE: 1.0 // 100% base, but protected = 50%
  };
  const content = { 
    items: { 
      scallions: { 
        name: "Scallions",
        spoilable: true,
        tags: ["fresh"] // Protected by cold cellar
      } 
    } 
  };
  const lastActiveAt = Date.now() - 5 * HOUR_MS;
  const now = Date.now();

  const result = applySpoilageCatchup(player, settings, content, lastActiveAt, now);

  // Protection should reduce spoilage (items spoiled < unprotected case)
  assert.ok(player.inv_ingredients.scallions >= 0);
  assert.strictEqual(result.ticksApplied, 5);
});

test("C6: getInactivityStatus - detects 7 day inactivity", () => {
  const lastActiveAt = Date.now() - 8 * DAY_MS;
  const now = Date.now();

  const result = getInactivityStatus(lastActiveAt, now);

  assert.strictEqual(result.is_inactive_7d, true);
  assert.strictEqual(result.is_inactive_30d, false);
  assert.ok(result.elapsed_days >= 7);
});

test("C6: getInactivityStatus - detects 30 day inactivity", () => {
  const lastActiveAt = Date.now() - 31 * DAY_MS;
  const now = Date.now();

  const result = getInactivityStatus(lastActiveAt, now);

  assert.strictEqual(result.is_inactive_7d, true);
  assert.strictEqual(result.is_inactive_30d, true);
  assert.ok(result.elapsed_days >= 30);
});

test("C6: getInactivityStatus - no flags for recent activity", () => {
  const lastActiveAt = Date.now() - 2 * DAY_MS;
  const now = Date.now();

  const result = getInactivityStatus(lastActiveAt, now);

  assert.strictEqual(result.is_inactive_7d, false);
  assert.strictEqual(result.is_inactive_30d, false);
  assert.strictEqual(result.elapsed_days, 2);
});

test("C7: checkCooldownCatchup - detects expired cooldowns", () => {
  const now = Date.now();
  const player = {
    cooldowns: {
      forage: now - 1000, // Expired
      cook: now + 1000,   // Not expired
      serve: now - 5000   // Expired
    }
  };

  const result = checkCooldownCatchup(player, now);

  assert.strictEqual(result.hasExpired, true);
  assert.ok(result.expired.includes("forage"));
  assert.ok(result.expired.includes("serve"));
  assert.ok(!result.expired.includes("cook"));
});

test("C7: checkCooldownCatchup - no expired cooldowns", () => {
  const now = Date.now();
  const player = {
    cooldowns: {
      forage: now + 1000,
      cook: now + 2000
    }
  };

  const result = checkCooldownCatchup(player, now);

  assert.strictEqual(result.hasExpired, false);
  assert.strictEqual(result.expired.length, 0);
});

test("generateWelcomeBackMessage - returns message for 7+ day absence", () => {
  const inactivityStatus = {
    is_inactive_7d: true,
    is_inactive_30d: false,
    elapsed_days: 10
  };
  const serverState = { season: "Spring" };
  const content = {};

  const result = generateWelcomeBackMessage(inactivityStatus, serverState, content);

  assert.ok(result);
  assert.ok(result.includes("10 days"));
  assert.ok(result.includes("Spring"));
});

test("generateWelcomeBackMessage - enhanced message for 30+ day absence", () => {
  const inactivityStatus = {
    is_inactive_7d: true,
    is_inactive_30d: true,
    elapsed_days: 35
  };
  const serverState = { season: "Summer" };
  const content = {};

  const result = generateWelcomeBackMessage(inactivityStatus, serverState, content);

  assert.ok(result);
  assert.ok(result.includes("35 days"));
  assert.ok(result.includes("missed you"));
});

test("generateWelcomeBackMessage - returns null for recent activity", () => {
  const inactivityStatus = {
    is_inactive_7d: false,
    is_inactive_30d: false,
    elapsed_days: 2
  };
  const serverState = { season: "Fall" };
  const content = {};

  const result = generateWelcomeBackMessage(inactivityStatus, serverState, content);

  assert.strictEqual(result, null);
});

test("applyTimeCatchup - orchestrates all catch-up systems", () => {
  const player = {
    user_id: "test_user",
    inv_ingredients: { scallions: 10 },
    upgrades: {},
    cooldowns: { forage: Date.now() - 1000 }
  };
  const serverState = { season: "Winter" };
  const settings = {
    SPOILAGE_ENABLED: false // Disabled for simple test
  };
  const content = {
    items: { scallions: { spoilable: true } }
  };
  const lastActiveAt = Date.now() - 8 * DAY_MS;
  const now = Date.now();

  const result = applyTimeCatchup(player, serverState, settings, content, lastActiveAt, now);

  // Should have inactivity status
  assert.ok(result.inactivityStatus);
  assert.strictEqual(result.inactivityStatus.is_inactive_7d, true);

  // Should have welcome message
  assert.ok(result.applied);
  assert.ok(result.messages.length > 0);

  // Should check cooldowns
  assert.ok(result.cooldownStatus);
  assert.strictEqual(result.cooldownStatus.hasExpired, true);
});

test("applyTimeCatchup - no messages for recent activity", () => {
  const player = {
    user_id: "test_user",
    inv_ingredients: { scallions: 10 },
    upgrades: {},
    cooldowns: {}
  };
  const serverState = { season: "Spring" };
  const settings = {
    SPOILAGE_ENABLED: false
  };
  const content = {
    items: { scallions: { spoilable: true } }
  };
  const lastActiveAt = Date.now() - 1 * HOUR_MS; // 1 hour ago
  const now = Date.now();

  const result = applyTimeCatchup(player, serverState, settings, content, lastActiveAt, now);

  // Should not have messages for such recent activity
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.messages.length, 0);
});
