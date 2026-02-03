import { test } from "node:test";
import assert from "node:assert";
import {
  rollDailyStaffPool,
  hireStaff,
  fireStaff,
  getMaxStaffCapacity,
  calculateStaffEffects,
  getHiredStaff,
  applyDailyWages
} from "../src/game/staff.js";
import { loadStaffContent } from "../src/content/index.js";

const staffContent = loadStaffContent();

function makeTestPlayer() {
  return {
    user_id: "test-user",
    coins: 1000,
    upgrades: {
      u_staff_quarters: 0,
      u_manuals: 0
    },
    staff_hired: {}
  };
}

test("Staff: rollDailyStaffPool returns correct pool size", () => {
  const pool = rollDailyStaffPool({ serverId: "test-server", staffContent });
  assert.ok(Array.isArray(pool));
  // Pool size may be less than 4 due to duplicate filtering
  assert.ok(pool.length >= 3 && pool.length <= 4);
  // Verify all items are valid staff IDs
  pool.forEach(staffId => {
    assert.ok(staffContent.staff_members[staffId]);
  });
});

test("Staff: hireStaff successfully hires when conditions met", () => {
  const player = makeTestPlayer();
  player.coins = 500;
  
  const result = hireStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, true);
  assert.ok(player.staff_hired["prep_chef"]);
  assert.ok(player.coins < 500); // Coins were deducted
});

test("Staff: hireStaff fails when insufficient coins", () => {
  const player = makeTestPlayer();
  player.coins = 100;
  
  const result = hireStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(player.staff_hired["prep_chef"], undefined);
  assert.strictEqual(player.coins, 100); // No change
});

test("Staff: hireStaff fails when already hired", () => {
  const player = makeTestPlayer();
  player.coins = 500;
  player.staff_hired["prep_chef"] = { hired_at: Date.now() };
  
  const result = hireStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, false);
});

test("Staff: hireStaff fails when capacity full", () => {
  const player = makeTestPlayer();
  player.coins = 10000;
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now() },
    "sous_chef": { hired_at: Date.now() },
    "server": { hired_at: Date.now() }
  };
  
  const maxCapacity = getMaxStaffCapacity(player);
  assert.strictEqual(maxCapacity, 3); // Base capacity
  
  const result = hireStaff(player, "dishwasher", staffContent);
  
  assert.strictEqual(result.success, false);
  assert.ok(result.message.includes("capacity full"));
});

test("Staff: fireStaff removes staff member", () => {
  const player = makeTestPlayer();
  player.staff_hired["prep_chef"] = { hired_at: Date.now() };
  
  const result = fireStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(player.staff_hired["prep_chef"], undefined);
});

test("Staff: fireStaff fails when staff not hired", () => {
  const player = makeTestPlayer();
  
  const result = fireStaff(player, "prep_chef", staffContent);
  
  assert.strictEqual(result.success, false);
});

test("Staff: getMaxStaffCapacity increases with upgrades", () => {
  const player = makeTestPlayer();
  
  assert.strictEqual(getMaxStaffCapacity(player), 3); // Base
  
  player.upgrades.u_staff_quarters = 2;
  assert.strictEqual(getMaxStaffCapacity(player), 4); // Base + 1
  
  player.upgrades.u_staff_quarters = 4;
  assert.strictEqual(getMaxStaffCapacity(player), 5); // Base + 2
});

test("Staff: calculateStaffEffects aggregates bonuses", () => {
  const player = makeTestPlayer();
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now() },
    "server": { hired_at: Date.now() }
  };
  
  const effects = calculateStaffEffects(player, staffContent);
  
  assert.ok(effects.cooking_speed_bonus > 0);
  assert.ok(effects.rep_bonus_flat > 0);
});

test("Staff: calculateStaffEffects applies manuals multiplier", () => {
  const player = makeTestPlayer();
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now() }
  };
  
  const baseEffects = calculateStaffEffects(player, staffContent);
  const baseCookingSpeed = baseEffects.cooking_speed_bonus;
  
  player.upgrades.u_manuals = 5; // +15% staff effects
  const boostedEffects = calculateStaffEffects(player, staffContent);
  
  assert.ok(boostedEffects.cooking_speed_bonus > baseCookingSpeed);
});

test("Staff: getHiredStaff returns staff details", () => {
  const player = makeTestPlayer();
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now(), total_wages_paid: 100 }
  };
  
  const hired = getHiredStaff(player, staffContent);
  
  assert.strictEqual(hired.length, 1);
  assert.strictEqual(hired[0].staffId, "prep_chef");
  assert.ok(hired[0].name);
  assert.ok(hired[0].daily_wage >= 0);
});

test("Staff: applyDailyWages deducts correct amount", () => {
  const player = makeTestPlayer();
  player.coins = 1000;
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now(), total_wages_paid: 0 },
    "server": { hired_at: Date.now(), total_wages_paid: 0 }
  };
  
  const initialCoins = player.coins;
  const result = applyDailyWages(player, staffContent);
  
  assert.ok(result.totalWages > 0);
  assert.strictEqual(player.coins, initialCoins - result.totalWages);
  assert.ok(player.staff_hired["prep_chef"].total_wages_paid > 0);
});

test("Staff: applyDailyWages can make coins negative", () => {
  const player = makeTestPlayer();
  player.coins = 10; // Not enough for wages
  player.staff_hired = {
    "prep_chef": { hired_at: Date.now(), total_wages_paid: 0 }
  };
  
  const result = applyDailyWages(player, staffContent);
  
  assert.ok(result.totalWages > 10);
  assert.ok(player.coins < 0); // Went negative
});
