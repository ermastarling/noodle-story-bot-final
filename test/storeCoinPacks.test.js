import test from "node:test";
import assert from "node:assert/strict";

import {
  getStoreCoinPack,
  resolveStoreCoinPackIdFromSku,
  resolveStoreCoinPackIdFromMetadata,
  grantStoreCoinPack
} from "../src/game/storeCoinPacks.js";

test("Store coin packs: catalog exposes expected packs", () => {
  const small = getStoreCoinPack("coin_pack_099");
  const medium = getStoreCoinPack("coin_pack_199");
  const large = getStoreCoinPack("coin_pack_499");

  assert.equal(small?.coins, 10_000);
  assert.equal(medium?.coins, 25_000);
  assert.equal(large?.coins, 100_000);
});

test("Store coin packs: grant credits coins and lifetime earnings", () => {
  const player = { coins: 500, lifetime: { coins_earned: 1_500 } };
  const result = grantStoreCoinPack({ player, coinPackId: "coin_pack_199" });

  assert.equal(result.ok, true);
  assert.equal(result.coinsGranted, 25_000);
  assert.equal(player.coins, 25_500);
  assert.equal(player.lifetime.coins_earned, 26_500);
});

test("Store coin packs: unknown pack returns an error", () => {
  const player = { coins: 0, lifetime: { coins_earned: 0 } };
  const result = grantStoreCoinPack({ player, coinPackId: "missing_pack" });

  assert.equal(result.ok, false);
  assert.match(result.reason, /not found/i);
});

test("Store coin packs: default Discord SKU mapping resolves all configured packs", () => {
  assert.equal(resolveStoreCoinPackIdFromSku("1511191985644507336"), "coin_pack_099");
  assert.equal(resolveStoreCoinPackIdFromSku("1511192707119321109"), "coin_pack_199");
  assert.equal(resolveStoreCoinPackIdFromSku("1511192852288376884"), "coin_pack_499");
});

test("Store coin packs: metadata sku_id resolves through SKU mapping", () => {
  assert.equal(
    resolveStoreCoinPackIdFromMetadata({ sku_id: "1511191985644507336" }),
    "coin_pack_099"
  );
  assert.equal(
    resolveStoreCoinPackIdFromMetadata({ sku: "1511192707119321109" }),
    "coin_pack_199"
  );
});
