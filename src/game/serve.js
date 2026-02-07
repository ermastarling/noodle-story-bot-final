import { COIN_BASE, SXP_BASE, REP_BASE, sxpToNext } from "../constants.js";
import { makeStreamRng, rngBetween } from "../util/rng.js";
import { dayKeyUTC, nowTs } from "../util/time.js";
import { getFailStreakBonuses, applyRepFloorBonus } from "./resilience.js";
import { loadStaffContent, loadUpgradesContent } from "../content/index.js";
import { calculateCombinedEffects, applyReputationBonus } from "./upgrades.js";
import { calculateStaffEffects } from "./staff.js";

const upgradesContent = loadUpgradesContent();
const staffContent = loadStaffContent();

export function computeServeRewards({ serverId, tier, npcArchetype, isLimitedTime, servedAtMs, acceptedAtMs, speedWindowSeconds, player, recipe, content, effects = null, eventEffects = null }) {
  const dayKey = dayKeyUTC(servedAtMs);
  const rng = makeStreamRng({ mode:"seeded", seed: 12345, streamName:"serve", serverId, dayKey });

  // Ensure player.buffs exists
  if (!player.buffs) player.buffs = {};

  const coinsBase = Math.floor(COIN_BASE[tier] * rngBetween(rng, 0.90, 1.10));
  let mSpeed = (isLimitedTime && speedWindowSeconds && acceptedAtMs)
    ? (1 + 0.20 * Math.max(0, Math.min(1, (speedWindowSeconds*1000 - (servedAtMs - acceptedAtMs)) / (speedWindowSeconds*1000))))
    : 1;

  // Night Market Regular: doubles speed bonus
  let npcModifier = null;
  if (npcArchetype === "night_market_regular" && mSpeed > 1) {
    mSpeed = 1 + (mSpeed - 1) * 2.0;
    npcModifier = "speed";
  }

  const rewardEffects = eventEffects?.rewards ?? {};
  const mEventRaw = Number(rewardEffects.coins_mult ?? 1);
  const eventSxpMultRaw = Number(rewardEffects.sxp_mult ?? 1);
  const eventRepMultRaw = Number(rewardEffects.rep_mult ?? 1);
  const eventCoinsBonusRaw = Number(rewardEffects.coins_bonus ?? 0);
  const eventSxpBonusRaw = Number(rewardEffects.sxp_bonus ?? 0);
  const eventRepBonusRaw = Number(rewardEffects.rep_bonus ?? 0);

  const mEvent = Number.isFinite(mEventRaw) ? mEventRaw : 1;
  const eventSxpMult = Number.isFinite(eventSxpMultRaw) ? eventSxpMultRaw : 1;
  const eventRepMult = Number.isFinite(eventRepMultRaw) ? eventRepMultRaw : 1;
  const eventCoinsBonus = Number.isFinite(eventCoinsBonusRaw) ? eventCoinsBonusRaw : 0;
  const eventSxpBonus = Number.isFinite(eventSxpBonusRaw) ? eventSxpBonusRaw : 0;
  const eventRepBonus = Number.isFinite(eventRepBonusRaw) ? eventRepBonusRaw : 0;
  const mCourier = (npcArchetype === "rain_soaked_courier") ? 1.25 : 1;
  if (mCourier > 1) npcModifier = "coins_courier";
  const mBard = (npcArchetype === "traveling_bard") ? 1.10 : 1;
  if (mBard > 1) npcModifier = "coins_bard";
  // Festival-Goer: +25% coins during events (not implemented yet, mEvent placeholder)
  const mFestival = (npcArchetype === "festival_goer") ? 1.25 : 1;
  if (mFestival > 1) npcModifier = "coins_festival";

  let coins = Math.floor(coinsBase * mSpeed * mEvent * mCourier * mBard * mFestival) + eventCoinsBonus;
  coins = Math.floor(coins);
  
  let sxp = Math.floor(SXP_BASE[tier]);
  
  // Forest Spirit: +10% SXP if recipe contains rare topping
  if (npcArchetype === "forest_spirit" && recipe && content) {
    const hasRareTopping = (recipe.ingredients || []).some(ing => {
      const item = content.items?.[ing.item_id];
      return item && item.tier === "rare" && item.category === "topping";
    });
    if (hasRareTopping) {
      sxp = Math.floor(sxp * 1.10);
      npcModifier = "sxp_forest";
    }
  }
  
  // Retired Captain: repeated recipe grants +10 SXP
  if (npcArchetype === "retired_captain" && player && recipe) {
    if (player.buffs.last_recipe_served === recipe.recipe_id) {
      sxp += 10;
      npcModifier = "sxp_captain";
    }
  }
  
  let rep = REP_BASE[tier];

  // Market Inspector: Rare+ grants +10 REP
  if (npcArchetype === "market_inspector" && (tier === "rare" || tier === "epic" || tier === "seasonal")) {
    rep += 10;
    npcModifier = "rep_inspector";
  }
  
  // Sleepy Traveler: first serve of day grants +5 REP
  if (npcArchetype === "sleepy_traveler") {
    const isFirstServeToday = !player?.daily?.last_serve_day || player.daily.last_serve_day !== dayKey;
    if (isFirstServeToday) {
      rep += 5;
      npcModifier = "rep_sleepy";
    }
  }
  
  // Moonlit Spirit: +15 REP on Epic tier
  if (npcArchetype === "moonlit_spirit" && tier === "epic") {
    rep += 15;
    npcModifier = "rep_moonlit";
  }

  if (eventSxpMult !== 1) sxp = Math.floor(sxp * eventSxpMult);
  if (eventRepMult !== 1) rep = Math.floor(rep * eventRepMult);
  if (eventSxpBonus) sxp += eventSxpBonus;
  if (eventRepBonus) rep += eventRepBonus;

  // Apply upgrade + staff effects
  const combinedEffects = effects ?? calculateCombinedEffects(player, upgradesContent, staffContent, calculateStaffEffects);
  if (combinedEffects?.order_quality_bonus) {
    const orderQualityMult = 1 + combinedEffects.order_quality_bonus;
    coins = Math.floor(coins * orderQualityMult);
    rep = Math.floor(rep * orderQualityMult);
  }
  if (combinedEffects?.sxp_bonus_percent) {
    sxp = Math.floor(sxp * (1 + combinedEffects.sxp_bonus_percent));
  }
  if (combinedEffects) {
    rep = applyReputationBonus(rep, combinedEffects, tier);
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
    npcModifier = "rep_aura";
  }
  
  // Apply active REP aura if present
  if (player?.buffs?.rep_aura_expires_at && nowTs() < player.buffs.rep_aura_expires_at) {
    rep += 2;
  }

  return { coins, sxp, rep, mSpeed, repAuraGranted, npcModifier };
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
