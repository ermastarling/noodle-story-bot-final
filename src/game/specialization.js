import { nowTs } from "../util/time.js";

export function ensureSpecializationState(player) {
  if (!player.profile) player.profile = {};
  if (!player.profile.specialization) {
    player.profile.specialization = {
      active_spec_id: null,
      chosen_at: null,
      change_cooldown_expires_at: null,
      unlocked_spec_ids: []
    };
  }
  const state = player.profile.specialization;
  if (!Array.isArray(state.unlocked_spec_ids)) state.unlocked_spec_ids = [];
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

function meetsRequirements(player, requirements) {
  if (!requirements) return { ok: true };
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

export function meetsSpecializationRequirements(player, requirements) {
  return meetsRequirements(player, requirements);
}

export function canSelectSpecialization(player, specializationsContent, specId, now = nowTs()) {
  const state = ensureSpecializationState(player);
  const spec = getSpecializationById(specializationsContent, specId);
  if (!spec) return { ok: false, reason: "Specialization not found." };

  if (state.active_spec_id === specId) {
    return { ok: false, reason: "Already active." };
  }

  return meetsRequirements(player, spec.requirements);
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
