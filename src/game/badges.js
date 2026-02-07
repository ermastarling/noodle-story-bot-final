import { nowTs } from "../util/time.js";

export function ensureBadgeState(player) {
  if (!player.profile) player.profile = {};
  if (!Array.isArray(player.profile.badges)) player.profile.badges = [];
  if (!("featured_badge_id" in player.profile)) player.profile.featured_badge_id = null;
  if (!player.profile.badges_temp_expires_at) player.profile.badges_temp_expires_at = {};
  sweepExpiredTempBadges(player.profile);
  return player.profile;
}

export function getOwnedBadges(player) {
  const profile = ensureBadgeState(player);
  const activeTemp = Object.keys(profile.badges_temp_expires_at ?? {});
  return Array.from(new Set([...(profile.badges ?? []), ...activeTemp]));
}

export function getBadgeById(badgesContent, badgeId) {
  return (badgesContent?.badges ?? []).find((b) => b.badge_id === badgeId) ?? null;
}

export function grantBadge(player, badgesContent, badgeId) {
  const profile = ensureBadgeState(player);
  const badge = getBadgeById(badgesContent, badgeId);
  if (!badge) return { status: "missing" };

  const owned = new Set(profile.badges || []);
  if (owned.has(badgeId)) return { status: "owned", badge };

  owned.add(badgeId);
  profile.badges = [...owned];
  if (!profile.featured_badge_id) profile.featured_badge_id = badgeId;
  profile.badges_unlocked_at = profile.badges_unlocked_at ?? {};
  profile.badges_unlocked_at[badgeId] = nowTs();

  return { status: "granted", badge };
}

export function meetsCondition(player, condition, { allowEventOnly = false } = {}) {
  if (!condition) return false;
  if (condition.type === "event_only") {
    return allowEventOnly;
  }
  if (condition.type === "serve_bowls_total") {
    const total = player?.lifetime?.bowls_served_total ?? 0;
    return total >= Number(condition.value || 0);
  }
  return false;
}

function sweepExpiredTempBadges(profile, now = nowTs()) {
  const expiresAt = profile?.badges_temp_expires_at ?? {};
  let changed = false;
  for (const [badgeId, ts] of Object.entries(expiresAt)) {
    if (!ts || now >= ts) {
      delete expiresAt[badgeId];
      changed = true;
    }
  }
  if (changed && profile) {
    profile.badges_temp_expires_at = expiresAt;
  }
  return profile;
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

export function grantTemporaryBadge(player, badgesContent, badgeId, durationMs) {
  const profile = ensureBadgeState(player);
  const badge = getBadgeById(badgesContent, badgeId);
  if (!badge) return { status: "missing" };
  if (!meetsCondition(player, badge.condition, { allowEventOnly: true })) return { status: "ineligible" };

  const now = nowTs();
  const expiresAt = now + Math.max(0, Number(durationMs || 0));
  const tempMap = profile.badges_temp_expires_at ?? {};
  const wasActive = tempMap[badgeId] && tempMap[badgeId] > now;
  tempMap[badgeId] = expiresAt;
  profile.badges_temp_expires_at = tempMap;

  return { status: wasActive ? "refreshed" : "granted", expiresAt };
}
