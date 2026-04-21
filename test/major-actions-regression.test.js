import { strict as assert } from "assert";
import { test } from "node:test";

import { computeServeRewards, applySxpLevelUp } from "../src/game/serve.js";
import {
  ensureDailyOrdersForPlayer,
  generateOrderPageForPlayer,
  findOrderByToken,
  markOrderConsumed
} from "../src/game/orders.js";
import {
  removeBowlFromInventory,
  addIngredientsToInventory,
  getTotalBowlCount
} from "../src/game/inventory.js";

function shortOrderId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
}

function simulateServeOnce({ player, orderId, bowlKey, content }) {
  const accepted = player.orders?.accepted ?? {};
  const orderEntry = accepted[orderId];
  if (!orderEntry) return { served: false, reason: "missing_order" };

  const recipe = content.recipes[orderEntry.order.recipe_id];
  const rewards = computeServeRewards({
    serverId: "srv-test",
    tier: orderEntry.order.tier,
    npcArchetype: orderEntry.order.npc_archetype,
    isLimitedTime: Boolean(orderEntry.order.is_limited_time),
    servedAtMs: Date.now(),
    acceptedAtMs: orderEntry.accepted_at ?? Date.now() - 10_000,
    speedWindowSeconds: orderEntry.order.speed_window_seconds ?? 120,
    player,
    recipe,
    content
  });

  const beforeAccepted = Object.keys(accepted).length;
  const beforeBowls = getTotalBowlCount(player);

  const removeResult = removeBowlFromInventory(player, bowlKey, 1);
  if (!removeResult.success) return { served: false, reason: "missing_bowl" };

  delete accepted[orderId];
  player.coins += rewards.coins;
  player.rep += rewards.rep;
  player.sxp_total += rewards.sxp;
  player.sxp_progress += rewards.sxp;
  applySxpLevelUp(player);

  return {
    served: true,
    rewards,
    beforeAccepted,
    afterAccepted: Object.keys(accepted).length,
    beforeBowls,
    afterBowls: getTotalBowlCount(player)
  };
}

const orderContent = {
  recipes: {
    classic_soy_ramen: { recipe_id: "classic_soy_ramen", tier: "common" },
    veggie_ramen: { recipe_id: "veggie_ramen", tier: "common" }
  },
  npcs: {
    traveler: { npc_id: "traveler", rarity: "common" }
  }
};

const orderSettings = {
  ORDERS_BASE_COUNT: 5,
  ORDER_TIER_WEIGHTS_BASE: { common: 1 },
  NPC_RARITY_WEIGHTS: { common: 1 },
  LIMITED_TIME_CHANCE: 0
};

test("Serve major action: exactly one accepted order and one bowl are consumed", () => {
  const player = {
    coins: 0,
    rep: 0,
    shop_level: 1,
    sxp_total: 0,
    sxp_progress: 0,
    buffs: {},
    daily: {},
    orders: {
      accepted: {
        ODR1: {
          accepted_at: Date.now() - 10_000,
          order: {
            order_id: "ODR1",
            recipe_id: "classic_soy_ramen",
            tier: "common",
            npc_archetype: "traveler",
            is_limited_time: false,
            speed_window_seconds: 120
          }
        },
        ODR2: {
          accepted_at: Date.now() - 10_000,
          order: {
            order_id: "ODR2",
            recipe_id: "classic_soy_ramen",
            tier: "common",
            npc_archetype: "traveler",
            is_limited_time: false,
            speed_window_seconds: 120
          }
        }
      }
    },
    inv_bowls: {
      bowl_a: { recipe_id: "classic_soy_ramen", tier: "common", quality: 85, qty: 2, cooked_at: Date.now() }
    }
  };

  const result = simulateServeOnce({
    player,
    orderId: "ODR1",
    bowlKey: "bowl_a",
    content: orderContent
  });

  assert.equal(result.served, true);
  assert.equal(result.beforeAccepted - result.afterAccepted, 1);
  assert.equal(result.beforeBowls - result.afterBowls, 1);
  assert.equal(Boolean(player.orders.accepted.ODR1), false);
  assert.equal(Boolean(player.orders.accepted.ODR2), true);
  assert.ok(result.rewards.coins > 0);
  assert.ok(result.rewards.sxp > 0);
  assert.ok(result.rewards.rep > 0);

  const secondServe = simulateServeOnce({
    player,
    orderId: "ODR1",
    bowlKey: "bowl_a",
    content: orderContent
  });
  assert.equal(secondServe.served, false);
  assert.equal(secondServe.reason, "missing_order");
});

function simulateAcceptBatch({ playerState, tokens, serverId = "s1", userId = "u1" }) {
  const accepted = playerState.orders.accepted ?? (playerState.orders.accepted = {});
  const cap = 5;
  const availableSlots = Math.max(0, cap - Object.keys(accepted).length);
  let acceptedNow = 0;
  const acceptedIds = [];

  for (const tok of tokens) {
    if (acceptedNow >= availableSlots) break;

    const order = findOrderByToken({
      playerState,
      settings: orderSettings,
      content: orderContent,
      activeSeason: "spring",
      serverId,
      userId,
      token: tok
    });

    if (!order) continue;
    if (accepted[order.order_id]) continue;

    accepted[order.order_id] = {
      accepted_at: Date.now(),
      order: {
        order_index: order.order_index,
        order_id: order.order_id,
        recipe_id: order.recipe_id,
        tier: order.tier,
        npc_archetype: order.npc_archetype,
        is_limited_time: order.is_limited_time,
        speed_window_seconds: order.speed_window_seconds
      }
    };
    markOrderConsumed(playerState, order.order_index);
    acceptedIds.push(order.order_id);
    acceptedNow += 1;
  }

  return { acceptedNow, acceptedIds, acceptedCount: Object.keys(accepted).length };
}

