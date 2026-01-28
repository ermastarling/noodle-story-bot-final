import { COIN_BASE, SXP_BASE, REP_BASE, sxpToNext } from "../constants.js";
import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";
import { getFailStreakBonuses, applyRepFloorBonus } from "./resilience.js";

export function computeServeRewards({ serverId, tier, npcArchetype, isLimitedTime, servedAtMs, acceptedAtMs, speedWindowSeconds, player }) {
  const dayKey = dayKeyUTC(servedAtMs);
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"serve", serverId, dayKey });

  const coinsBase = Math.floor(COIN_BASE[tier] * rngBetween(rng, 0.90, 1.10));
  const mSpeed = (isLimitedTime && speedWindowSeconds && acceptedAtMs)
    ? (1 + 0.20 * Math.max(0, Math.min(1, (speedWindowSeconds*1000 - (servedAtMs - acceptedAtMs)) / (speedWindowSeconds*1000))))
    : 1;

  const mEvent = 1;
  const mCourier = (npcArchetype === "rain_soaked_courier") ? 1.25 : 1;
  const mBard = (npcArchetype === "traveling_bard") ? 1.10 : 1;

  const coins = Math.floor(coinsBase * mSpeed * mEvent * mCourier * mBard);
  const sxp = Math.floor(SXP_BASE[tier]);
  let rep = REP_BASE[tier];

  if (npcArchetype === "market_inspector") rep += 10;
  if (npcArchetype === "sleepy_traveler") rep += 5;

  // B7: Apply reputation floor bonus if eligible
  if (player) {
    const repBonus = applyRepFloorBonus(player);
    rep += repBonus;
  }

  return { coins, sxp, rep, mSpeed };
}

export function applySxpLevelUp(player) {
  let leveled = 0;
  while (player.sxp_progress >= sxpToNext(player.shop_level)) {
    player.sxp_progress -= sxpToNext(player.shop_level);
    player.shop_level += 1;
    leveled += 1;
  }
  return leveled;
}
