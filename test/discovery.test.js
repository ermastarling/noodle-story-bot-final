import { strict as assert } from "assert";
import { test } from "node:test";
import {
  canDiscoverTier,
  getDiscoverableRecipes,
  getDiscoveryRecipeWeight,
  getTakeoutDiscoveryAttemptLimit,
  rollRecipeDiscovery,
  applyDiscovery,
  applyNpcDiscoveryBuff
} from "../src/game/discovery.js";
import {
  CLUE_DUPLICATE_COINS,
  DISCOVERY_PITY_NO_DROP_SERVES,
  DISCOVERY_TIER_UNLOCK_LEVEL,
  DISCOVERY_TIER_UNLOCK_REP,
  SCROLL_DUPLICATE_COINS
} from "../src/constants.js";

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
    rare_mushroom: { item_id: "rare_mushroom", tier: "rare", category: "topping" },
    shrimp: { item_id: "shrimp", tier: "common", category: "protein" }
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

test("Discovery: canDiscoverTier - meets rare requirements", () => {
  const player = {
    shop_level: DISCOVERY_TIER_UNLOCK_LEVEL.rare,
    rep: DISCOVERY_TIER_UNLOCK_REP.rare
  };
  assert.strictEqual(canDiscoverTier(player, "rare"), true);
});

test("Discovery: canDiscoverTier - meets epic requirements", () => {
  const player = {
    shop_level: DISCOVERY_TIER_UNLOCK_LEVEL.epic,
    rep: DISCOVERY_TIER_UNLOCK_REP.epic
  };
  assert.strictEqual(canDiscoverTier(player, "epic"), true);
});

test("Discovery: canDiscoverTier - meets seasonal requirements", () => {
  const player = {
    shop_level: DISCOVERY_TIER_UNLOCK_LEVEL.seasonal,
    rep: DISCOVERY_TIER_UNLOCK_REP.seasonal
  };
  assert.strictEqual(canDiscoverTier(player, "seasonal"), true);
});

test("Discovery: getDiscoverableRecipes - filters known recipes", () => {
  const player = {
    shop_level: DISCOVERY_TIER_UNLOCK_LEVEL.epic,
    rep: DISCOVERY_TIER_UNLOCK_REP.epic,
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
    shop_level: DISCOVERY_TIER_UNLOCK_LEVEL.rare,
    rep: DISCOVERY_TIER_UNLOCK_REP.rare,
    known_recipes: []
  };
  const discoverableRecipes = getDiscoverableRecipes(player, mockContent);
  const recipeIds = discoverableRecipes.map(r => r.recipe_id);
  
  assert.ok(recipeIds.includes("classic_soy_ramen"), "Should include common recipe");
  assert.ok(recipeIds.includes("fancy_ramen"), "Should include rare recipe");
  assert.ok(!recipeIds.includes("epic_ramen"), "Should not include epic recipe");
  assert.ok(!recipeIds.includes("seasonal_ramen"), "Should not include seasonal recipe");
});

