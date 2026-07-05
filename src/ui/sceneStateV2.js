import { randomBytes } from "node:crypto";

const DEFAULT_SCENE_TTL_MS = Object.freeze({
  "orders.board": 10 * 60 * 1000,
  "orders.accept_picker": 5 * 60 * 1000,
  "orders.accept_result": 5 * 60 * 1000,
  "orders.cancel_picker": 5 * 60 * 1000,
  "cook.recipe_picker": 5 * 60 * 1000,
  "cook.minigame": 3 * 60 * 1000,
  "cook.result": 5 * 60 * 1000,
  "serve.order_picker": 5 * 60 * 1000,
  "serve.result": 5 * 60 * 1000
});

const FALLBACK_SCENE_TTL_MS = 5 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.floor(parsed);
  if (clamped <= 0) return fallback;
  return clamped;
}

function createToken(nowMs = Date.now()) {
  const entropy = randomBytes(8).toString("hex");
  return `${nowMs.toString(36)}${entropy}`;
}

export function getSceneTtlMs(sceneKey, env = process.env) {
  const safeSceneKey = String(sceneKey || "");
  const sceneDefault = Object.prototype.hasOwnProperty.call(DEFAULT_SCENE_TTL_MS, safeSceneKey)
    ? DEFAULT_SCENE_TTL_MS[safeSceneKey]
    : FALLBACK_SCENE_TTL_MS;
  return parsePositiveInt(env?.NOODLE_V2_SCENE_TTL_MS, sceneDefault);
}

export function createSceneStateStore({ maxEntries } = {}) {
  const resolvedMaxEntries = parsePositiveInt(maxEntries ?? process.env.NOODLE_V2_SCENE_MAX_ENTRIES, 2000);
  const states = new Map();

  function cleanupExpired(nowMs = Date.now()) {
    let removed = 0;
    for (const [token, entry] of states.entries()) {
      if ((entry?.expiresAt ?? 0) <= nowMs) {
        states.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  function enforceCapacity(nowMs = Date.now()) {
    if (states.size <= resolvedMaxEntries) return 0;

    const entries = [...states.entries()].sort((a, b) => {
      const aLast = Number(a[1]?.lastAccessedAt ?? a[1]?.createdAt ?? 0);
      const bLast = Number(b[1]?.lastAccessedAt ?? b[1]?.createdAt ?? 0);
      if (aLast === bLast) {
        return Number(a[1]?.createdAt ?? 0) - Number(b[1]?.createdAt ?? 0);
      }
      return aLast - bLast;
    });

    const targetSize = Math.max(1, Math.floor(resolvedMaxEntries * 0.9));
    let removed = 0;
    for (const [token] of entries) {
      if (states.size <= targetSize) break;
      states.delete(token);
      removed += 1;
    }

    // Secondary guard in case size still exceeded due to edge-case sizing.
    if (states.size > resolvedMaxEntries) {
      for (const [token] of states.entries()) {
        if (states.size <= resolvedMaxEntries) break;
        states.delete(token);
        removed += 1;
      }
    }

    return removed;
  }

  function putState({ sceneKey, ownerId, state, token, ttlMs, nowMs = Date.now() } = {}) {
    const safeSceneKey = String(sceneKey || "").trim();
    const safeOwnerId = String(ownerId || "").trim();
    if (!safeSceneKey || !safeOwnerId) {
      throw new Error("sceneKey and ownerId are required");
    }

    cleanupExpired(nowMs);

    const resolvedToken = String(token || createToken(nowMs)).trim();
    if (!resolvedToken) throw new Error("token is required");

    const resolvedTtl = parsePositiveInt(ttlMs, getSceneTtlMs(safeSceneKey));
    const expiresAt = nowMs + resolvedTtl;

    states.set(resolvedToken, {
      token: resolvedToken,
      sceneKey: safeSceneKey,
      ownerId: safeOwnerId,
      state: state ?? {},
      createdAt: nowMs,
      lastAccessedAt: nowMs,
      expiresAt
    });

    const evicted = enforceCapacity(nowMs);

    return {
      token: resolvedToken,
      expiresAt,
      ttlMs: resolvedTtl,
      evicted
    };
  }

  function getState({ sceneKey, token, ownerId, nowMs = Date.now() } = {}) {
    const safeToken = String(token || "").trim();
    const safeSceneKey = String(sceneKey || "").trim();
    const safeOwnerId = ownerId == null ? "" : String(ownerId).trim();
    if (!safeToken) return { ok: false, stale: true, reason: "missing_token" };
    if (!safeSceneKey) return { ok: false, stale: true, reason: "missing_scene_key" };

    const entry = states.get(safeToken);
    if (!entry) return { ok: false, stale: true, reason: "missing_state" };

    if ((entry.expiresAt ?? 0) <= nowMs) {
      states.delete(safeToken);
      return { ok: false, stale: true, reason: "expired" };
    }

    if (entry.sceneKey !== safeSceneKey) {
      return { ok: false, stale: true, reason: "scene_mismatch" };
    }

    if (safeOwnerId && entry.ownerId !== safeOwnerId) {
      return { ok: false, stale: false, reason: "owner_mismatch" };
    }

    entry.lastAccessedAt = nowMs;
    return {
      ok: true,
      stale: false,
      reason: null,
      value: {
        token: entry.token,
        sceneKey: entry.sceneKey,
        ownerId: entry.ownerId,
        state: entry.state,
        expiresAt: entry.expiresAt
      }
    };
  }

  function removeState(token) {
    const safeToken = String(token || "").trim();
    if (!safeToken) return false;
    return states.delete(safeToken);
  }

  function getStats(nowMs = Date.now()) {
    let expiredCount = 0;
    for (const entry of states.values()) {
      if ((entry?.expiresAt ?? 0) <= nowMs) expiredCount += 1;
    }

    return {
      size: states.size,
      maxEntries: resolvedMaxEntries,
      expiredCount
    };
  }

  return {
    putState,
    getState,
    cleanupExpired,
    removeState,
    getStats
  };
}

const sceneStateStore = createSceneStateStore();

export function putSceneState(input) {
  return sceneStateStore.putState(input);
}

export function getSceneState(input) {
  return sceneStateStore.getState(input);
}

export function cleanupExpiredSceneState(nowMs) {
  return sceneStateStore.cleanupExpired(nowMs);
}

export function getSceneStateStats(nowMs) {
  return sceneStateStore.getStats(nowMs);
}

export function removeSceneState(token) {
  return sceneStateStore.removeState(token);
}
