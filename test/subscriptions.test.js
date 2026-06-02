import test from "node:test";
import assert from "node:assert/strict";

import {
  ORDER_ACCEPT_CAP_BASE,
  ORDER_ACCEPT_CAP_HOUSE_247,
  SUBSCRIPTION_PERKS,
  SUBSCRIPTION_MONTHLY_COIN_GRANT,
  HOUSE_247_VOTE_DURATION_MS,
  applySubscriptionEntitlementEvent,
  applyMonthlySubscriptionCoinGrant,
  createDefaultSubscriptionState,
  ensureSubscriptionState,
  grantHouse247VoteAccess,
  getOrderAcceptCap,
  hasUnlimitedMarketStock,
  hasActivePerk
} from "../src/game/subscriptions.js";

test("Subscriptions: default state contains both perks", () => {
  const state = createDefaultSubscriptionState();
  assert.equal(state.perks[SUBSCRIPTION_PERKS.HOUSE_247].active, false);
  assert.equal(state.perks[SUBSCRIPTION_PERKS.TAKEOUT_COUNTER].active, false);
});

test("Subscriptions: ensureSubscriptionState repairs malformed player state", () => {
  const player = { subscriptions: { perks: { house_247: { active: true } } } };
  ensureSubscriptionState(player);

  assert.equal(typeof player.subscriptions.perks[SUBSCRIPTION_PERKS.HOUSE_247], "object");
  assert.equal(typeof player.subscriptions.perks[SUBSCRIPTION_PERKS.TAKEOUT_COUNTER], "object");
});

test("Subscriptions: entitlement create activates perk and respects period end", () => {
  const player = {};
  const now = 1_700_000_000_000;
  const later = now + (30 * 24 * 60 * 60 * 1000);

  const result = applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    eventType: "ENTITLEMENT_CREATE",
    entitlementId: "ent_1",
    periodStartAt: now,
    periodEndAt: later,
    now
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(hasActivePerk(player, SUBSCRIPTION_PERKS.HOUSE_247, now + 1000), true);
  assert.equal(hasActivePerk(player, SUBSCRIPTION_PERKS.HOUSE_247, later + 1), false);
});

test("Subscriptions: entitlement update refreshes period timestamps", () => {
  const player = {};
  const now = 1_700_000_000_000;

  applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.TAKEOUT_COUNTER,
    eventType: "ENTITLEMENT_CREATE",
    entitlementId: "ent_2",
    periodStartAt: now,
    periodEndAt: now + 1000,
    now
  });

  const updated = applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.TAKEOUT_COUNTER,
    eventType: "ENTITLEMENT_UPDATE",
    entitlementId: "ent_2",
    periodStartAt: now + 1000,
    periodEndAt: now + 2000,
    now: now + 1000
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.state.period_end_at, now + 2000);
  assert.equal(hasActivePerk(player, SUBSCRIPTION_PERKS.TAKEOUT_COUNTER, now + 1500), true);
});

test("Subscriptions: entitlement delete deactivates perk", () => {
  const player = {};
  const now = 1_700_000_000_000;

  applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    eventType: "ENTITLEMENT_CREATE",
    entitlementId: "ent_3",
    periodEndAt: now + 10_000,
    now
  });

  const deleted = applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    eventType: "ENTITLEMENT_DELETE",
    entitlementId: "ent_3",
    now: now + 2_000
  });

  assert.equal(deleted.ok, true);
  assert.equal(deleted.active, false);
  assert.equal(hasActivePerk(player, SUBSCRIPTION_PERKS.HOUSE_247, now + 2_001), false);
});

