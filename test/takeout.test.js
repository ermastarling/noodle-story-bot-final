import test from "node:test";
import assert from "node:assert/strict";

import {
  TAKEOUT_SHIFT_DURATION_MS,
  TAKEOUT_SNAPSHOT_MAX_ORDERS,
  TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS,
  TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS,
  createDefaultTakeoutState,
  ensureTakeoutState,
  getTakeoutMenuLimits,
  setTakeoutMenu,
  openTakeoutShift,
  isTakeoutShiftActive,
  finishTakeoutShiftIfEnded,
  claimTakeoutEarnings,
  buildTakeoutShiftSnapshot,
  computeTakeoutRequiredIngredients,
  computeTakeoutOperatingCost,
  startTakeoutShiftWithCoverage,
  processTakeoutCatchup
} from "../src/game/takeout.js";

test("Takeout: default state shape", () => {
  const state = createDefaultTakeoutState();
  assert.deepEqual(state.menu_recipe_ids, []);
  assert.equal(state.shift.status, "inactive");
  assert.equal(state.earned_unclaimed_coins, 0);
});

test("Takeout: menu limits allow fewer than 5 when learned recipes are below 5", () => {
  const limits = getTakeoutMenuLimits(3);
  assert.equal(limits.minRequired, 3);
  assert.equal(limits.maxAllowed, 3);
});

test("Takeout: set menu enforces min/max and learned recipe membership", () => {
  const player = {};
  ensureTakeoutState(player);

  const tooSmall = setTakeoutMenu(player, {
    menuRecipeIds: ["r1"],
    learnedRecipeIds: ["r1", "r2", "r3", "r4", "r5", "r6"]
  });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.reason, "menu_too_small");

  const ok = setTakeoutMenu(player, {
    menuRecipeIds: ["r1", "r2", "r3", "r4", "r5", "invalid"],
    learnedRecipeIds: ["r1", "r2", "r3", "r4", "r5", "r6"]
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(player.takeout.menu_recipe_ids, ["r1", "r2", "r3", "r4", "r5"]);
});

test("Takeout: finished shift can immediately be reopened for another 12h", () => {
  const player = {
    takeout: {
      menu_recipe_ids: ["r1", "r2", "r3", "r4", "r5"],
      shift: {
        status: "active",
        started_at: 100,
        ends_at: 200,
        last_processed_hour_index: 12,
        last_tick_at: 200,
        operating_cost_paid_marker: null,
        idle_order_board_snapshot: []
      },
      earned_unclaimed_coins: 0,
      updated_at: 200
    }
  };

  const endedNow = 300;
  const ended = finishTakeoutShiftIfEnded(player, endedNow);
  assert.equal(ended, true);
  assert.equal(player.takeout.shift.status, "inactive");

  const reopened = openTakeoutShift(player, { now: endedNow });
  assert.equal(reopened.ok, true);
  assert.equal(player.takeout.shift.status, "active");
  assert.equal(player.takeout.shift.started_at, endedNow);
  assert.equal(player.takeout.shift.ends_at, endedNow + TAKEOUT_SHIFT_DURATION_MS);
  assert.equal(isTakeoutShiftActive(player, endedNow + 1), true);
});

test("Takeout: claim earnings moves coins and is idempotent when empty", () => {
  const player = {
    coins: 10,
    lifetime: { coins_earned: 5 },
    takeout: {
      menu_recipe_ids: [],
      shift: {
        status: "inactive",
        started_at: null,
        ends_at: null,
        last_processed_hour_index: 0,
        last_tick_at: null,
        operating_cost_paid_marker: null,
        idle_order_board_snapshot: []
      },
      earned_unclaimed_coins: 250,
      updated_at: null
    }
  };

  const first = claimTakeoutEarnings(player);
  assert.equal(first.ok, true);
  assert.equal(first.amount, 250);
  assert.equal(player.coins, 260);
  assert.equal(player.lifetime.coins_earned, 255);
  assert.equal(player.takeout.earned_unclaimed_coins, 0);

  const second = claimTakeoutEarnings(player);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "nothing_to_claim");
});