test("Accept major action: mixed token batch handles invalid/duplicate/cap edge cases", () => {
  const playerState = {
    shop_level: 1,
    rep: 0,
    coins: 0,
    known_recipes: ["classic_soy_ramen", "veggie_ramen"],
    orders: {
      accepted: {
        pre1: { order: { recipe_id: "classic_soy_ramen" } },
        pre2: { order: { recipe_id: "classic_soy_ramen" } },
        pre3: { order: { recipe_id: "classic_soy_ramen" } },
        pre4: { order: { recipe_id: "classic_soy_ramen" } }
      }
    },
    orders_consumed_indices: []
  };

  ensureDailyOrdersForPlayer(playerState, orderSettings, orderContent, "spring", "s1", "u1");

  const page = generateOrderPageForPlayer({
    playerState,
    settings: orderSettings,
    content: orderContent,
    activeSeason: "spring",
    serverId: "s1",
    userId: "u1",
    page: 0,
    pageSize: 5
  });

  const first = page.orders[0];
  const second = page.orders[1] ?? page.orders[0];

  // Pretend first is already accepted by this batch scope to test duplicate handling.
  playerState.orders.accepted[first.order_id] = {
    accepted_at: Date.now(),
    order: {
      order_index: first.order_index,
      order_id: first.order_id,
      recipe_id: first.recipe_id,
      tier: first.tier,
      npc_archetype: first.npc_archetype,
      is_limited_time: first.is_limited_time,
      speed_window_seconds: first.speed_window_seconds
    }
  };

  const tokens = [
    "INVALID_TOKEN",
    shortOrderId(first.order_id),
    shortOrderId(second.order_id),
    shortOrderId(second.order_id)
  ];

  const result = simulateAcceptBatch({ playerState, tokens, serverId: "s1", userId: "u1" });

  // Cap is 5 and we already had 5 accepted after first was pre-added, so no new accepts.
  assert.equal(result.acceptedNow, 0);
  assert.equal(result.acceptedCount, 5);

  // Remove one preload and try again to exercise single-slot acceptance behavior.
  delete playerState.orders.accepted.pre4;
  const secondTry = simulateAcceptBatch({ playerState, tokens, serverId: "s1", userId: "u1" });

  assert.equal(secondTry.acceptedNow, 1);
  assert.equal(secondTry.acceptedIds.length, 1);
  assert.equal(secondTry.acceptedCount, 5);
  assert.equal(secondTry.acceptedIds[0], second.order_id);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applySingleBuys({ player, stock, prices, wanted }) {
  for (const [itemId, qty] of Object.entries(wanted)) {
    const unit = prices[itemId] ?? 0;
    if (unit <= 0) return { ok: false, reason: "bad_price" };
    if ((stock[itemId] ?? 0) < qty) return { ok: false, reason: "stock" };
    const cost = unit * qty;
    if ((player.coins ?? 0) < cost) return { ok: false, reason: "coins" };

    const add = addIngredientsToInventory(player, { [itemId]: qty }, "block");
    if (!add.success) return { ok: false, reason: "capacity" };

    player.coins -= cost;
    stock[itemId] -= qty;
  }
  return { ok: true };
}

function applyBatchBuy({ player, stock, prices, wanted }) {
  let total = 0;
  for (const [itemId, qty] of Object.entries(wanted)) {
    const unit = prices[itemId] ?? 0;
    if (unit <= 0) return { ok: false, reason: "bad_price" };
    if ((stock[itemId] ?? 0) < qty) return { ok: false, reason: "stock" };
    total += unit * qty;
  }
  if ((player.coins ?? 0) < total) return { ok: false, reason: "coins" };

  const add = addIngredientsToInventory(player, wanted, "block");
  if (!add.success) return { ok: false, reason: "capacity" };

  player.coins -= total;
  for (const [itemId, qty] of Object.entries(wanted)) {
    stock[itemId] -= qty;
  }
  return { ok: true };
}

test("Buy major action: single-buy and multi-buy produce consistent final state", () => {
  const wanted = { broth_soy: 3, noodles_wheat: 2 };
  const prices = { broth_soy: 10, noodles_wheat: 8 };
  const stockA = { broth_soy: 10, noodles_wheat: 10 };
  const stockB = clone(stockA);
  const playerA = { coins: 500, upgrades: { u_pantry: 0 }, inv_ingredients: {} };
  const playerB = clone(playerA);

  const oneByOne = applySingleBuys({ player: playerA, stock: stockA, prices, wanted });
  const batch = applyBatchBuy({ player: playerB, stock: stockB, prices, wanted });

  assert.equal(oneByOne.ok, true);
  assert.equal(batch.ok, true);
  assert.deepEqual(playerA.inv_ingredients, playerB.inv_ingredients);
  assert.equal(playerA.coins, playerB.coins);
  assert.deepEqual(stockA, stockB);
});

test("Buy major action: batch buy is atomic on stock failure", () => {
  const wanted = { broth_soy: 3, noodles_wheat: 2 };
  const prices = { broth_soy: 10, noodles_wheat: 8 };
  const stock = { broth_soy: 10, noodles_wheat: 1 }; // insufficient for batch
  const player = { coins: 500, upgrades: { u_pantry: 0 }, inv_ingredients: {} };
  const beforePlayer = clone(player);
  const beforeStock = clone(stock);

  const result = applyBatchBuy({ player, stock, prices, wanted });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "stock");
  assert.deepEqual(player, beforePlayer);
  assert.deepEqual(stock, beforeStock);
});
