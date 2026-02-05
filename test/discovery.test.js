import { strict as assert } from "assert";
import { test } from "node:test";
import {
  canDiscoverTier,
  getDiscoverableRecipes,
  applyDiscovery,
  applyNpcDiscoveryBuff
} from "../src/game/discovery.js";

// Mock content bundle
const mockContent = {
  recipes: {
    classic_soy_ramen: {
      recipe_id: "classic_soy_ramen",
      name: "Classic Soy Ramen",
      tier: "common",
      ingredients: [
        { item_id: "soy_broth", qty: 1 }
      ]
    },
    fancy_ramen: {
      recipe_id: "fancy_ramen",
      name: "Fancy Ramen",
      tier: "rare",
      ingredients: [
        { item_id: "soy_broth", qty: 1 },
        { item_id: "rare_mushroom", qty: 1 }
      ]
    },
    epic_ramen: {
      recipe_id: "epic_ramen",
      name: "Epic Ramen",
      tier: "epic",
      ingredients: [
        { item_id: "soy_broth", qty: 1 }
      ]
    },
    seasonal_ramen: {
      recipe_id: "seasonal_ramen",
      name: "Seasonal Ramen",
      tier: "seasonal",
      ingredients: [
        { item_id: "soy_broth", qty: 1 }
      ]
    }
  },
  items: {
    soy_broth: { item_id: "soy_broth", tier: "common", category: "broth" },
    rare_mushroom: { item_id: "rare_mushroom", tier: "rare", category: "topping" }
  }
};

test("Discovery: canDiscoverTier - level 1 can discover common", () => {
  const player = { shop_level: 1, rep: 0 };
  assert.strictEqual(canDiscoverTier(player, "common"), true);
});

test("Discovery: canDiscoverTier - level 1 cannot discover rare", () => {
  const player = { shop_level: 1, rep: 0 };
  assert.strictEqual(canDiscoverTier(player, "rare"), false);
});

test("Discovery: canDiscoverTier - level 5 with rep 25 can discover rare", () => {
  const player = { shop_level: 5, rep: 25 };
  assert.strictEqual(canDiscoverTier(player, "rare"), true);
});

test("Discovery: canDiscoverTier - level 10 with rep 100 can discover epic", () => {
  const player = { shop_level: 10, rep: 100 };
  assert.strictEqual(canDiscoverTier(player, "epic"), true);
});

test("Discovery: canDiscoverTier - level 12 with rep 150 can discover seasonal", () => {
  const player = { shop_level: 12, rep: 150 };
  assert.strictEqual(canDiscoverTier(player, "seasonal"), true);
});

test("Discovery: getDiscoverableRecipes - filters known recipes", () => {
  const player = {
    shop_level: 10,
    rep: 100,
    known_recipes: ["classic_soy_ramen"]
  };
  const discoverableRecipes = getDiscoverableRecipes(player, mockContent);
  const recipeIds = discoverableRecipes.map(r => r.recipe_id);
  
  assert.ok(!recipeIds.includes("classic_soy_ramen"), "Should not include known recipe");
  assert.ok(recipeIds.includes("fancy_ramen"), "Should include rare recipe");
  assert.ok(recipeIds.includes("epic_ramen"), "Should include epic recipe");
});

test("Discovery: getDiscoverableRecipes - respects tier gating", () => {
  const player = {
    shop_level: 5,
    rep: 25,
    known_recipes: []
  };
  const discoverableRecipes = getDiscoverableRecipes(player, mockContent);
  const recipeIds = discoverableRecipes.map(r => r.recipe_id);
  
  assert.ok(recipeIds.includes("classic_soy_ramen"), "Should include common recipe");
  assert.ok(recipeIds.includes("fancy_ramen"), "Should include rare recipe");
  assert.ok(!recipeIds.includes("epic_ramen"), "Should not include epic recipe");
  assert.ok(!recipeIds.includes("seasonal_ramen"), "Should not include seasonal recipe");
});

test("Discovery: applyDiscovery - new clue is added", () => {
  const player = {
    clues_owned: {},
    coins: 100
  };
  const discovery = {
    type: "clue",
    clueId: "clue_123",
    recipeId: "fancy_ramen",
    recipeName: "Fancy Ramen",
    recipeTier: "rare"
  };
  
  const result = applyDiscovery(player, discovery, mockContent);
  
  assert.strictEqual(result.isDuplicate, false);
  assert.ok(result.message.includes("Fancy Ramen"));
  assert.ok(player.clues_owned.fancy_ramen);
  assert.strictEqual(player.coins, 100);
});

test("Discovery: applyDiscovery - duplicate clue gives coins", () => {
  const player = {
    clues_owned: {
      fancy_ramen: { clue_id: "clue_old", recipe_id: "fancy_ramen", obtained_at: 123 }
    },
    known_recipes: ["fancy_ramen"],
    coins: 100
  };
  const discovery = {
    type: "clue",
    clueId: "clue_new",
    recipeId: "fancy_ramen",
    recipeName: "Fancy Ramen",
    recipeTier: "rare"
  };
  
  const result = applyDiscovery(player, discovery, mockContent);
  
  assert.strictEqual(result.isDuplicate, true);
  assert.ok(result.reward.includes("25c"));
  assert.strictEqual(player.coins, 125);
});

test("Discovery: applyDiscovery - new scroll learns recipe", () => {
  const player = {
    scrolls_owned: {},
    known_recipes: ["classic_soy_ramen"],
    coins: 100
  };
  const discovery = {
    type: "scroll",
    scrollId: "scroll_123",
    recipeId: "fancy_ramen",
    recipeName: "Fancy Ramen",
    recipeTier: "rare",
    rarity: "rare"
  };
  
  const result = applyDiscovery(player, discovery, mockContent);
  
  assert.strictEqual(result.isDuplicate, false);
  assert.ok(result.message.includes("Learned"));
  assert.ok(player.scrolls_owned.fancy_ramen);
  assert.ok(player.known_recipes.includes("fancy_ramen"));
});

test("Discovery: applyDiscovery - duplicate scroll gives coins", () => {
  const player = {
    scrolls_owned: {
      fancy_ramen: { scroll_id: "scroll_old", recipe_id: "fancy_ramen", obtained_at: 123 }
    },
    known_recipes: ["classic_soy_ramen", "fancy_ramen"],
    coins: 100
  };
  const discovery = {
    type: "scroll",
    scrollId: "scroll_new",
    recipeId: "fancy_ramen",
    recipeName: "Fancy Ramen",
    recipeTier: "rare",
    rarity: "rare"
  };
  
  const result = applyDiscovery(player, discovery, mockContent);
  
  assert.strictEqual(result.isDuplicate, true);
  // 50% chance for token or coins, but we'll just check it's a duplicate
  assert.ok(result.reward);
});

test("Discovery: applyNpcDiscoveryBuff - curious apprentice sets buff", () => {
  const player = { buffs: {} };
  
  applyNpcDiscoveryBuff(player, "curious_apprentice");
  
  assert.strictEqual(player.buffs.apprentice_bonus_pending, true);
});

test("Discovery: applyNpcDiscoveryBuff - other npcs don't set buff", () => {
  const player = { buffs: {} };
  
  applyNpcDiscoveryBuff(player, "sleepy_traveler");
  
  assert.strictEqual(player.buffs.apprentice_bonus_pending, undefined);
});
