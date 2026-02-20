import { ensureSpecializationState, getSpecializationById } from "./specialization.js";
import { ensureDecorState } from "./decor.js";

export const STORE_BUNDLE_SKU_MAP = {
  "1473851867552288942": "tideglass_pavilion",
  "1473890687790481595": "bloomwarden_garden_hall",
  "1473890963775557744": "astral_caravan",
  "1473891076879290533": "imperial_silk_noodle_court",
  "1473891555302572092": "elderwood_hearth",
  "1473891710516986040": "celestial_archive_kitchen",
  "1473891940293546068": "sakura_sweetheart_noodle_atelier"
};

export function resolveStoreBundleSpecId(skuId) {
  if (!skuId) return null;
  return STORE_BUNDLE_SKU_MAP[String(skuId)] ?? null;
}

export function grantStoreBundle({
  player,
  specId,
  specializationsContent,
  decorSetsContent,
  coins = 10000
} = {}) {
  if (!player) return { ok: false, reason: "Missing player." };
  if (!specId) return { ok: false, reason: "Missing specialization id." };

  const spec = getSpecializationById(specializationsContent, specId);
  if (!spec) return { ok: false, reason: "Specialization not found." };
  if (!spec?.requirements?.purchase_required) {
    return { ok: false, reason: "Specialization is not purchasable." };
  }

  const state = ensureSpecializationState(player);
  if (state.unlocked_spec_ids.includes(specId)) {
    return { ok: false, reason: "Already unlocked." };
  }
  state.unlocked_spec_ids.push(specId);

  const coinsToGrant = Number(coins || 0);
  if (coinsToGrant > 0) {
    player.coins = (player.coins || 0) + coinsToGrant;
    if (!player.lifetime) player.lifetime = {};
    player.lifetime.coins_earned = (player.lifetime.coins_earned || 0) + coinsToGrant;
  }

  const setId = specId;
  let decorGranted = 0;
  if (setId) {
    const set = (decorSetsContent?.sets ?? []).find((s) => s.set_id === setId);
    if (set?.pieces?.length) {
      ensureDecorState(player);
      for (const piece of set.pieces) {
        if (!piece?.item_id) continue;
        const owned = Number(player.cosmetics_owned?.[piece.item_id] || 0);
        if (owned > 0) continue;
        player.cosmetics_owned[piece.item_id] = 1;
        decorGranted += 1;
      }
    }
  }

  return {
    ok: true,
    spec,
    setId,
    coinsGranted: Math.max(0, coinsToGrant),
    decorGranted
  };
}
