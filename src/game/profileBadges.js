export const PROFILE_BADGE_CATEGORIES = Object.freeze(["badges", "achievements", "collections"]);
export const PROFILE_BADGE_ROW_LIMIT = 7;

export function ensureDisplayedProfileBadges(player, eligibleByCategory = {}) {
  if (!player?.profile || typeof player.profile !== "object") {
    throw new Error("Player profile is required to manage displayed badges");
  }

  const existing = player.profile.displayed_badges;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    const featured = String(player.profile.featured_badge_id ?? "").trim();
    player.profile.displayed_badges = Object.fromEntries(PROFILE_BADGE_CATEGORIES.map((category) => {
      const eligible = uniqueIds(eligibleByCategory[category]);
      const ordered = category === "badges" && featured && eligible.includes(featured)
        ? [featured, ...eligible.filter((id) => id !== featured)]
        : eligible;
      return [category, ordered.slice(0, PROFILE_BADGE_ROW_LIMIT)];
    }));
    return player.profile.displayed_badges;
  }

  for (const category of PROFILE_BADGE_CATEGORIES) {
    const eligible = new Set(uniqueIds(eligibleByCategory[category]));
    const selected = Array.isArray(existing[category]) ? existing[category] : [];
    existing[category] = uniqueIds(selected)
      .filter((id) => eligible.has(id))
      .slice(0, PROFILE_BADGE_ROW_LIMIT);
  }
  return existing;
}

export function toggleDisplayedProfileBadge(player, category, badgeId, eligibleByCategory = {}) {
  if (!PROFILE_BADGE_CATEGORIES.includes(category)) return { ok: false, reason: "invalid_category" };
  const id = String(badgeId ?? "").trim();
  if (!id || !uniqueIds(eligibleByCategory[category]).includes(id)) {
    return { ok: false, reason: "not_eligible" };
  }

  const displayed = ensureDisplayedProfileBadges(player, eligibleByCategory)[category];
  if (displayed.includes(id)) {
    player.profile.displayed_badges[category] = displayed.filter((entry) => entry !== id);
    return { ok: true, equipped: false };
  }
  if (displayed.length >= PROFILE_BADGE_ROW_LIMIT) {
    return { ok: false, reason: "row_full" };
  }
  player.profile.displayed_badges[category] = [...displayed, id];
  return { ok: true, equipped: true };
}

export function getDefaultDisplayedProfileBadges(player, eligibleByCategory = {}) {
  const existing = player?.profile?.displayed_badges;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return ensureDisplayedProfileBadges(player, eligibleByCategory);
  }

  const featured = String(player?.profile?.featured_badge_id ?? "").trim();
  return Object.fromEntries(PROFILE_BADGE_CATEGORIES.map((category) => {
    const eligible = uniqueIds(eligibleByCategory[category]);
    const ordered = category === "badges" && featured && eligible.includes(featured)
      ? [featured, ...eligible.filter((id) => id !== featured)]
      : eligible;
    return [category, ordered.slice(0, PROFILE_BADGE_ROW_LIMIT)];
  }));
}

function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}
