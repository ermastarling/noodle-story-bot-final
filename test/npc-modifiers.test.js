import { strict as assert } from "assert";
import { test } from "node:test";
import { computeServeRewards } from "../src/game/serve.js";

// Mock content
const mockContent = {
  items: {
    soy_broth: { item_id: "soy_broth", tier: "common", category: "broth" },
    wheat_noodles: { item_id: "wheat_noodles", tier: "common", category: "noodle" },
    rare_mushroom: { item_id: "rare_mushroom", tier: "rare", category: "topping" },
    scallions: { item_id: "scallions", tier: "common", category: "topping" }
  }
};

const mockRecipe = {
  recipe_id: "classic_ramen",
  ingredients: [
    { item_id: "soy_broth", qty: 1 },
    { item_id: "wheat_noodles", qty: 1 },
    { item_id: "scallions", qty: 1 }
  ]
};

const mockRecipeWithRareTopping = {
  recipe_id: "rare_ramen",
  ingredients: [
    { item_id: "soy_broth", qty: 1 },
    { item_id: "wheat_noodles", qty: 1 },
    { item_id: "rare_mushroom", qty: 1 }
  ]
};

test("NPC: Rain-Soaked Courier applies +25% coin multiplier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "rain_soaked_courier",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // With courier modifier, coins should be 25% higher
  // Base common coins are ~27, with 1.25x should be ~33-34
  assert.ok(rewards.coins > 30, `Expected coins > 30, got ${rewards.coins}`);
});

test("NPC: Traveling Bard applies +10% coin multiplier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "traveling_bard",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // With bard modifier, coins should be 10% higher
  assert.ok(rewards.coins > 27, `Expected coins > 27, got ${rewards.coins}`);
});

test("NPC: Market Inspector adds +10 REP for rare tier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "rare",
    npcArchetype: "market_inspector",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base rare REP is 7, plus 10 from inspector = 17
  assert.strictEqual(rewards.rep, 17);
});

test("NPC: Market Inspector adds +10 REP for epic tier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "epic",
    npcArchetype: "market_inspector",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base epic REP is 15, plus 10 from inspector = 25
  assert.strictEqual(rewards.rep, 25);
});

test("NPC: Market Inspector does not add REP for common tier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "market_inspector",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base common REP is 3, no bonus from inspector
  assert.strictEqual(rewards.rep, 3);
});

test("NPC: Sleepy Traveler adds +5 REP on first serve of day", () => {
  const player = { shop_level: 1, rep: 0, daily: {} };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "sleepy_traveler",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base common REP is 3, plus 5 from first serve = 8
  assert.strictEqual(rewards.rep, 8);
});

test("NPC: Forest Spirit adds +10% SXP with rare topping", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "forest_spirit",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipeWithRareTopping,
    content: mockContent
  });
  
  // Base common SXP is 20, with 10% bonus = 22
  assert.strictEqual(rewards.sxp, 22);
});

test("NPC: Forest Spirit does not add SXP bonus without rare topping", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "forest_spirit",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base common SXP is 20, no bonus
  assert.strictEqual(rewards.sxp, 20);
});

test("NPC: Retired Captain adds +10 SXP for repeated recipe", () => {
  const player = { 
    shop_level: 1, 
    rep: 0, 
    buffs: { last_recipe_served: "classic_ramen" }
  };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "retired_captain",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base common SXP is 20, plus 10 from repeated recipe = 30
  assert.strictEqual(rewards.sxp, 30);
});

test("NPC: Moonlit Spirit adds +15 REP on epic tier", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "epic",
    npcArchetype: "moonlit_spirit",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Base epic REP is 15, plus 15 from moonlit spirit = 30
  assert.strictEqual(rewards.rep, 30);
});

test("NPC: Hearth Grandparent grants REP aura", () => {
  const player = { shop_level: 1, rep: 0, buffs: {} };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "hearth_grandparent",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  assert.strictEqual(rewards.repAuraGranted, true);
  assert.ok(player.buffs.rep_aura_expires_at > Date.now());
});

test("NPC: Night Market Regular doubles speed bonus", () => {
  const player = { shop_level: 1, rep: 0 };
  const now = Date.now();
  const acceptedAt = now - 5000; // 5 seconds ago
  
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "night_market_regular",
    isLimitedTime: true,
    servedAtMs: now,
    acceptedAtMs: acceptedAt,
    speedWindowSeconds: 120,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // Speed bonus should be doubled
  assert.ok(rewards.mSpeed > 1, "Speed multiplier should be greater than 1");
});

test("NPC: Festival-Goer adds +25% coins", () => {
  const player = { shop_level: 1, rep: 0 };
  const rewards = computeServeRewards({
    serverId: "test",
    tier: "common",
    npcArchetype: "festival_goer",
    isLimitedTime: false,
    servedAtMs: Date.now(),
    acceptedAtMs: null,
    speedWindowSeconds: null,
    player,
    recipe: mockRecipe,
    content: mockContent
  });
  
  // With festival-goer modifier, coins should be 25% higher
  assert.ok(rewards.coins > 30, `Expected coins > 30, got ${rewards.coins}`);
});
