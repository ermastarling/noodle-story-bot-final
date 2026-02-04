import { test } from "node:test";
import assert from "node:assert";
import {
  levelUpStaff,
  getMaxStaffCapacity,
  calculateStaffEffects,
  getStaffLevels,
  calculateStaffCost
} from "../src/game/staff.js";
import { loadStaffContent } from "../src/content/index.js";

const staffContent = loadStaffContent();

function makeTestPlayer() {
  return {
    user_id: "test-user",
    coins: 10000,
    upgrades: {
      u_staff_quarters: 0,
      u_manuals: 0
    },
    staff_levels: {}
  };
}

test("Staff: levelUpStaff successfully levels up when conditions met", () => {
  const player = makeTestPlayer();
  player.coins = 500;
  
  const result = levelUpStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.staff_levels["prep_chef"], 1);
  assert.ok(player.coins < 500); // Coins were deducted
});

test("Staff: levelUpStaff fails when insufficient coins", () => {
  const player = makeTestPlayer();
  player.coins = 100;
  
  const result = levelUpStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(player.staff_levels["prep_chef"], undefined);
  assert.strictEqual(player.coins, 100); // No change
});

test("Staff: levelUpStaff fails at max level", () => {
  const player = makeTestPlayer();
  player.coins = 999999;
  player.staff_levels["prep_chef"] = 20; // Max level
  
  const result = levelUpStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes("max level"));
});

test("Staff: levelUpStaff cost increases with each level", () => {
  const player = makeTestPlayer();
  player.coins = 999999;
  
  const result1 = levelUpStaff(player, "prep_chef", staffContent);
  const cost1 = result1.cost;
  
  const result2 = levelUpStaff(player, "prep_chef", staffContent);
  const cost2 = result2.cost;
  
  assert.ok(cost2 > cost1);
});

test("Staff: getMaxStaffCapacity returns 12 for all staff", () => {
  const player = makeTestPlayer();
  
  assert.strictEqual(getMaxStaffCapacity(player), 12);
});

test("Staff: calculateStaffEffects aggregates bonuses", () => {
  const player = makeTestPlayer();
  player.staff_levels = {
    "server": 3,
    "forager": 2
  };
  
  const effects = calculateStaffEffects(player, staffContent);
  
  assert.ok(effects.rep_bonus_flat > 0);
  assert.ok(effects.forage_bonus_items > 0);
});

test("Staff: calculateStaffEffects scales with level", () => {
  const player = makeTestPlayer();
  
  player.staff_levels = { "forager": 1 };
  const effects1 = calculateStaffEffects(player, staffContent);
  const forage1 = effects1.forage_bonus_items;
  
  player.staff_levels = { "forager": 5 };
  const effects5 = calculateStaffEffects(player, staffContent);
  const forage5 = effects5.forage_bonus_items;
  
  assert.ok(forage5 > forage1);
  assert.strictEqual(forage5, forage1 * 5);
});

test("Staff: calculateStaffEffects applies manuals multiplier", () => {
  const player = makeTestPlayer();
  player.staff_levels = {
    "server": 2
  };
  
  const baseEffects = calculateStaffEffects(player, staffContent);
  const baseRep = baseEffects.rep_bonus_flat;
  
  player.upgrades.u_manuals = 5; // +15% staff effects
  const boostedEffects = calculateStaffEffects(player, staffContent);
  
  assert.ok(boostedEffects.rep_bonus_flat > baseRep);
});

test("Staff: getStaffLevels returns staff details", () => {
  const player = makeTestPlayer();
  player.staff_levels = {
    "prep_chef": 5
  };
  
  const leveled = getStaffLevels(player, staffContent);
  
  assert.strictEqual(leveled.length, 1);
  assert.strictEqual(leveled[0].staffId, "prep_chef");
  assert.strictEqual(leveled[0].level, 5);
  assert.ok(leveled[0].name);
  assert.ok(leveled[0].nextCost >= 0);
});

test("Staff: calculateStaffCost returns correct cost", () => {
  const staff = staffContent.staff_members.prep_chef;
  
  const cost0 = calculateStaffCost(staff, 0);
  assert.strictEqual(cost0, 300); // Base cost
  
  const cost1 = calculateStaffCost(staff, 1);
  assert.ok(cost1 > cost0); // Cost increases
  
  const cost5 = calculateStaffCost(staff, 5);
  assert.ok(cost5 > cost1); // Cost continues to increase
});

test("Staff: calculateStaffCost returns 0 at max level", () => {
  const staff = staffContent.staff_members.prep_chef;
  const cost = calculateStaffCost(staff, staff.max_level);
  
  assert.strictEqual(cost, 0);
});

test("Staff: Forager provides +1 forage item per level", () => {
  const player = makeTestPlayer();
  player.staff_levels = {
    "forager": 3
  };
  
  const effects = calculateStaffEffects(player, staffContent);
  
  assert.strictEqual(effects.forage_bonus_items, 3); // 3 levels * 1
});

test("Staff: Epic staff have max level of 10", () => {
  const masterChef = staffContent.staff_members.master_chef;
  const storyteller = staffContent.staff_members.storyteller;
  const sommelier = staffContent.staff_members.sommelier;
  
  assert.strictEqual(masterChef.max_level, 10);
  assert.strictEqual(storyteller.max_level, 10);
  assert.strictEqual(sommelier.max_level, 10);
});

test("Staff: Common/Rare staff have max level of 20", () => {
  const prepChef = staffContent.staff_members.prep_chef;
  const sousChef = staffContent.staff_members.sous_chef;
  const forager = staffContent.staff_members.forager;
  
  assert.strictEqual(prepChef.max_level, 20);
  assert.strictEqual(sousChef.max_level, 20);
  assert.strictEqual(forager.max_level, 20);
});