test("Takeout: fixed operating cost computed from 12h snapshot ingredient totals", () => {
  const snapshot = [
    { recipe_id: "r1", total_orders: 2, visible_order_count: 2, hourly_order_counts: [1, 1] },
    { recipe_id: "r2", total_orders: 1, visible_order_count: 1, hourly_order_counts: [1] }
  ];
  const recipes = {
    r1: { ingredients: [{ item_id: "i1", qty: 2 }, { item_id: "i2", qty: 1 }] },
    r2: { ingredients: [{ item_id: "i1", qty: 1 }] }
  };
  const required = computeTakeoutRequiredIngredients(snapshot, recipes);
  assert.deepEqual(required, { i1: 5, i2: 2 });

  const cost = computeTakeoutOperatingCost(required, {
    marketPrices: { i1: 3, i2: 4 },
    items: {}
  });
  assert.equal(cost, 23);
});

test("Takeout: shift cannot start when player cannot afford fixed operating cost", () => {
  const player = {
    coins: 5,
    takeout: {
      menu_recipe_ids: ["r1"],
      shift: {
        status: "inactive",
        started_at: null,
        ends_at: null,
        last_processed_hour_index: 0,
        last_tick_at: null,
        operating_cost_paid_marker: null,
        operating_cost: 0,
        required_ingredients: {},
        covered_ingredients: {},
        idle_order_board_snapshot: []
      },
      earned_unclaimed_coins: 0,
      updated_at: null
    }
  };

  const result = startTakeoutShiftWithCoverage(player, {
    now: 1000,
    recipes: {
      r1: { ingredients: [{ item_id: "i1", qty: 2 }] }
    },
    marketPrices: { i1: 2 },
    items: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient_coins");
  assert.ok(result.snapshotOrderTotal > 0);
  assert.equal(
    result.snapshot.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row?.total_orders || 0) || 0)), 0),
    result.snapshotOrderTotal
  );
  assert.equal(player.takeout.shift.status, "inactive");
  assert.equal(player.coins, 5);
});

test("Takeout: covered idle ingredient pool is isolated from pantry usage", () => {
  const player = {
    coins: 50_000,
    inv_ingredients: { i1: 1, i2: 0 },
    takeout: {
      menu_recipe_ids: ["r1"],
      shift: {
        status: "inactive",
        started_at: null,
        ends_at: null,
        last_processed_hour_index: 0,
        last_tick_at: null,
        operating_cost_paid_marker: null,
        operating_cost: 0,
        required_ingredients: {},
        covered_ingredients: {},
        idle_order_board_snapshot: []
      },
      earned_unclaimed_coins: 0,
      updated_at: null
    }
  };

  const result = startTakeoutShiftWithCoverage(player, {
    now: 2000,
    recipes: {
      r1: { ingredients: [{ item_id: "i1", qty: 2 }, { item_id: "i2", qty: 1 }] }
    },
    marketPrices: { i1: 3, i2: 4 },
    items: {}
  });

  assert.equal(result.ok, true);
  assert.equal(player.takeout.shift.status, "active");
  assert.equal(player.takeout.shift.operating_cost, result.operatingCost);
  assert.equal(player.takeout.shift.operating_cost_paid_marker, "takeout_shift:2000");
  assert.ok(Object.keys(player.takeout.shift.covered_ingredients).length > 0);
  assert.deepEqual(player.inv_ingredients, { i1: 1, i2: 0 });

  const firstCovered = player.takeout.shift.covered_ingredients;
  player.inv_ingredients.i1 = 0;
  assert.deepEqual(player.takeout.shift.covered_ingredients, firstCovered);
});

test("Takeout: generated shift snapshot spans 12 hours with recipe demand", () => {
  const snapshot = buildTakeoutShiftSnapshot(["r1", "r2", "r3"], { totalOrders: 120 });
  assert.equal(snapshot.length, 3);
  const total = snapshot.reduce((sum, row) => sum + row.total_orders, 0);
  assert.equal(total, 120);
  for (const row of snapshot) {
    assert.equal(row.hourly_order_counts.length, 12);
    assert.ok(row.total_orders > 0);
    assert.equal(row.visible_order_count, row.total_orders);
  }
});

test("Takeout: snapshot distribution is deterministic and sums to board total", () => {
  const snapshot = buildTakeoutShiftSnapshot(["r1", "r2", "r3", "r4"], { totalOrders: 137 });
  const total = snapshot.reduce((sum, row) => sum + row.total_orders, 0);
  assert.equal(total, 137);

  const hourlyTotals = Array.from({ length: 12 }, (_, hour) =>
    snapshot.reduce((sum, row) => sum + (row.hourly_order_counts[hour] ?? 0), 0)
  );
  assert.equal(hourlyTotals.reduce((sum, count) => sum + count, 0), 137);
  assert.ok(Math.max(...hourlyTotals) - Math.min(...hourlyTotals) <= 1);
});

