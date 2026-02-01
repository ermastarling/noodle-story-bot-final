import { COIN_BASE, SXP_BASE, REP_BASE, sxpToNext } from "../constants.js";
import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { getFailStreakBonuses, applyRepFloorBonus } from "./resilience.js";

export function computeServeRewards({ serverId, tier, npcArchetype, isLimitedTime, servedAtMs, acceptedAtMs, speedWindowSeconds, player, recipe, content }) {
  const dayKey = dayKeyUTC(servedAtMs);
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"serve", serverId, dayKey });

  // Ensure player.buffs exists
  if (!player.buffs) player.buffs = {};

  const coinsBase = Math.floor(COIN_BASE[tier] * rngBetween(rng, 0.90, 1.10));
  let mSpeed = (isLimitedTime && speedWindowSeconds && acceptedAtMs)
    ? (1 + 0.20 * Math.max(0, Math.min(1, (speedWindowSeconds*1000 - (servedAtMs - acceptedAtMs)) / (speedWindowSeconds*1000))))
    : 1;

  // Night Market Regular: doubles speed bonus
  if (npcArchetype === "night_market_regular" && mSpeed > 1) {
    mSpeed = 1 + (mSpeed - 1) * 2.0;
  }

  const mEvent = 1;
  const mCourier = (npcArchetype === "rain_soaked_courier") ? 1.25 : 1;
  const mBard = (npcArchetype === "traveling_bard") ? 1.10 : 1;
  // Festival-Goer: +25% coins during events (not implemented yet, mEvent placeholder)
  const mFestival = (npcArchetype === "festival_goer") ? 1.25 : 1;

  const coins = Math.floor(coinsBase * mSpeed * mEvent * mCourier * mBard * mFestival);
  
  let sxp = Math.floor(SXP_BASE[tier]);
  
  // Forest Spirit: +10% SXP if recipe contains rare topping
  if (npcArchetype === "forest_spirit" && recipe && content) {
    const hasRareTopping = (recipe.ingredients || []).some(ing => {
      const item = content.items?.[ing.item_id];
      return item && item.tier === "rare" && item.category === "topping";
    });
    if (hasRareTopping) {
      sxp = Math.floor(sxp * 1.10);
    }
  }
  
  // Retired Captain: repeated recipe grants +10 SXP
  if (npcArchetype === "retired_captain" && player && recipe) {
    if (player.buffs.last_recipe_served === recipe.recipe_id) {
      sxp += 10;
    }
  }
  
  let rep = REP_BASE[tier];

  // Market Inspector: Rare+ grants +10 REP
  if (npcArchetype === "market_inspector" && (tier === "rare" || tier === "epic" || tier === "seasonal")) {
    rep += 10;
  }
  
  // Sleepy Traveler: first serve of day grants +5 REP
  if (npcArchetype === "sleepy_traveler") {
    const isFirstServeToday = !player?.daily?.last_serve_day || player.daily.last_serve_day !== dayKey;
    if (isFirstServeToday) {
      rep += 5;
    }
  }
  
  // Moonlit Spirit: +15 REP on Epic tier
  if (npcArchetype === "moonlit_spirit" && tier === "epic") {
    rep += 15;
  }

  // B7: Apply reputation floor bonus if eligible
  if (player) {
    const repBonus = applyRepFloorBonus(player);
    rep += repBonus;
  }
  
  // Hearth Grandparent: +2 REP aura for 15 minutes after serve
  let repAuraGranted = false;
  if (npcArchetype === "hearth_grandparent") {
    player.buffs.rep_aura_expires_at = nowTs() + 15 * 60 * 1000;
    repAuraGranted = true;
  }
  
  // Apply active REP aura if present
  if (player?.buffs?.rep_aura_expires_at && nowTs() < player.buffs.rep_aura_expires_at) {
    rep += 2;
  }

  return { coins, sxp, rep, mSpeed, repAuraGranted };
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
