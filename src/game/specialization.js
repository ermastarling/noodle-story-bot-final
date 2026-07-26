import { nowTs } from "../util/time.js";

export function ensureSpecializationState(player) {
  if (!player.profile) player.profile = {};
  if (!player.profile.specialization) {
    player.profile.specialization = {
      active_spec_id: null,
      chosen_at: null,
      change_cooldown_expires_at: null,
      unlocked_spec_ids: [],
      last_seen_shop_level: 0,
      seen_unlocked_spec_ids: []
    };
  }
  const state = player.profile.specialization;
  if (!Array.isArray(state.unlocked_spec_ids)) state.unlocked_spec_ids = [];
  if (!Array.isArray(state.seen_unlocked_spec_ids)) state.seen_unlocked_spec_ids = [...state.unlocked_spec_ids];
  if (!Number.isFinite(state.last_seen_shop_level) || state.last_seen_shop_level <= 0) {
    state.last_seen_shop_level = Number(player.shop_level || 1);
  }
  return state;
}

export function getSpecializationById(specializationsContent, specId) {
  return (specializationsContent?.specializations ?? []).find((s) => s.spec_id === specId) ?? null;
}

export function getActiveSpecialization(player, specializationsContent) {
  const state = ensureSpecializationState(player);
  if (!state.active_spec_id) return null;
  return getSpecializationById(specializationsContent, state.active_spec_id);
}

export function unlockSpecialization(player, specId) {
  const state = ensureSpecializationState(player);
  const normalizedSpecId = String(specId ?? "").trim();
  if (!normalizedSpecId) {
    return { added: false, unlockedSpecIds: state.unlocked_spec_ids };
  }

  const beforeCount = state.unlocked_spec_ids.length;
  if (!state.unlocked_spec_ids.includes(normalizedSpecId)) {
    state.unlocked_spec_ids.push(normalizedSpecId);
  }

  return {
    added: state.unlocked_spec_ids.length > beforeCount,
    unlockedSpecIds: state.unlocked_spec_ids
  };
}

function isPurchaseUnlocked(player, specId) {
  if (!specId) return false;
  const state = ensureSpecializationState(player);
  return Array.isArray(state.unlocked_spec_ids) && state.unlocked_spec_ids.includes(specId);
}

function meetsRequirements(player, requirements, specId) {
  if (!requirements) return { ok: true };
  if (requirements.purchase_required) {
    if (!isPurchaseUnlocked(player, specId)) {
      return { ok: false, reason: "Requires purchase." };
    }
  }
  if (requirements.min_level && (player.shop_level || 1) < requirements.min_level) {
    return { ok: false, reason: `Requires shop level ${requirements.min_level}.` };
  }
  if (requirements.min_rep && (player.rep || 0) < requirements.min_rep) {
    return { ok: false, reason: `Requires REP ${requirements.min_rep}.` };
  }
  if (requirements.bowls_served_total && (player.lifetime?.bowls_served_total || 0) < requirements.bowls_served_total) {
    return { ok: false, reason: `Requires ${requirements.bowls_served_total} bowls served.` };
  }
  if (Array.isArray(requirements.badges) && requirements.badges.length) {
    const owned = new Set(player.profile?.badges ?? []);
    const missing = requirements.badges.filter((id) => !owned.has(id));
    if (missing.length) {
      return { ok: false, reason: "Requires specific badges." };
    }
  }
  return { ok: true };
}

export function meetsSpecializationRequirements(player, requirements, specId) {
  return meetsRequirements(player, requirements, specId);
}

export function getUnseenHiddenSpecializations(player, specializationsContent) {
  const state = ensureSpecializationState(player);
  return (specializationsContent?.specializations ?? []).filter((spec) => {
    if (!spec?.hidden_until_unlocked) return false;
    if (!state.unlocked_spec_ids.includes(spec.spec_id)) return false;
    return !state.seen_unlocked_spec_ids.includes(spec.spec_id);
  });
}

export function canSelectSpecialization(player, specializationsContent, specId, now = nowTs()) {
  const state = ensureSpecializationState(player);
  const spec = getSpecializationById(specializationsContent, specId);
  if (!spec) return { ok: false, reason: "Specialization not found." };

  if (state.active_spec_id === specId) {
    return { ok: false, reason: "Already active." };
  }

  return meetsRequirements(player, spec.requirements, specId);
}

export function selectSpecialization(player, specializationsContent, specId, now = nowTs()) {
  const check = canSelectSpecialization(player, specializationsContent, specId, now);
  if (!check.ok) return { ok: false, reason: check.reason };

  const state = ensureSpecializationState(player);
  state.active_spec_id = specId;
  state.chosen_at = now;
  state.change_cooldown_expires_at = null;

  return { ok: true, specialization: getSpecializationById(specializationsContent, specId) };
}

export function hasNewShopLevelSpecialization(player, specializationsContent) {
  const state = ensureSpecializationState(player);
  const lastSeenLevel = Number(state.last_seen_shop_level || 0);
  const currentLevel = Number(player.shop_level || 1);
  if (currentLevel <= lastSeenLevel) return false;

  return (specializationsContent?.specializations ?? []).some((spec) => {
    const minLevel = Number(spec?.requirements?.min_level || 0);
    return minLevel > lastSeenLevel && minLevel <= currentLevel;
  });
}

export function markSpecializationShopLevelSeen(player, specializationsContent) {
  const state = ensureSpecializationState(player);
  const currentLevel = Number(player.shop_level || 1);
  state.last_seen_shop_level = Math.max(state.last_seen_shop_level || 0, currentLevel);

  const hiddenUnseen = getUnseenHiddenSpecializations(player, specializationsContent);
  if (hiddenUnseen.length) {
    for (const spec of hiddenUnseen) {
      if (!state.seen_unlocked_spec_ids.includes(spec.spec_id)) {
        state.seen_unlocked_spec_ids.push(spec.spec_id);
      }
    }
  }

  return state;
}
