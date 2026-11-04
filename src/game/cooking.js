import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { weightedPick } from "../util/rng.js";
import { getFailStreakBonuses } from "./resilience.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedRules = null;

export function loadCookingRules() {
  if (cachedRules) return cachedRules;
  const rulesPath = path.join(__dirname, "..", "..", "content", "cooking.rules.json");
  cachedRules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
  return cachedRules;
}

export function getCookBatchOutput(quantity, player, effects = null) {
  const rules = loadCookingRules();
  const prepBonus = Math.max(0, Number(effects?.prep_batch_bonus) || 0);
  let bonus = Math.floor(prepBonus);

  if (!bonus) {
    const divisor = Math.max(1, Number(rules.batch?.prep_bonus_divisor) || 4);
    const prep = Math.max(0, Number(player?.upgrades?.u_prep) || 0);
    bonus = Math.floor(prep / divisor);
  }
  return quantity + bonus;
}

export function getCookFailChance(tier, player, effects) {
  const rules = loadCookingRules();
  const base = Number(rules.failure?.fail_chance_by_tier?.[tier]) ?? 0.06;
  const bonuses = getFailStreakBonuses(player);
  const rareEpicReduction = (tier === "rare" || tier === "epic")
    ? Math.max(0, Number(effects?.rare_epic_fail_reduction) || 0)
    : 0;
  const reduction = (bonuses?.cook_fail_reduction ?? 0) + rareEpicReduction;
  const min = 0.01;
  const max = 0.25;
  return Math.min(max, Math.max(min, base - reduction));
}

function getCookQualityBoost(effects, blessing, tier) {
  const qualityBonus = Math.max(0, Number(effects?.order_quality_bonus) || 0);
  const rareEpicBonus = (tier === "rare" || tier === "epic")
    ? Math.max(0, Number(effects?.rare_epic_quality_bonus) || 0)
    : 0;
  const blessingBonus = blessing?.type === "quality_shift" ? 0.08 : 0;
  return qualityBonus + rareEpicBonus + blessingBonus;
}

function getCookEffectQualityBoost(effects, tier) {
  return getCookQualityBoost(effects, null, tier);
}

// Minigame cooks fix success/quality from performance, so staff quality and fail-reduction bonuses are applied on top.
export function applyStaffBonusesToMinigameOutcome(outcome, { tier = null, effects, rng, blessing = null } = {}) {
  const qualityCounts = { ...(outcome?.qualityCounts ?? {}) };
  let success = outcome?.success ?? 0;
  let failed = outcome?.failed ?? 0;
  let failRescued = 0;
  let qualityBoosted = 0;

  const failReduction = (tier === "rare" || tier === "epic")
    ? Math.max(0, Number(effects?.rare_epic_fail_reduction) || 0)
    : 0;
  if (failReduction > 0) {
    let rescued = 0;
    for (let i = 0; i < failed; i += 1) {
      if (rng() < failReduction) rescued += 1;
    }
    if (rescued > 0) {
      failed -= rescued;
      success += rescued;
      failRescued = rescued;
      qualityCounts.standard = (qualityCounts.standard ?? 0) + rescued;
    }
  }

  const boost = getCookQualityBoost(effects, blessing, tier);
  if (boost > 0) {
    const baselineBoost = getCookQualityBoost(null, blessing, tier);
    const upgrade = (from, to, scale) => {
      let moved = 0;
      for (let i = 0; i < (qualityCounts[from] ?? 0); i += 1) {
        const roll = rng();
        if (roll < boost * scale) {
          moved += 1;
          if (roll >= baselineBoost * scale) qualityBoosted += 1;
        }
      }
      if (moved > 0) {
        qualityCounts[from] -= moved;
        qualityCounts[to] = (qualityCounts[to] ?? 0) + moved;
      }
    };
    upgrade("good", "excellent", 0.5);
    upgrade("standard", "good", 1);
  }

  return { ...outcome, success, failed, qualityCounts, failRescued, qualityBoosted };
}

const QUALITY_RANK = { salvage: 0, standard: 1, good: 2, excellent: 3 };

function buildQualityWeights(rules, boost) {
  const weights = { ...(rules.quality?.weights || {}) };
  weights.good = Math.max(0, (weights.good ?? 0) + boost * 0.4);
  weights.excellent = Math.max(0, (weights.excellent ?? 0) + boost * 0.2);
  weights.standard = Math.max(0, (weights.standard ?? 0) - boost * 0.6);
  return weights;
}

// Uses a single rng draw; `boosted` compares against the same draw without staff/upgrade quality bonuses.
export function rollCookQualityDetailed(rng, player, effects, blessing, tier = null) {
  const rules = loadCookingRules();
  const floor = getFailStreakBonuses(player)?.quality_floor;
  const applyFloor = (pick) => (floor && pick === "salvage" ? floor : pick);

  const roll = rng();
  const pick = applyFloor(weightedPick(() => roll, buildQualityWeights(rules, getCookQualityBoost(effects, blessing, tier))));
  const effectBoost = getCookEffectQualityBoost(effects, tier);
  if (effectBoost <= 0) return { quality: pick, boosted: false };

  const baseline = applyFloor(weightedPick(() => roll, buildQualityWeights(rules, getCookQualityBoost(null, blessing, tier))));
  return { quality: pick, boosted: (QUALITY_RANK[pick] ?? 0) > (QUALITY_RANK[baseline] ?? 0) };
}

export function rollCookQuality(rng, player, effects, blessing, tier = null) {
  return rollCookQualityDetailed(rng, player, effects, blessing, tier).quality;
}

export function getQualityMultiplier(quality) {
  const rules = loadCookingRules();
  const mult = rules.quality?.multipliers?.[quality];
  return Number.isFinite(mult) ? mult : 1;
}

export function getFailBowlYield() {
  const rules = loadCookingRules();
  return Math.max(0, Math.min(1, Number(rules.failure?.fail_bowl_yield) || 0.25));
}

export function rollCookBatchOutcome({ quantity, tier, player, effects, rng, blessing, disableFailures = false }) {
  const total = Math.max(0, Number(quantity) || 0);
  if (total <= 0) {
    return { success: 0, failed: 0, salvage: 0, qualityCounts: {} };
  }

  const failChance = getCookFailChance(tier, player, effects);
  const failChanceWithoutStaff = getCookFailChance(tier, player, { ...effects, rare_epic_fail_reduction: 0 });
  let failed = 0;
  let failRescued = 0;
  for (let i = 0; i < total; i += 1) {
    const roll = rng();
    if (disableFailures) continue;
    if (roll < failChance) failed += 1;
    else if (roll < failChanceWithoutStaff) failRescued += 1;
  }

  const success = Math.max(0, total - failed);
  const salvage = Math.floor(failed * getFailBowlYield());
  const qualityCounts = {};
  let qualityBoosted = 0;

  for (let i = 0; i < success; i += 1) {
    const { quality: q, boosted } = rollCookQualityDetailed(rng, player, effects, blessing, tier);
    qualityCounts[q] = (qualityCounts[q] ?? 0) + 1;
    if (boosted) qualityBoosted += 1;
  }

  if (salvage > 0) {
    qualityCounts.salvage = (qualityCounts.salvage ?? 0) + salvage;
  }

  return { success, failed, salvage, qualityCounts, failRescued, qualityBoosted };
}