test("Takeout: non-24/7 users snapshot board-total-at-open", () => {
  const player = { coins: 50_000, takeout: createDefaultTakeoutState() };
  player.takeout.menu_recipe_ids = ["r1", "r2"];

  const open = startTakeoutShiftWithCoverage(player, {
    now: 0,
    boardOrderTotal: 140,
    unlimitedOrders: false,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
      r2: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] }
    },
    marketPrices: { i1: 1 },
    items: { i1: { base_price: 1 } }
  });

  assert.equal(open.ok, true);
  assert.equal(open.snapshotOrderTotal, 140);
  const total = player.takeout.shift.idle_order_board_snapshot
    .reduce((sum, row) => sum + (row.total_orders || 0), 0);
  assert.equal(total, 140);
});

test("Takeout: 24/7 users use unlimited snapshot total", () => {
  const player = { coins: 100_000, takeout: createDefaultTakeoutState() };
  player.takeout.menu_recipe_ids = ["r1", "r2"];

  const open = startTakeoutShiftWithCoverage(player, {
    now: 0,
    boardOrderTotal: 140,
    unlimitedOrders: true,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
      r2: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] }
    },
    marketPrices: { i1: 1 },
    items: { i1: { base_price: 1 } }
  });

  assert.equal(open.ok, true);
  assert.ok(open.snapshotOrderTotal > TAKEOUT_SNAPSHOT_MAX_ORDERS);
  assert.ok(open.snapshotOrderTotal >= TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS);
  assert.ok(open.snapshotOrderTotal <= TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS);
  const total = player.takeout.shift.idle_order_board_snapshot
    .reduce((sum, row) => sum + (row.total_orders || 0), 0);
  assert.equal(total, open.snapshotOrderTotal);
});

test("Takeout: unlimited snapshot is deterministic per shift seed and can vary across shifts", () => {
  const openAt = (now) => {
    const player = { coins: 100_000, takeout: createDefaultTakeoutState() };
    player.takeout.menu_recipe_ids = ["r1", "r2", "r3"];
    const open = startTakeoutShiftWithCoverage(player, {
      now,
      boardOrderTotal: 200,
      unlimitedOrders: true,
      recipes: {
        r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
        r2: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
        r3: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] }
      },
      marketPrices: { i1: 1 },
      items: { i1: { base_price: 1 } }
    });
    assert.equal(open.ok, true);
    return open.snapshotOrderTotal;
  };

  const sameA = openAt(123_000);
  const sameB = openAt(123_000);
  const different = openAt(124_000);

  assert.equal(sameA, sameB);
  assert.ok(sameA >= TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS);
  assert.ok(sameA <= TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS);
  assert.ok(different >= TAKEOUT_SNAPSHOT_UNLIMITED_MIN_ORDERS);
  assert.ok(different <= TAKEOUT_SNAPSHOT_UNLIMITED_MAX_ORDERS);
  assert.notEqual(different, sameA);
});

