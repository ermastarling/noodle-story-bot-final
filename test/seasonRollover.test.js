import { test } from "node:test";
import assert from "node:assert";

import { applySeasonRolloverReward } from "../src/game/seasonRollover.js";

test("season rollover converts out-of-season bowls into rewards", () => {
  const player = {
    coins: 100,
    rep: 20,
    sxp_total: 50,
    sxp_progress: 10,
    inv_bowls: {
      springBowl: { recipe_id: "cherry_blossom_udon", qty: 3 },
      currentSeasonBowl: { recipe_id: "summer_night_market_ramen", qty: 2 }
    },
    seasons: {
      last_seen: "spring",
      last_rewarded_from: null,
      last_rewarded_at: null
    },
    lifetime: {
      coins_earned: 0
    },
    shop_level: 1
  };

  const result = applySeasonRolloverReward(player, "summer", {
    recipes: {
      cherry_blossom_udon: { season: "spring" },
      summer_night_market_ramen: { season: "summer" }
    }
  });

  assert.ok(result);
  assert.strictEqual(result.bowlsCleared, 3);
  assert.strictEqual(result.cleared, 1);

  // Reward formula: coins = bowls*5 + 10, rep = ceil(bowls/3) + 10, sxp = bowls*2 + 10
  assert.strictEqual(player.coins, 125);
  assert.strictEqual(player.rep, 31);
  assert.strictEqual(player.sxp_total, 66);
  assert.strictEqual(player.sxp_progress, 26);

  // Out-of-season bowl cleared, current-season bowl retained
  assert.strictEqual(player.inv_bowls.springBowl, undefined);
  assert.strictEqual(player.inv_bowls.currentSeasonBowl.qty, 2);

  assert.strictEqual(player.seasons.last_seen, "summer");
  assert.strictEqual(player.seasons.last_rewarded_from, "spring");
  assert.ok(player.seasons.last_rewarded_at > 0);
  assert.ok(result.message.includes("Reward:"));
});

test("season rollover notice is one-time for converted bowls", () => {
  const player = {
    coins: 0,
    rep: 0,
    sxp_total: 0,
    sxp_progress: 0,
    inv_bowls: {
      autumnBowl: { recipe_id: "autumn_harvest_ramen", qty: 1 }
    },
    seasons: {
      last_seen: "autumn",
      last_rewarded_from: null,
      last_rewarded_at: null
    },
    lifetime: {
      coins_earned: 0
    },
    shop_level: 1
  };

  const first = applySeasonRolloverReward(player, "winter", {
    recipes: {
      autumn_harvest_ramen: { season: "autumn" }
    }
  });
  assert.ok(first);
  assert.strictEqual(first.bowlsCleared, 1);
  assert.strictEqual(player.inv_bowls.autumnBowl, undefined);

  // Simulates moving to another menu in the same new season: nothing left to convert, so no notice.
  const second = applySeasonRolloverReward(player, "winter", {
    recipes: {
      autumn_harvest_ramen: { season: "autumn" }
    }
  });
  assert.strictEqual(second, null);
});

test("season rollover does not reward non-seasonal bowls", () => {
  const player = {
    coins: 10,
    rep: 5,
    sxp_total: 3,
    sxp_progress: 3,
    inv_bowls: {
      normal: { recipe_id: "classic_shoyu", qty: 4 }
    },
    seasons: {
      last_seen: "spring",
      last_rewarded_from: null,
      last_rewarded_at: null
    },
    lifetime: {
      coins_earned: 0
    },
    shop_level: 1
  };

  const result = applySeasonRolloverReward(player, "summer", {
    recipes: {
      classic_shoyu: { season: null }
    }
  });

  assert.strictEqual(result, null);
  assert.strictEqual(player.coins, 10);
  assert.strictEqual(player.rep, 5);
  assert.strictEqual(player.sxp_total, 3);
  assert.strictEqual(player.inv_bowls.normal.qty, 4);
});
