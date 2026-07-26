import { test } from "node:test";
import assert from "node:assert";
import {
  levelUpStaff,
  getMaxStaffCapacity,
  calculateStaffEffects,
  getStaffLevels,
  calculateStaffCost,
  getStaffUnlockStatus
} from "../src/game/staff.js";
import { loadStaffContent } from "../src/content/index.js";
import { noodleStaffHandler } from "../src/commands/noodleStaff.js";

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

test("Staff: Fisher Crew stays locked until fishing unlock level", () => {
  const player = makeTestPlayer();
  player.shop_level = 10;
  player.coins = 999999;

  const fisherCrew = staffContent.staff_members.fisher_crew;
  const lockStatus = getStaffUnlockStatus(player, fisherCrew);
  assert.strictEqual(lockStatus.unlocked, false);

  const lockedResult = levelUpStaff(player, "fisher_crew", staffContent);
  assert.strictEqual(lockedResult.success, false);
  assert.match(lockedResult.message, /Unlocks at shop level 65/i);
  assert.strictEqual(player.staff_levels.fisher_crew, undefined);

  player.shop_level = 65;
  const unlockedStatus = getStaffUnlockStatus(player, fisherCrew);
  assert.strictEqual(unlockedStatus.unlocked, true);

  const unlockedResult = levelUpStaff(player, "fisher_crew", staffContent);
  assert.strictEqual(unlockedResult.success, true);
  assert.strictEqual(player.staff_levels.fisher_crew, 1);
});

test("Staff: Garden staff stay locked until garden unlock level", () => {
  const player = makeTestPlayer();
  player.shop_level = 5;
  player.coins = 999999;

  const result = levelUpStaff(player, "gardener", staffContent);
  assert.strictEqual(result.success, false);
  assert.match(result.message, /Unlocks at shop level 25/i);
  assert.strictEqual(player.staff_levels.gardener, undefined);

  player.shop_level = 25;
  const unlockedResult = levelUpStaff(player, "gardener", staffContent);
  assert.strictEqual(unlockedResult.success, true);
  assert.strictEqual(player.staff_levels.gardener, 1);
});

test("Staff: kitchen-effect staff are not staff-gated", () => {
  const player = makeTestPlayer();
  player.shop_level = 44;

  const kitchenOnlyStaff = {
    staff_id: "kitchen_tester",
    name: "Kitchen Tester",
    max_level: 1,
    effects_per_level: { kitchen_simmer_time_reduction: 0.05 }
  };

  const status = getStaffUnlockStatus(player, kitchenOnlyStaff);
  assert.strictEqual(status.unlocked, true);
});

test("Staff: Forager remains upgradeable before garden but seed effect is locked", () => {
  const player = makeTestPlayer();
  player.shop_level = 10;
  player.coins = 999999;

  const status = getStaffUnlockStatus(player, staffContent.staff_members.forager);
  assert.strictEqual(status.unlocked, true);

  const result = levelUpStaff(player, "forager", staffContent);
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.staff_levels.forager, 1);

  const preGarden = calculateStaffEffects(player, staffContent);
  assert.strictEqual(preGarden.forage_bonus_items, 1);
  assert.strictEqual(preGarden.forage_seed_chance, 0);

  player.shop_level = 25;
  const postGarden = calculateStaffEffects(player, staffContent);
  assert.ok(postGarden.forage_seed_chance > 0);
});

test("Staff: Forage Manager remains upgradeable before garden but harvest cooldown effect is locked", () => {
  const player = makeTestPlayer();
  player.shop_level = 10;
  player.coins = 999999;

  const status = getStaffUnlockStatus(player, staffContent.staff_members.manager);
  assert.strictEqual(status.unlocked, true);

  const result = levelUpStaff(player, "manager", staffContent);
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.staff_levels.manager, 1);

  const preGarden = calculateStaffEffects(player, staffContent);
  assert.ok(preGarden.cooldown_reduction > 0);
  assert.strictEqual(preGarden.harvest_cooldown_reduction, 0);

  player.shop_level = 25;
  const postGarden = calculateStaffEffects(player, staffContent);
  assert.ok(postGarden.harvest_cooldown_reduction > 0);
});

test("Staff: levelUpStaff fails at max level", () => {
  const player = makeTestPlayer();
  player.coins = 999999;
  player.staff_levels["prep_chef"] = staffContent.staff_members.prep_chef.max_level; // Max level
  
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

test("Staff: getMaxStaffCapacity uses level gating and quarters", () => {
  const player = makeTestPlayer();
  player.shop_level = 1;

  assert.strictEqual(getMaxStaffCapacity(player, staffContent), 5);

  player.shop_level = 8;
  assert.strictEqual(getMaxStaffCapacity(player, staffContent), 8);

  player.upgrades.u_staff_quarters = 4; // +2 capacity
  assert.strictEqual(getMaxStaffCapacity(player, staffContent), 10);
});

test("Staff: getMaxStaffCapacity can exceed roster size", () => {
  const player = makeTestPlayer();
  player.shop_level = 25;
  player.upgrades.u_staff_quarters = 6; // +3 capacity

  assert.strictEqual(getMaxStaffCapacity(player, staffContent), 28);
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
  console.log("[staff.test] prep_chef cost1:", cost1);
  assert.ok(cost1 > cost0); // Cost increases
  
  const cost4 = calculateStaffCost(staff, 4);
  console.log("[staff.test] prep_chef cost4:", cost4, "max_level:", staff.max_level);
  assert.ok(cost4 > cost1); // Cost continues to increase
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

test("Staff: Common/Rare staff max levels match design", () => {
  const prepChef = staffContent.staff_members.prep_chef;
  const sousChef = staffContent.staff_members.sous_chef;
  const forager = staffContent.staff_members.forager;
  
  assert.strictEqual(prepChef.max_level, 10);
  assert.strictEqual(sousChef.max_level, 20);
  assert.strictEqual(forager.max_level, 20);
});

test("Staff command wrapper: acknowledged V2 payload falls back to editReply when raw webhook edit fails", async () => {
  let patchCalls = 0;
  let editReplyCalls = 0;

  const interaction = {
    id: `staff-wrap-${Date.now()}`,
    guildId: "g-staff",
    guild: { id: "g-staff" },
    channelId: "c-staff",
    user: { id: "u-staff-wrap" },
    token: "tok-staff",
    applicationId: "app-staff",
    isButton: () => true,
    isSelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    deferred: false,
    replied: true,
    client: {
      api: {
        webhooks: () => ({
          messages: () => ({
            patch: async () => {
              patchCalls += 1;
              throw new Error("raw webhook unavailable");
            }
          })
        })
      }
    },
    editReply: async () => {
      editReplyCalls += 1;
      return { ok: true, mode: "editReplyFallback" };
    },
    reply: async () => ({ ok: false }),
    deferReply: async () => ({ ok: false })
  };

  const result = await noodleStaffHandler(interaction);
  assert.strictEqual(patchCalls, 1);
  assert.strictEqual(editReplyCalls, 1);
  assert.strictEqual(result?.mode, "editReplyFallback");
});
