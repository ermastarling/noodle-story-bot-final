export const V2_SCENE_REGISTRY = Object.freeze({
  "orders.board": new Set(["acc", "ck", "sv", "qs", "rf", "nm", "cnl"]),
  "orders.accept_picker": new Set(["sel", "cfm", "cnl", "bk"]),
  "orders.accept_result": new Set(["cfm", "cnl", "bk", "ord", "ck"]),
  "cook.recipe_picker": new Set(["sel", "qty", "go", "bk"]),
  "cook.minigame": new Set(["prep", "heat", "plate", "serve", "bk"]),
  "cook.result": new Set(["ord", "cook", "serve"]),
  "serve.order_picker": new Set(["sel", "serve", "bk"]),
  "serve.result": new Set(["ord", "cook", "again"])
});

function routeExists(sceneKey, actionKey) {
  const actions = V2_SCENE_REGISTRY[sceneKey];
  if (!actions) return false;
  return actions.has(actionKey);
}

export function parseV2CustomId(customId) {
  const raw = String(customId ?? "").trim();
  if (!raw) {
    return { isV2: false, valid: false, error: "empty_custom_id" };
  }

  if (!raw.startsWith("noodle:v2:")) {
    return { isV2: false, valid: false, error: null };
  }

  const parts = raw.split(":");
  if (parts.length < 6) {
    return { isV2: true, valid: false, error: "missing_required_segments" };
  }

  const sceneKey = String(parts[2] ?? "").trim();
  const actionKey = String(parts[3] ?? "").trim();
  const ownerId = String(parts[4] ?? "").trim();
  const token = String(parts[5] ?? "").trim();
  const args = parts.slice(6).map((part) => String(part ?? "").trim()).filter(Boolean);

  if (!sceneKey || !actionKey || !ownerId || !token) {
    return { isV2: true, valid: false, error: "invalid_required_segment" };
  }

  if (!routeExists(sceneKey, actionKey)) {
    return {
      isV2: true,
      valid: false,
      error: "unknown_scene_action",
      sceneKey,
      actionKey,
      ownerId,
      token,
      args
    };
  }

  return {
    isV2: true,
    valid: true,
    error: null,
    sceneKey,
    actionKey,
    ownerId,
    token,
    args
  };
}

export function isV2OwnerMismatch(parsed, userId) {
  if (!parsed?.isV2 || !parsed?.valid) return false;
  return String(parsed.ownerId) !== String(userId ?? "");
}