test("Takeout: catch-up processes whole hours only and caps at 12", () => {
  const player = {
    coins: 1_000,
    takeout: createDefaultTakeoutState()
  };
  player.takeout.menu_recipe_ids = ["r1"];

  const open = startTakeoutShiftWithCoverage(player, {
    now: 0,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  assert.equal(open.ok, true);

  const halfHour = processTakeoutCatchup(player, {
    now: 30 * 60 * 1000,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  assert.equal(halfHour.processedHours, 0);

  const after13h = processTakeoutCatchup(player, {
    now: 13 * 60 * 60 * 1000,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  assert.equal(after13h.totalProcessedHours, 12);
  assert.equal(player.takeout.shift.last_processed_hour_index, 12);
  assert.equal(player.takeout.shift.status, "inactive");
});

test("Takeout: catch-up is deterministic for same snapshot and elapsed time", () => {
  const buildPlayer = () => {
    const p = { coins: 1_000, takeout: createDefaultTakeoutState() };
    p.takeout.menu_recipe_ids = ["r1", "r2"];
    const open = startTakeoutShiftWithCoverage(p, {
      now: 0,
      recipes: {
        r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
        r2: { tier: "rare", ingredients: [{ item_id: "i2", qty: 1 }] }
      },
      marketPrices: { i1: 5, i2: 9 },
      items: { i1: { base_price: 5 }, i2: { base_price: 9 } }
    });
    assert.equal(open.ok, true);
    return p;
  };

  const p1 = buildPlayer();
  const p2 = buildPlayer();

  const r1 = processTakeoutCatchup(p1, {
    now: 5 * 60 * 60 * 1000,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
      r2: { tier: "rare", ingredients: [{ item_id: "i2", qty: 1 }] }
    },
    marketPrices: { i1: 5, i2: 9 },
    items: { i1: { base_price: 5 }, i2: { base_price: 9 } }
  });
  const r2 = processTakeoutCatchup(p2, {
    now: 5 * 60 * 60 * 1000,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] },
      r2: { tier: "rare", ingredients: [{ item_id: "i2", qty: 1 }] }
    },
    marketPrices: { i1: 5, i2: 9 },
    items: { i1: { base_price: 5 }, i2: { base_price: 9 } }
  });

  assert.equal(r1.earned, r2.earned);
  assert.equal(p1.takeout.earned_unclaimed_coins, p2.takeout.earned_unclaimed_coins);
  assert.equal(p1.takeout.shift.last_processed_hour_index, p2.takeout.shift.last_processed_hour_index);
});

test("Takeout: catch-up does not double-process repeated calls", () => {
  const player = { coins: 1_000, takeout: createDefaultTakeoutState() };
  player.takeout.menu_recipe_ids = ["r1"];
  const open = startTakeoutShiftWithCoverage(player, {
    now: 0,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  assert.equal(open.ok, true);

  const first = processTakeoutCatchup(player, {
    now: 3 * 60 * 60 * 1000,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  const before = player.takeout.earned_unclaimed_coins;

  const second = processTakeoutCatchup(player, {
    now: 3 * 60 * 60 * 1000,
    recipes: { r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] } },
    marketPrices: { i1: 5 },
    items: { i1: { base_price: 5 } }
  });
  const after = player.takeout.earned_unclaimed_coins;

  assert.ok(first.processedHours > 0);
  assert.equal(second.processedHours, 0);
  assert.equal(after, before);
});

test("Takeout: catch-up decrements visible snapshot demand for served orders", () => {
  const player = {
    takeout: {
      menu_recipe_ids: ["r1"],
      shift: {
        status: "active",
        started_at: 0,
        ends_at: TAKEOUT_SHIFT_DURATION_MS,
        last_processed_hour_index: 0,
        last_tick_at: 0,
        operating_cost_paid_marker: "takeout_shift:0",
        operating_cost: 0,
        required_ingredients: { i1: 4 },
        covered_ingredients: { i1: 4 },
        idle_order_board_snapshot: [
          {
            recipe_id: "r1",
            visible_order_count: 4,
            total_orders: 4,
            hourly_order_counts: [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
          }
        ]
      },
      earned_unclaimed_coins: 0,
      updated_at: 0
    },
    lifetime: {
      bowls_served_total: 0,
      orders_served: 0
    }
  };

  const result = processTakeoutCatchup(player, {
    now: 2 * 60 * 60 * 1000,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] }
    },
    marketPrices: { i1: 1 },
    items: { i1: { base_price: 1 } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.processedHours, 2);
  assert.equal(player.takeout.shift.idle_order_board_snapshot[0].visible_order_count, 0);
  assert.equal(player.lifetime.orders_served, 4);
});

test("Takeout: catch-up respects manual serve reductions in visible order count", () => {
  const player = {
    takeout: {
      menu_recipe_ids: ["r1"],
      shift: {
        status: "active",
        started_at: 0,
        ends_at: TAKEOUT_SHIFT_DURATION_MS,
        last_processed_hour_index: 0,
        last_tick_at: 0,
        operating_cost_paid_marker: "takeout_shift:0",
        operating_cost: 0,
        required_ingredients: { i1: 4 },
        covered_ingredients: { i1: 4 },
        idle_order_board_snapshot: [
          {
            recipe_id: "r1",
            visible_order_count: 1,
            total_orders: 4,
            hourly_order_counts: [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
          }
        ]
      },
      earned_unclaimed_coins: 0,
      updated_at: 0
    },
    lifetime: {
      bowls_served_total: 0,
      orders_served: 0
    }
  };

  const result = processTakeoutCatchup(player, {
    now: 2 * 60 * 60 * 1000,
    recipes: {
      r1: { tier: "common", ingredients: [{ item_id: "i1", qty: 1 }] }
    },
    marketPrices: { i1: 1 },
    items: { i1: { base_price: 1 } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.processedHours, 2);
  assert.equal(player.takeout.shift.idle_order_board_snapshot[0].visible_order_count, 0);
  assert.equal(player.lifetime.orders_served, 1);
});