test("Subscriptions: monthly coin grant is idempotent per billing period", () => {
  const player = { coins: 100, lifetime: { coins_earned: 50 } };
  const periodStart = 1_700_000_000_000;
  const periodEnd = periodStart + (30 * 24 * 60 * 60 * 1000);

  const first = applyMonthlySubscriptionCoinGrant(player, {
    perkId: SUBSCRIPTION_PERKS.TAKEOUT_COUNTER,
    periodStartAt: periodStart,
    periodEndAt: periodEnd,
    now: periodStart + 1000
  });
  assert.equal(first.ok, true);
  assert.equal(first.granted, true);
  assert.equal(first.amount, SUBSCRIPTION_MONTHLY_COIN_GRANT);
  assert.equal(player.coins, 100 + SUBSCRIPTION_MONTHLY_COIN_GRANT);
  assert.equal(player.lifetime.coins_earned, 50 + SUBSCRIPTION_MONTHLY_COIN_GRANT);

  const second = applyMonthlySubscriptionCoinGrant(player, {
    perkId: SUBSCRIPTION_PERKS.TAKEOUT_COUNTER,
    periodStartAt: periodStart,
    periodEndAt: periodEnd,
    now: periodStart + 2000
  });
  assert.equal(second.ok, true);
  assert.equal(second.granted, false);
  assert.equal(second.amount, 0);
  assert.equal(player.coins, 100 + SUBSCRIPTION_MONTHLY_COIN_GRANT);
});

test("Subscriptions: both perks grant monthly coins independently", () => {
  const player = { coins: 0, lifetime: { coins_earned: 0 } };
  const periodStart = 1_700_000_000_000;

  const houseGrant = applyMonthlySubscriptionCoinGrant(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    periodStartAt: periodStart,
    now: periodStart + 1000
  });
  const takeoutGrant = applyMonthlySubscriptionCoinGrant(player, {
    perkId: SUBSCRIPTION_PERKS.TAKEOUT_COUNTER,
    periodStartAt: periodStart,
    now: periodStart + 1000
  });

  assert.equal(houseGrant.granted, true);
  assert.equal(takeoutGrant.granted, true);
  assert.equal(player.coins, SUBSCRIPTION_MONTHLY_COIN_GRANT * 2);
  assert.equal(player.lifetime.coins_earned, SUBSCRIPTION_MONTHLY_COIN_GRANT * 2);
});

test("Subscriptions: vote-granted 24/7 House increases active order cap", () => {
  const player = {};
  const now = 1_700_000_000_000;

  assert.equal(getOrderAcceptCap(player, now), ORDER_ACCEPT_CAP_BASE);

  grantHouse247VoteAccess(player, { now });

  assert.equal(getOrderAcceptCap(player, now + 1), ORDER_ACCEPT_CAP_HOUSE_247);
  assert.equal(getOrderAcceptCap(player, now + HOUSE_247_VOTE_DURATION_MS + 1), ORDER_ACCEPT_CAP_BASE);
});

test("Subscriptions: vote-granted 24/7 House grants unlimited market stock behavior", () => {
  const player = {};
  const now = 1_700_000_000_000;

  assert.equal(hasUnlimitedMarketStock(player, now), false);

  grantHouse247VoteAccess(player, { now });

  assert.equal(hasUnlimitedMarketStock(player, now + 1), true);
  assert.equal(hasUnlimitedMarketStock(player, now + HOUSE_247_VOTE_DURATION_MS + 1), false);
});

test("Subscriptions: entitlement 24/7 perk unlocks market stock and order cap", () => {
  const player = {};
  const now = 1_700_000_000_000;

  applySubscriptionEntitlementEvent(player, {
    perkId: SUBSCRIPTION_PERKS.HOUSE_247,
    eventType: "ENTITLEMENT_CREATE",
    periodEndAt: now + HOUSE_247_VOTE_DURATION_MS,
    now
  });

  assert.equal(hasActivePerk(player, SUBSCRIPTION_PERKS.HOUSE_247, now + 1), true);
  assert.equal(hasUnlimitedMarketStock(player, now + 1), true);
  assert.equal(getOrderAcceptCap(player, now + 1), ORDER_ACCEPT_CAP_HOUSE_247);
});