test("Discovery: getDiscoverableRecipes includes normal + current event recipes", () => {
  const contentWithEvents = {
    recipes: {
      normal_recipe: {
        recipe_id: "normal_recipe",
        name: "Normal Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      current_event_recipe: {
        recipe_id: "current_event_recipe",
        name: "Current Event Recipe",
        tier: "common",
        event_id: "event_summer",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      other_event_recipe: {
        recipe_id: "other_event_recipe",
        name: "Other Event Recipe",
        tier: "common",
        event_id: "event_winter",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {}
  };

  const discoverable = getDiscoverableRecipes(player, contentWithEvents, {
    activeEventId: "event_summer"
  }).map((r) => r.recipe_id);

  assert.ok(discoverable.includes("normal_recipe"), "Expected normal recipe to remain discoverable");
  assert.ok(discoverable.includes("current_event_recipe"), "Expected current event recipe to be discoverable");
  assert.ok(!discoverable.includes("other_event_recipe"), "Expected non-active event recipe to be excluded");
});

test("Discovery: getDiscoverableRecipes excludes event recipes without active event", () => {
  const contentWithEvent = {
    recipes: {
      normal_recipe: {
        recipe_id: "normal_recipe",
        name: "Normal Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      event_recipe: {
        recipe_id: "event_recipe",
        name: "Event Recipe",
        tier: "common",
        event_id: "event_summer",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {}
  };

  const discoverable = getDiscoverableRecipes(player, contentWithEvent, {
    activeEventId: null
  }).map((r) => r.recipe_id);

  assert.ok(discoverable.includes("normal_recipe"));
  assert.ok(!discoverable.includes("event_recipe"));
});

test("Discovery: takeout discovery attempt limit applies hard cap", () => {
  assert.equal(getTakeoutDiscoveryAttemptLimit(0), 0);
  assert.equal(getTakeoutDiscoveryAttemptLimit(1), 1);
  assert.equal(getTakeoutDiscoveryAttemptLimit(4), 4);
  assert.equal(getTakeoutDiscoveryAttemptLimit(9), 9);
  assert.equal(getTakeoutDiscoveryAttemptLimit(25), 12);
  assert.equal(getTakeoutDiscoveryAttemptLimit(100), 12);
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
  assert.strictEqual(result.reward, `+${CLUE_DUPLICATE_COINS}c (duplicate clue)`);
  assert.strictEqual(player.coins, 100 + CLUE_DUPLICATE_COINS);
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

test("Discovery: applyDiscovery - duplicate scroll gives coins branch", () => {
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
  
  const result = applyDiscovery(player, discovery, mockContent, () => 0.9);
  
  assert.strictEqual(result.isDuplicate, true);
  assert.strictEqual(result.reward, `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)`);
  assert.strictEqual(player.coins, 100 + SCROLL_DUPLICATE_COINS);
});

test("Discovery: applyDiscovery - duplicate scroll always gives coins", () => {
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

  const result = applyDiscovery(player, discovery, mockContent, () => 0.1);

  assert.strictEqual(result.isDuplicate, true);
  assert.strictEqual(result.reward, `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)`);
  assert.strictEqual(player.coins, 100 + SCROLL_DUPLICATE_COINS);
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

test("Discovery: getDiscoveryRecipeWeight reduces fishing recipes before unlock", () => {
  const player = { shop_level: 1 };
  const fishRecipe = {
    recipe_id: "fish_ramen",
    tier: "common",
    ingredients: [
      { item_id: "soy_broth", qty: 1 },
      { item_id: "catfish", qty: 1 }
    ]
  };
  const nonFishRecipe = {
    recipe_id: "veg_ramen",
    tier: "common",
    ingredients: [{ item_id: "soy_broth", qty: 1 }]
  };

  const fishWeight = getDiscoveryRecipeWeight(player, fishRecipe);
  const nonFishWeight = getDiscoveryRecipeWeight(player, nonFishRecipe);

  assert.ok(fishWeight < nonFishWeight);
});

test("Discovery: getDiscoveryRecipeWeight restores fishing recipe weight after unlock", () => {
  const player = { shop_level: 99 };
  const fishRecipe = {
    recipe_id: "fish_ramen",
    tier: "common",
    ingredients: [
      { item_id: "soy_broth", qty: 1 },
      { item_id: "catfish", qty: 1 }
    ]
  };

  const fishWeight = getDiscoveryRecipeWeight(player, fishRecipe);
  assert.strictEqual(fishWeight, 1);
});

test("Discovery: applyDiscovery clue does not reveal fish before fishing unlock", () => {
  const contentWithFish = {
    ...mockContent,
    recipes: {
      ...mockContent.recipes,
      fish_ramen: {
        recipe_id: "fish_ramen",
        name: "Fish Ramen",
        tier: "common",
        ingredients: [
          { item_id: "soy_broth", qty: 1 },
          { item_id: "shrimp", qty: 1 }
        ]
      }
    }
  };

  const player = {
    shop_level: 1,
    clues_owned: {},
    known_recipes: [],
    coins: 100
  };

  const discovery = {
    type: "clue",
    clueId: "clue_fish_1",
    recipeId: "fish_ramen",
    recipeName: "Fish Ramen",
    recipeTier: "common"
  };

  const result = applyDiscovery(player, discovery, contentWithFish, () => 0.99);
  assert.strictEqual(result.isDuplicate, false);
  assert.ok(player.clues_owned.fish_ramen);
  assert.deepEqual(player.clues_owned.fish_ramen.revealed_ingredients, ["soy_broth"]);
});

test("Discovery: applyDiscovery clue can reveal fish after fishing unlock", () => {
  const contentWithFish = {
    ...mockContent,
    recipes: {
      ...mockContent.recipes,
      fish_ramen: {
        recipe_id: "fish_ramen",
        name: "Fish Ramen",
        tier: "common",
        ingredients: [
          { item_id: "soy_broth", qty: 1 },
          { item_id: "shrimp", qty: 1 }
        ]
      }
    }
  };

  const player = {
    shop_level: 99,
    clues_owned: {},
    known_recipes: [],
    coins: 100
  };

  const discovery = {
    type: "clue",
    clueId: "clue_fish_2",
    recipeId: "fish_ramen",
    recipeName: "Fish Ramen",
    recipeTier: "common"
  };

  const result = applyDiscovery(player, discovery, contentWithFish, () => 0.99);
  assert.strictEqual(result.isDuplicate, false);
  assert.ok(player.clues_owned.fish_ramen);
  assert.deepEqual(player.clues_owned.fish_ramen.revealed_ingredients, ["shrimp"]);
});

test("Discovery: rollRecipeDiscovery base serve roll yields at most one drop", () => {
  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    scrolls_owned: {},
    clues_owned: {}
  };

  const rng = (() => {
    let x = 123456789;
    return () => {
      x = (1664525 * x + 1013904223) % 4294967296;
      return x / 4294967296;
    };
  })();

  for (let i = 0; i < 500; i++) {
    const discoveries = rollRecipeDiscovery({
      player,
      content: mockContent,
      npcArchetype: null,
      tier: "common",
      rng
    });
    assert.ok(discoveries.length <= 1, `Expected <=1 base discovery drop, got ${discoveries.length}`);
  }
});

test("Discovery: serve roll can produce duplicate clue when no new discoveries remain", () => {
  const content = {
    recipes: {
      known_recipe: {
        recipe_id: "known_recipe",
        name: "Known Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["known_recipe"],
    clues_owned: {},
    scrolls_owned: {},
    coins: 100
  };

  const seq = [0, 0, 0, 0];
  const rng = () => (seq.length ? seq.shift() : 0);

  const discoveries = rollRecipeDiscovery({
    player,
    content,
    npcArchetype: null,
    tier: "common",
    rng
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "clue");

  const result = applyDiscovery(player, discoveries[0], content, () => 0.9);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.reward, `+${CLUE_DUPLICATE_COINS}c (duplicate clue)`);
});

test("Discovery: serve roll can produce duplicate scroll when no new discoveries remain", () => {
  const content = {
    recipes: {
      scroll_recipe: {
        recipe_id: "scroll_recipe",
        name: "Scroll Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["scroll_recipe"],
    clues_owned: {},
    scrolls_owned: {
      scroll_recipe: { scroll_id: "scroll_old", recipe_id: "scroll_recipe", obtained_at: 123 }
    },
    coins: 100
  };

  const seq = [0, 0.999, 0, 0];
  const rng = () => (seq.length ? seq.shift() : 0);

  const discoveries = rollRecipeDiscovery({
    player,
    content,
    npcArchetype: null,
    tier: "common",
    rng
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "scroll");

  const result = applyDiscovery(player, discoveries[0], content, () => 0.9);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.reward, `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)`);
});

test("Discovery: serve clue roll can produce duplicate even when undiscovered recipes exist", () => {
  const content = {
    recipes: {
      known_recipe: {
        recipe_id: "known_recipe",
        name: "Known Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      unknown_recipe: {
        recipe_id: "unknown_recipe",
        name: "Unknown Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["known_recipe"],
    clues_owned: {},
    scrolls_owned: {},
    coins: 100
  };

  const rng = () => 0;
  const discoveries = rollRecipeDiscovery({
    player,
    content,
    npcArchetype: null,
    tier: "common",
    rng
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "clue");
  assert.equal(discoveries[0].recipeId, "known_recipe");

  const result = applyDiscovery(player, discoveries[0], content, () => 0.9);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.reward, `+${CLUE_DUPLICATE_COINS}c (duplicate clue)`);
});

test("Discovery: serve scroll roll can produce duplicate even when undiscovered recipes exist", () => {
  const content = {
    recipes: {
      known_scroll_recipe: {
        recipe_id: "known_scroll_recipe",
        name: "Known Scroll Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      unknown_scroll_recipe: {
        recipe_id: "unknown_scroll_recipe",
        name: "Unknown Scroll Recipe",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["known_scroll_recipe"],
    clues_owned: {},
    scrolls_owned: {
      known_scroll_recipe: { scroll_id: "scroll_old", recipe_id: "known_scroll_recipe", obtained_at: 123 }
    },
    coins: 100
  };

  const seq = [0, 0.999, 0, 0, 0, 0, 0];
  const rng = () => (seq.length ? seq.shift() : 0);
  const discoveries = rollRecipeDiscovery({
    player,
    content,
    npcArchetype: null,
    tier: "common",
    rng
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "scroll");
  assert.equal(discoveries[0].recipeId, "known_scroll_recipe");

  const result = applyDiscovery(player, discoveries[0], content, () => 0.9);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.reward, `+${SCROLL_DUPLICATE_COINS}c (duplicate scroll)`);
});

test("Discovery: rollRecipeDiscovery can drop clue for current event recipe", () => {
  const contentWithCurrentEventOnly = {
    recipes: {
      known_normal: {
        recipe_id: "known_normal",
        name: "Known Normal",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      event_recipe: {
        recipe_id: "event_recipe",
        name: "Event Recipe",
        tier: "common",
        event_id: "event_summer",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["known_normal"],
    clues_owned: {},
    scrolls_owned: {}
  };

  const seq = [0, 0, 0.5, 0, 0.999];
  const rng = () => (seq.length ? seq.shift() : 0);
  const discoveries = rollRecipeDiscovery({
    player,
    content: contentWithCurrentEventOnly,
    npcArchetype: null,
    tier: "common",
    rng,
    activeEventId: "event_summer"
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "clue");
  assert.equal(discoveries[0].recipeId, "event_recipe");
});

test("Discovery: rollRecipeDiscovery can drop scroll for current event recipe", () => {
  const contentWithCurrentEventOnly = {
    recipes: {
      known_normal: {
        recipe_id: "known_normal",
        name: "Known Normal",
        tier: "common",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      },
      event_recipe: {
        recipe_id: "event_recipe",
        name: "Event Recipe",
        tier: "common",
        event_id: "event_summer",
        ingredients: [{ item_id: "soy_broth", qty: 1 }]
      }
    },
    items: mockContent.items
  };

  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: ["known_normal"],
    clues_owned: {},
    scrolls_owned: {}
  };

  const seq = [0, 0.999, 0, 0];
  const rng = () => (seq.length ? seq.shift() : 0);
  const discoveries = rollRecipeDiscovery({
    player,
    content: contentWithCurrentEventOnly,
    npcArchetype: null,
    tier: "common",
    rng,
    activeEventId: "event_summer"
  });

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "scroll");
  assert.equal(discoveries[0].recipeId, "event_recipe");
});

test("Discovery: pity clue grants after long no-drop streak", () => {
  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {}
  };

  let discoveries = [];
  for (let i = 0; i < DISCOVERY_PITY_NO_DROP_SERVES; i++) {
    discoveries = rollRecipeDiscovery({
      player,
      content: mockContent,
      npcArchetype: null,
      tier: "common",
      rng: () => 0.999
    });
  }

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].type, "clue");
  assert.equal(Boolean(discoveries[0].pityGranted), true);
  assert.equal(player.discovery?.no_drop_serve_streak ?? 0, 0);
});

test("Discovery: no-drop streak increments before pity threshold", () => {
  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {}
  };

  const attempts = Math.max(1, DISCOVERY_PITY_NO_DROP_SERVES - 1);
  for (let i = 0; i < attempts; i++) {
    const discoveries = rollRecipeDiscovery({
      player,
      content: mockContent,
      npcArchetype: null,
      tier: "common",
      rng: () => 0.999
    });
    assert.equal(discoveries.length, 0);
  }

  assert.equal(player.discovery?.no_drop_serve_streak ?? 0, attempts);
});

test("Discovery: no pity/streak tracking mode does not increment streak", () => {
  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {},
    discovery: { no_drop_serve_streak: 7 }
  };

  const discoveries = rollRecipeDiscovery({
    player,
    content: mockContent,
    npcArchetype: null,
    tier: "common",
    rng: () => 0.999,
    allowPity: false,
    trackPityStreak: false
  });

  assert.equal(discoveries.length, 0);
  assert.equal(player.discovery?.no_drop_serve_streak ?? 0, 7);
});

test("Discovery: pity clue uses normal clue wording", () => {
  const player = {
    shop_level: 99,
    rep: 999,
    known_recipes: [],
    clues_owned: {},
    scrolls_owned: {}
  };

  const result = applyDiscovery(player, {
    type: "clue",
    recipeId: "classic_soy_ramen",
    recipeName: "Classic Soy Ramen",
    pityGranted: true
  }, mockContent, () => 0);

  assert.equal(typeof result.message, "string");
  assert.equal(result.message.includes("Pity clue granted"), false);
});
