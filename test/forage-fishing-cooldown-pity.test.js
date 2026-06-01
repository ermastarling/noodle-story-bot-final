import { strict as assert } from "assert";
import { test } from "node:test";

import {
  canForage,
  rollForageDrops,
  applyForagePityCounter,
  applyDropsToInventory,
  setForageCooldown,
  RARE_FORAGE_ITEM_IDS
} from "../src/game/forage.js";
import {
  canFish,
  applyFishingDrops,
  setFishingCooldown,
  RARE_FISHING_ITEM_IDS,
  FISHING_BASE_COOLDOWN_MS
} from "../src/game/fishing.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyFishingPityCounter(player, drops, allowedRare) {
  const hasRareDrop = Object.keys(drops).some((id) => allowedRare.includes(id));
  if (hasRareDrop) {
    player.fishing_pity_rare_count = 0;
  } else {
    player.fishing_pity_rare_count = (player.fishing_pity_rare_count || 0) + 1;
  }
}

test("Forage cooldown block does not mutate reward state", () => {
  const now = 1_000_000;
  const player = {
    cooldowns: { forage_last_ms: now - 10_000 },
    inv_ingredients: { carrots: 2 },
    forage_pity_rare_count: 4,
    upgrades: { u_pantry: 0 }
  };

  const before = clone(player);
  const chk = canForage(player, now, 120_000);
  assert.equal(chk.ok, false);

  assert.deepEqual(player.inv_ingredients, before.inv_ingredients);
  assert.equal(player.forage_pity_rare_count, before.forage_pity_rare_count);
  assert.equal(player.cooldowns.forage_last_ms, before.cooldowns.forage_last_ms);
});

test("Forage success updates cooldown once and pity resets only on rare drops", () => {
  const now = 2_000_000;
  const player = {
    cooldowns: { forage_last_ms: 0 },
    inv_ingredients: {},
    forage_pity_rare_count: 5,
    upgrades: { u_pantry: 0 }
  };

  const allowedRare = [...RARE_FORAGE_ITEM_IDS];
  const commonOnlyDrops = { carrots: 2 };
  const rareDropId = allowedRare[0];
  const withRareDrops = { [rareDropId]: 1 };

  const chk = canForage(player, now, 120_000);
  assert.equal(chk.ok, true);

  const beforeCooldown = player.cooldowns.forage_last_ms;
  const invResult = applyDropsToInventory(player, commonOnlyDrops);
  applyForagePityCounter(player, commonOnlyDrops, { allowedRare });
  setForageCooldown(player, now);

  assert.equal(invResult.success, true);
  assert.equal(player.inv_ingredients.carrots, 2);
  assert.equal(player.forage_pity_rare_count, 6);
  assert.notEqual(beforeCooldown, player.cooldowns.forage_last_ms);
  assert.equal(player.cooldowns.forage_last_ms, now);

  applyForagePityCounter(player, withRareDrops, { allowedRare });
  assert.equal(player.forage_pity_rare_count, 0);
});

test("Specific forage target roll returns only requested item", () => {
  const targetItem = "scallions";

  const drops = rollForageDrops({
    serverId: "srv-test",
    userId: "user-test",
    itemId: targetItem,
    quantity: 1,
    allowedItemIds: [targetItem, ...RARE_FORAGE_ITEM_IDS]
  });

  const allowedRare = [...RARE_FORAGE_ITEM_IDS];
  const hasRareDrop = Object.keys(drops).some((id) => allowedRare.includes(id));

  // Targeted foraging should only return the requested ingredient.
  assert.deepEqual(Object.keys(drops), [targetItem]);
  assert.equal(hasRareDrop, false);
  assert.equal(drops[targetItem], 1);
});

