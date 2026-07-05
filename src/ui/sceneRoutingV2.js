export const V2_SCENE_REGISTRY = Object.freeze({
  "orders.board": Object.freeze(["acc", "ck", "sv", "fg", "qs", "rf", "nm", "buy", "pn", "cnl", "tk"]),
  "orders.accept_picker": Object.freeze(["sel", "cfm", "pg", "cnl", "bk"]),
  "orders.accept_result": Object.freeze(["cfm", "cnl", "bk", "ord", "ck"]),
  "orders.cancel_picker": Object.freeze(["sel", "cfm", "cnl", "bk"]),
  "cook.recipe_picker": Object.freeze(["sel", "qty", "pg", "go", "cfa", "bk"]),
  "cook.minigame": Object.freeze(["prep", "heat", "plate", "serve", "bk"]),
  "cook.result": Object.freeze(["ord", "cook", "serve", "nxt"]),
  "serve.order_picker": Object.freeze(["sel", "cfm", "serve", "sfa", "bk"]),
  "serve.result": Object.freeze(["ord", "cook", "again"])
});

const V2_SCENE_ACTION_SET = Object.freeze(
  Object.fromEntries(
    Object.entries(V2_SCENE_REGISTRY).map(([sceneKey, actions]) => [sceneKey, new Set(actions)])
  )
);

function routeExists(sceneKey, actionKey) {
  const safeSceneKey = String(sceneKey || "");
  if (!Object.prototype.hasOwnProperty.call(V2_SCENE_ACTION_SET, safeSceneKey)) return false;
  const actions = V2_SCENE_ACTION_SET[safeSceneKey];
  if (!(actions instanceof Set)) return false;
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
