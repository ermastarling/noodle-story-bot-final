import { dayKeyUTC, nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";

function addRewardTotals(target, reward) {
  if (!reward) return;
  if (reward.coins) target.coins += reward.coins;
  if (reward.sxp) target.sxp += reward.sxp;
  if (reward.rep) target.rep += reward.rep;
}

export function computeDailyReward(rewardsContent, streakDays) {
  const base = rewardsContent?.base ?? { coins: 0, sxp: 0, rep: 0 };
  const total = { coins: base.coins || 0, sxp: base.sxp || 0, rep: base.rep || 0 };

  const streaks = rewardsContent?.streak_bonuses ?? [];
  for (const bonus of streaks) {
    if (streakDays >= bonus.day) {
      addRewardTotals(total, bonus.reward);
    }
  }

  return total;
}

export function claimDailyReward(player, rewardsContent, now = nowTs()) {
  if (!player.daily) player.daily = { last_claimed_at: null, streak_days: 0, streak_last_day: null };

  const todayKey = dayKeyUTC(now);
  const lastClaimedKey = player.daily.last_claimed_at
    ? dayKeyUTC(player.daily.last_claimed_at)
    : null;

  if (lastClaimedKey === todayKey) {
    return { ok: false, message: "Daily reward already claimed today." };
  }

  const yesterdayKey = dayKeyUTC(now - 24 * 60 * 60 * 1000);
  const isStreak = lastClaimedKey === yesterdayKey;
  const newStreak = isStreak ? (player.daily.streak_days || 0) + 1 : 1;

  player.daily.streak_days = newStreak;
  player.daily.streak_last_day = todayKey;
  player.daily.last_claimed_at = now;

  const reward = computeDailyReward(rewardsContent, newStreak);
  player.coins = (player.coins || 0) + (reward.coins || 0);
  player.rep = (player.rep || 0) + (reward.rep || 0);
  player.sxp_total = (player.sxp_total || 0) + (reward.sxp || 0);
  player.sxp_progress = (player.sxp_progress || 0) + (reward.sxp || 0);

  let leveledUp = 0;
  if (reward.sxp) {
    leveledUp = applySxpLevelUp(player);
  }

  if (!player.lifetime) player.lifetime = {};
  if (reward.coins) {
    player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + reward.coins;
  }

  return { ok: true, reward, streak: newStreak, leveledUp };
}