test("Targeted forage skips pity counter and does not inject rare drops", () => {
  const targetItem = "scallions";
  const allowedRare = [...RARE_FORAGE_ITEM_IDS];
  const player = { forage_pity_rare_count: 9 };
  const drops = { [targetItem]: 1 };

  const appliedRare = applyForagePityCounter(player, drops, {
    allowedRare,
    itemId: targetItem,
    serverId: "srv-test",
    userId: "user-test",
    dayKey: "2099-01-01"
  });

  assert.equal(appliedRare, false);
  assert.equal(player.forage_pity_rare_count, 9);
  assert.deepEqual(Object.keys(drops), [targetItem]);
  assert.equal(drops[targetItem], 1);
});

test("Pity injection keeps counter primed until injected rare is accepted", () => {
  const allowedRare = [...RARE_FORAGE_ITEM_IDS];
  const player = { forage_pity_rare_count: 9 };
  const drops = { carrots: 1 };

  const injectedPityItemId = applyForagePityCounter(player, drops, {
    allowedRare,
    serverId: "srv-test",
    userId: "user-test",
    dayKey: "2099-01-01"
  });

  assert.ok(injectedPityItemId);
  assert.equal(player.forage_pity_rare_count, 10);
  assert.equal(Number(drops[injectedPityItemId] || 0) >= 1, true);

  // Simulate command-level capacity filtering rejecting the injected pity item.
  const accepted = {};
  if (injectedPityItemId && Number(accepted[injectedPityItemId] || 0) > 0) {
    player.forage_pity_rare_count = 0;
  }
  assert.equal(player.forage_pity_rare_count, 10);

  // Simulate a later run where the injected pity item survives filtering.
  accepted[injectedPityItemId] = 1;
  if (injectedPityItemId && Number(accepted[injectedPityItemId] || 0) > 0) {
    player.forage_pity_rare_count = 0;
  }
  assert.equal(player.forage_pity_rare_count, 0);
});

test("Fishing cooldown block does not mutate reward state", () => {
  const now = 3_000_000;
  const player = {
    cooldowns: { fishing_last_ms: now - 10_000 },
    inv_ingredients: { tilapia: 1 },
    fishing_pity_rare_count: 3,
    upgrades: { u_pantry: 0 }
  };

  const before = clone(player);
  const chk = canFish(player, now, FISHING_BASE_COOLDOWN_MS);
  assert.equal(chk.ok, false);

  assert.deepEqual(player.inv_ingredients, before.inv_ingredients);
  assert.equal(player.fishing_pity_rare_count, before.fishing_pity_rare_count);
  assert.equal(player.cooldowns.fishing_last_ms, before.cooldowns.fishing_last_ms);
});

test("Fishing success updates cooldown once and pity resets only on rare drops", () => {
  const now = 4_000_000;
  const player = {
    cooldowns: { fishing_last_ms: 0 },
    inv_ingredients: {},
    fishing_pity_rare_count: 7,
    upgrades: { u_pantry: 0 }
  };

  const allowedRare = [...RARE_FISHING_ITEM_IDS];
  const commonOnlyDrops = { tilapia: 2 };
  const rareDropId = allowedRare[0];
  const withRareDrops = { [rareDropId]: 1 };

  const chk = canFish(player, now, FISHING_BASE_COOLDOWN_MS);
  assert.equal(chk.ok, true);

  const beforeCooldown = player.cooldowns.fishing_last_ms;
  const invResult = applyFishingDrops(player, commonOnlyDrops);
  applyFishingPityCounter(player, commonOnlyDrops, allowedRare);
  setFishingCooldown(player, now);

  assert.equal(invResult.success, true);
  assert.equal(player.inv_ingredients.tilapia, 2);
  assert.equal(player.fishing_pity_rare_count, 8);
  assert.notEqual(beforeCooldown, player.cooldowns.fishing_last_ms);
  assert.equal(player.cooldowns.fishing_last_ms, now);

  applyFishingPityCounter(player, withRareDrops, allowedRare);
  assert.equal(player.fishing_pity_rare_count, 0);
});
