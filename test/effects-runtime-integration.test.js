import test from "node:test";
import assert from "node:assert/strict";

import { computeServeRewards } from "../src/game/serve.js";
import { loadContentBundle, loadStaffContent, loadUpgradesContent } from "../src/content/index.js";
import { calculateCombinedEffects, applyCooldownReduction } from "../src/game/upgrades.js";
import { calculateStaffEffects } from "../src/game/staff.js";
import { grantBlessing } from "../src/game/social.js";
import { rollCookQuality } from "../src/game/cooking.js";

const content = loadContentBundle(1);
const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();

function makePlayer({ upgrades = {}, staff_levels = {}, social = {} } = {}) {
  return {
    upgrades,
    staff_levels,
    social,
    buffs: {},
    daily: {}
  };
}

test("Effects runtime: upgrades + staff increase serve rewards", () => {
  const now = Date.UTC(2026, 6, 4, 12, 0, 0);
  const recipe = content.recipes.classic_soy_ramen;

  const basePlayer = makePlayer();
  const boostedPlayer = makePlayer({
    upgrades: {
      u_lantern: 10,
      u_hospitality: 10,
      u_manuals: 5
    },
    staff_levels: {
      host: 3,
      storyteller: 2,
      server: 2
    }
  });

  const baseEffects = calculateCombinedEffects(basePlayer, upgradesContent, staffContent, calculateStaffEffects);
  const boostedEffects = calculateCombinedEffects(boostedPlayer, upgradesContent, staffContent, calculateStaffEffects);

  const baseRewards = computeServeRewards({
    serverId: "guild-1",
    tier: "common",
    npcArchetype: null,
    isLimitedTime: false,
    servedAtMs: now,
    acceptedAtMs: now,
    speedWindowSeconds: 180,
    player: basePlayer,
    recipe,
    content,
    effects: baseEffects,
    eventEffects: null
  });

  const boostedRewards = computeServeRewards({
    serverId: "guild-1",
    tier: "common",
    npcArchetype: null,
    isLimitedTime: false,
    servedAtMs: now,
    acceptedAtMs: now,
    speedWindowSeconds: 180,
    player: boostedPlayer,
    recipe,
    content,
    effects: boostedEffects,
    eventEffects: null
  });

  assert.ok(boostedRewards.coins > baseRewards.coins, "Expected coins to increase from upgrade/staff effects");
  assert.ok(boostedRewards.rep > baseRewards.rep, "Expected REP to increase from upgrade/staff effects");
});

test("Effects runtime: staff cooldown reduction changes effective cooldown", () => {
  const player = makePlayer({
    staff_levels: {
      manager: 2
    }
  });
  const effects = calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);
  const baseCooldown = 180000;
  const reduced = applyCooldownReduction(baseCooldown, effects);

  assert.equal(effects.cooldown_reduction, 0.2);
  assert.equal(reduced, 144000);
});

test("Blessings runtime: coin and REP blessings apply to serve rewards", () => {
  const now = Date.UTC(2026, 6, 4, 12, 0, 0);
  const recipe = content.recipes.classic_soy_ramen;

  const basePlayer = makePlayer();
  const baseEffects = calculateCombinedEffects(basePlayer, upgradesContent, staffContent, calculateStaffEffects);
  const baseRewards = computeServeRewards({
    serverId: "guild-2",
    tier: "common",
    npcArchetype: null,
    isLimitedTime: false,
    servedAtMs: now,
    acceptedAtMs: now,
    speedWindowSeconds: 180,
    player: basePlayer,
    recipe,
    content,
    effects: baseEffects,
    eventEffects: null
  });

  const coinBlessedPlayer = makePlayer({ social: {} });
  grantBlessing(coinBlessedPlayer, "host-1", "coin_bonus");
  const coinBlessedRewards = computeServeRewards({
    serverId: "guild-2",
    tier: "common",
    npcArchetype: null,
    isLimitedTime: false,
    servedAtMs: now,
    acceptedAtMs: now,
    speedWindowSeconds: 180,
    player: coinBlessedPlayer,
    recipe,
    content,
    effects: baseEffects,
    eventEffects: null
  });

  const repBlessedPlayer = makePlayer({ social: {} });
  grantBlessing(repBlessedPlayer, "host-1", "rep_bonus");
  const repBlessedRewards = computeServeRewards({
    serverId: "guild-2",
    tier: "common",
    npcArchetype: null,
    isLimitedTime: false,
    servedAtMs: now,
    acceptedAtMs: now,
    speedWindowSeconds: 180,
    player: repBlessedPlayer,
    recipe,
    content,
    effects: baseEffects,
    eventEffects: null
  });

  assert.equal(coinBlessedRewards.coins - baseRewards.coins, 10);
  assert.equal(repBlessedRewards.rep - baseRewards.rep, 5);
});

test("Blessings runtime: quality shift changes cook quality at threshold", () => {
  const rngAtThreshold = () => 0.63;
  const player = makePlayer();
  const effects = {};

  const withoutBlessing = rollCookQuality(rngAtThreshold, player, effects, null, "common");
  const withQualityBlessing = rollCookQuality(
    rngAtThreshold,
    player,
    effects,
    { type: "quality_shift" },
    "common"
  );

  assert.equal(withoutBlessing, "standard");
  assert.equal(withQualityBlessing, "good");
}
);