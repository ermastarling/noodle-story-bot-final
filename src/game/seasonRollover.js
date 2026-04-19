import { nowTs } from "../util/time.js";
import { applySxpLevelUp } from "./serve.js";
import { getIcon } from "../ui/icons.js";

export function applySeasonRolloverReward(player, currentSeason, options = {}) {
  if (!player || !currentSeason) return null;
  if (!player.seasons) {
    player.seasons = { last_seen: null, last_rewarded_from: null, last_rewarded_at: null };
  }

  const previousSeason = player.seasons.last_seen ?? null;
  const seasonChanged = previousSeason && previousSeason !== currentSeason;
  player.seasons.last_seen = currentSeason;

  const invBowls = player.inv_bowls ?? {};
  const eventSeasonIndex = options?.eventRecipeSeasonIndex ?? {};
  const recipes = options?.recipes ?? {};
  const getRecipeSeason = (recipeId) => eventSeasonIndex?.[recipeId] ?? recipes?.[recipeId]?.season ?? null;

  let bowlCount = 0;
  const clearedKeys = [];
  let fromSeason = previousSeason;

  // Clear any cooked bowls tied to a season that is no longer active.
  for (const [key, bowl] of Object.entries(invBowls)) {
    const recipeSeason = getRecipeSeason(bowl?.recipe_id);
    if (!recipeSeason) continue;
    if (recipeSeason === currentSeason) continue;

    const qty = Math.max(0, Number(bowl?.qty || 0));
    if (!qty) continue;

    bowlCount += qty;
    clearedKeys.push(key);
    fromSeason = fromSeason ?? recipeSeason;
  }

  const rewardFromSeason = fromSeason ?? (seasonChanged ? previousSeason : null);
  if (rewardFromSeason) {
    player.seasons.last_rewarded_from = rewardFromSeason;
  }

  if (bowlCount <= 0) return null;

  // Clear event bowls from inventory now that they've been rewarded.
  for (const key of clearedKeys) {
    delete invBowls[key];
  }

  const coins = bowlCount * 5 + 10;
  const rep = Math.max(1, Math.ceil(bowlCount / 3) + 10);
  const sxp = bowlCount * 2 + 10;

  player.coins = (player.coins || 0) + coins;
  player.rep = (player.rep || 0) + rep;
  player.sxp_total = (player.sxp_total || 0) + sxp;
  player.sxp_progress = (player.sxp_progress || 0) + sxp;
  if (!player.lifetime) player.lifetime = {};
  player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + coins;
  const leveled = applySxpLevelUp(player);

  player.seasons.last_rewarded_at = nowTs();

  const friendlyFrom = rewardFromSeason
    ? rewardFromSeason.charAt(0).toUpperCase() + rewardFromSeason.slice(1)
    : "Last season";
  const friendlyCurrent = currentSeason.charAt(0).toUpperCase() + currentSeason.slice(1);
  const bowlLabel = `Cleared ${bowlCount} bowl${bowlCount === 1 ? "" : "s"}.`;
  const message = `${getIcon("season")} As ${friendlyFrom} hands the ladle to ${friendlyCurrent}, your event bowls found cozy homes. ${bowlLabel} Reward: **${coins}c**, **${rep} REP**, **${sxp} SXP**.`;

  return { message, leveled, cleared: clearedKeys.length, bowlsCleared: bowlCount };
}
