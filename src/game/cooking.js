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
  const reduction = bonuses?.cook_fail_reduction ?? 0;
  const min = 0.01;
  const max = 0.25;
  return Math.min(max, Math.max(min, base - reduction));
}

export function rollCookQuality(rng, player, effects, blessing) {
  const rules = loadCookingRules();
  const weights = { ...(rules.quality?.weights || {}) };

  const qualityBonus = Math.max(0, Number(effects?.order_quality_bonus) || 0);
  const blessingBonus = blessing?.type === "quality_shift" ? 0.08 : 0;
  const boost = qualityBonus + blessingBonus;

  weights.good = Math.max(0, (weights.good ?? 0) + boost * 0.4);
  weights.excellent = Math.max(0, (weights.excellent ?? 0) + boost * 0.2);
  weights.standard = Math.max(0, (weights.standard ?? 0) - boost * 0.6);

  const pick = weightedPick(rng, weights);
  const floor = getFailStreakBonuses(player)?.quality_floor;

  if (floor && pick === "salvage") {
    return floor;
  }
  return pick;
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

export function rollCookBatchOutcome({ quantity, tier, player, effects, rng, blessing }) {
  const total = Math.max(0, Number(quantity) || 0);
  if (total <= 0) {
    return { success: 0, failed: 0, salvage: 0, qualityCounts: {} };
  }

  const failChance = getCookFailChance(tier, player, effects);
  let failed = 0;
  for (let i = 0; i < total; i += 1) {
    if (rng() < failChance) failed += 1;
  }

  const success = Math.max(0, total - failed);
  const salvage = Math.floor(failed * getFailBowlYield());
  const qualityCounts = {};

  for (let i = 0; i < success; i += 1) {
    const q = rollCookQuality(rng, player, effects, blessing);
    qualityCounts[q] = (qualityCounts[q] ?? 0) + 1;
  }

  if (salvage > 0) {
    qualityCounts.salvage = (qualityCounts.salvage ?? 0) + salvage;
  }

  return { success, failed, salvage, qualityCounts };
}
