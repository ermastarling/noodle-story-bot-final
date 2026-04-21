import { strict as assert } from "assert";
import { test } from "node:test";

import { getCookBatchOutput, rollCookBatchOutcome } from "../src/game/cooking.js";

function makeSeqRng(values, fallback = 0.99) {
  let i = 0;
  return () => {
    if (i < values.length) {
      const v = values[i];
      i += 1;
      return v;
    }
    return fallback;
  };
}

function simulateCookCore({ player, recipe, qtyToCook, effects = {}, rng }) {
  const batchOutput = getCookBatchOutput(qtyToCook, player, effects);
  const ingredientsToUse = [];
  const consumedByItem = {};

  for (const ing of recipe.ingredients || []) {
    const need = (ing.qty ?? 0) * qtyToCook;
    if (need <= 0) continue;

    const have = player.inv_ingredients?.[ing.item_id] ?? 0;
    if (ing.optional) {
      if (have >= need) ingredientsToUse.push({ ...ing, need });
      continue;
    }

    if (have < need) {
      return { ok: false, reason: "missing_required", missingItem: ing.item_id, need, have };
    }
    ingredientsToUse.push({ ...ing, need });
  }

  for (const ing of ingredientsToUse) {
    const consume = Math.max(0, ing.need);
    player.inv_ingredients[ing.item_id] -= consume;
    consumedByItem[ing.item_id] = (consumedByItem[ing.item_id] ?? 0) + consume;
  }

  const outcome = rollCookBatchOutcome({
    quantity: batchOutput,
    tier: recipe.tier,
    player,
    effects,
    rng,
    blessing: null
  });

  const qualityCounts = outcome.qualityCounts ?? {};
  const qualityBucketTotal = Object.values(qualityCounts).reduce((sum, count) => sum + (count || 0), 0);
  const successBucketTotal = Object.entries(qualityCounts)
    .filter(([quality]) => quality !== "salvage")
    .reduce((sum, [, count]) => sum + (count || 0), 0);

  return {
    ok: true,
    batchOutput,
    consumedByItem,
    outcome,
    qualityBucketTotal,
    successBucketTotal
  };
}

test("Cook invariants: optional ingredients are skipped when short and required ingredients are consumed", () => {
  const player = {
    inv_ingredients: {
      noodles_wheat: 10,
      broth_soy: 6,
      scallions: 1
    },
    upgrades: { u_prep: 0 }
  };

  const recipe = {
    tier: "common",
    ingredients: [
      { item_id: "noodles_wheat", qty: 2 },
      { item_id: "broth_soy", qty: 1 },
      { item_id: "scallions", qty: 2, optional: true }
    ]
  };

  const result = simulateCookCore({
    player,
    recipe,
    qtyToCook: 2,
    rng: makeSeqRng([0.9, 0.9, 0.9, 0.9])
  });

  assert.equal(result.ok, true);
  assert.equal(result.batchOutput, 2);
  assert.equal(result.consumedByItem.noodles_wheat, 4);
  assert.equal(result.consumedByItem.broth_soy, 2);
  assert.equal(result.consumedByItem.scallions, undefined);
  assert.equal(player.inv_ingredients.noodles_wheat, 6);
  assert.equal(player.inv_ingredients.broth_soy, 4);
  assert.equal(player.inv_ingredients.scallions, 1);
});

test("Cook invariants: optional ingredients are consumed when present", () => {
  const player = {
    inv_ingredients: {
      noodles_wheat: 12,
      broth_soy: 10,
      scallions: 8
    },
    upgrades: { u_prep: 0 }
  };

  const recipe = {
    tier: "common",
    ingredients: [
      { item_id: "noodles_wheat", qty: 2 },
      { item_id: "broth_soy", qty: 1 },
      { item_id: "scallions", qty: 1, optional: true }
    ]
  };

  const result = simulateCookCore({
    player,
    recipe,
    qtyToCook: 3,
    rng: makeSeqRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
  });

  assert.equal(result.ok, true);
  assert.equal(result.consumedByItem.noodles_wheat, 6);
  assert.equal(result.consumedByItem.broth_soy, 3);
  assert.equal(result.consumedByItem.scallions, 3);
  assert.equal(player.inv_ingredients.scallions, 5);
});

test("Cook invariants: quality buckets and salvage totals stay consistent with batch output and failures", () => {
  const player = {
    inv_ingredients: {
      noodles_wheat: 40,
      broth_soy: 40
    },
    upgrades: { u_prep: 0 }
  };

  const recipe = {
    tier: "common",
    ingredients: [
      { item_id: "noodles_wheat", qty: 1 },
      { item_id: "broth_soy", qty: 1 }
    ]
  };

  const result = simulateCookCore({
    player,
    recipe,
    qtyToCook: 8,
    rng: makeSeqRng([
      0.01, 0.02, 0.90, 0.90, 0.03, 0.90, 0.04, 0.90,
      0.50, 0.30, 0.70, 0.80
    ])
  });

  assert.equal(result.ok, true);
  assert.equal(result.outcome.success + result.outcome.failed, result.batchOutput);
  assert.equal(result.successBucketTotal, result.outcome.success);
  assert.equal(result.qualityBucketTotal, result.outcome.success + result.outcome.salvage);
  assert.ok(result.outcome.failed >= 1);
  assert.ok(result.outcome.salvage >= 1);
  assert.equal(result.consumedByItem.noodles_wheat, 8);
  assert.equal(result.consumedByItem.broth_soy, 8);
});
