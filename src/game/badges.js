import { nowTs } from "../util/time.js";

export function ensureBadgeState(player) {
  if (!player.profile) player.profile = {};
  if (!Array.isArray(player.profile.badges)) player.profile.badges = [];
  if (!("featured_badge_id" in player.profile)) player.profile.featured_badge_id = null;
  return player.profile;
}

export function getOwnedBadges(player) {
  const profile = ensureBadgeState(player);
  return profile.badges ?? [];
}

export function getBadgeById(badgesContent, badgeId) {
  return (badgesContent?.badges ?? []).find((b) => b.badge_id === badgeId) ?? null;
}

function meetsCondition(player, condition) {
  if (!condition) return false;
  if (condition.type === "serve_bowls_total") {
    const total = player?.lifetime?.bowls_served_total ?? 0;
    return total >= Number(condition.value || 0);
  }
  return false;
}

export function unlockBadges(player, badgesContent) {
  const profile = ensureBadgeState(player);
  const owned = new Set(profile.badges || []);
  const newlyUnlocked = [];

  for (const badge of badgesContent?.badges ?? []) {
    if (!badge?.badge_id) continue;
    if (owned.has(badge.badge_id)) continue;
    if (!meetsCondition(player, badge.condition)) continue;

    owned.add(badge.badge_id);
    newlyUnlocked.push(badge.badge_id);
  }

  if (newlyUnlocked.length) {
    profile.badges = [...owned];
    if (!profile.featured_badge_id) {
      profile.featured_badge_id = newlyUnlocked[0];
    }
    profile.badges_unlocked_at = profile.badges_unlocked_at ?? {};
    const ts = nowTs();
    for (const id of newlyUnlocked) {
      profile.badges_unlocked_at[id] = ts;
    }
  }

  return newlyUnlocked;
}
